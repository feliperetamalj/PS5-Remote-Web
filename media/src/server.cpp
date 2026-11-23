// media serve: sesión de Remote Play (libchiaki) ↔ un jugador y hasta MAX_WATCHERS espectadores por WebRTC (libdatachannel).
// El video H.264 y el audio Opus se reenvían tal cual, sin decodificar ni recomprimir.
// Solo web/ habla con este proceso, por un socket unix 0600 con una petición JSON por línea.
#include <rtc/rtc.hpp>
#include <nlohmann/json.hpp>

#include <chiaki/controller.h>
#include <chiaki/discovery.h>
#include <chiaki/log.h>
#include <chiaki/session.h>

#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <atomic>
#include <csignal>
#include <chrono>
#include <cstring>
#include <fstream>
#include <future>
#include <iostream>
#include <mutex>
#include <shared_mutex>
#include <sstream>
#include <thread>
#include <vector>

using json = nlohmann::json;
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

// Lo que un jugador puede apretar. PS abre el menú del sistema y SHARE es el botón Create:
// ninguno de los dos pasa, venga lo que venga del navegador.
static const uint32_t ALLOWED_BUTTONS = 0xFFFF & ~(CHIAKI_CONTROLLER_BUTTON_PS | CHIAKI_CONTROLLER_BUTTON_SHARE);
static const auto PAD_TIMEOUT = 500ms; // sin paquetes del mando → todo suelto
static const auto IDR_MIN_GAP = 500ms; // tope a los pedidos de cuadro clave
static const size_t MAX_WATCHERS = 4; // espectadores a la vez
static const auto WATCH_IDR_GAP = 3s; // entre todos los espectadores, un cuadro clave cada 3 s: no degradan al jugador
static const auto WATCH_CONNECT_TIMEOUT = 20s; // un espectador que no termina de conectar libera su cupo

struct Peer {
	std::shared_ptr<rtc::PeerConnection> pc;
	std::shared_ptr<rtc::Track> video, audio;
	std::shared_ptr<rtc::DataChannel> pad;
	std::mutex pad_mu;
	uint16_t last_seq = 0;
	bool have_seq = false, neutral = true;
	Clock::time_point last_pad = Clock::now();
	int id = 0; // solo espectadores
	Clock::time_point created = Clock::now();
};

static ChiakiLog ps5_log;
static std::string ps5_host, ps5_regist_key;
static uint8_t ps5_morning[16];
static uint16_t udp_port;
// Modo público: el video entra por un túnel UDP (playit.gg). Se anuncia solo esa dirección y
// no se comparten las IP locales del Mac. Vacío = modo red local.
static std::string public_ip;
static uint16_t public_port = 0;

static ChiakiSession session;
static std::shared_mutex session_mu; // compartido: usar la sesión · exclusivo: crearla o destruirla
static bool session_alive = false;
static std::recursive_mutex lifecycle_mu; // serializa abrir y cerrar la sesión (hilo de control y vigilante)
static std::atomic<uint32_t> forced_buttons{0}; // botón PS de emergencia del admin: se suma a lo que mande el jugador
static std::atomic<bool> ps5_connected{false}, ps5_quit{false};
static std::string ps5_quit_reason;

static std::mutex peer_mu;
static std::shared_ptr<Peer> peer;
// Espectadores: reciben los mismos cuadros que el jugador. No tienen canal de mando, así que no pueden enviar input.
static std::vector<std::shared_ptr<Peer>> watchers; // protegido por peer_mu
static std::atomic<size_t> watcher_count{0}; // para no tomar el candado por cuadro cuando no hay nadie mirando
static std::atomic<int64_t> last_watch_idr_ms{0};
static int next_watch_id = 1;
static rtc::binary video_header; // SPS/PPS: la PS5 lo manda una sola vez, al empezar
static std::atomic<int64_t> expires_at{0}; // ms desde 1970; 0 = sin turno
static std::atomic<int64_t> last_idr_ms{0};
static std::atomic<uint64_t> audio_packets{0};
static const Clock::time_point t0 = Clock::now();

static int64_t now_ms() {
	return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}
static std::shared_ptr<Peer> current_peer() {
	std::lock_guard<std::mutex> l(peer_mu);
	return peer;
}
/** A quién se le manda cada cuadro: el jugador primero y después los espectadores. */
static std::vector<std::shared_ptr<Peer>> current_targets() {
	std::vector<std::shared_ptr<Peer>> out;
	std::lock_guard<std::mutex> l(peer_mu);
	if(peer)
		out.push_back(peer);
	if(watcher_count.load())
		out.insert(out.end(), watchers.begin(), watchers.end());
	return out;
}

static void set_controller(const ChiakiControllerState &st) {
	std::shared_lock<std::shared_mutex> l(session_mu);
	if(!session_alive)
		return;
	ChiakiControllerState out = st;
	out.buttons |= forced_buttons.load();
	chiaki_session_set_controller_state(&session, &out);
}
static void release_controller() {
	ChiakiControllerState st;
	chiaki_controller_state_set_idle(&st);
	set_controller(st);
}
static void request_idr() {
	int64_t t = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count();
	int64_t last = last_idr_ms.load();
	if(t - last < IDR_MIN_GAP.count() && last != 0)
		return;
	last_idr_ms = t;
	std::shared_lock<std::shared_mutex> l(session_mu);
	if(session_alive && ps5_connected) // si la consola ya cortó, su conexión está destruida
		chiaki_session_request_idr(&session);
}
static void request_watch_idr() {
	int64_t t = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count();
	int64_t last = last_watch_idr_ms.load();
	if(last != 0 && t - last < std::chrono::duration_cast<std::chrono::milliseconds>(WATCH_IDR_GAP).count())
		return;
	last_watch_idr_ms = t;
	request_idr();
}

// ── chiaki → WebRTC ──────────────────────────────────────────────────────────
static bool has_nal(const uint8_t *b, size_t n, int type) {
	for(size_t i = 0; i + 3 < n; i++)
		if(b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 && (b[i + 3] & 0x1f) == type)
			return true;
	return false;
}

// Hilo de red de chiaki: no bloquear. sendFrame solo encola en el transporte.
static bool on_video(uint8_t *buf, size_t size, int32_t, bool, void *) {
	bool idr = has_nal(buf, size, 5);
	if(!idr && has_nal(buf, size, 7)) { // cabecera suelta (SPS/PPS)
		std::lock_guard<std::mutex> l(peer_mu);
		video_header.assign(reinterpret_cast<const std::byte *>(buf), reinterpret_cast<const std::byte *>(buf) + size);
		return true;
	}
	auto targets = current_targets();
	if(targets.empty())
		return true;
	auto ts = std::chrono::duration<double>(Clock::now() - t0);
	rtc::binary frame;
	if(idr) { // el navegador necesita SPS/PPS junto a cada cuadro clave
		{
			std::lock_guard<std::mutex> l(peer_mu);
			frame = video_header;
		}
		frame.insert(frame.end(), reinterpret_cast<const std::byte *>(buf), reinterpret_cast<const std::byte *>(buf) + size);
	}
	for(auto &p : targets) {
		if(!p->video->isOpen())
			continue;
		try {
			if(idr)
				p->video->sendFrame(frame, ts);
			else
				p->video->sendFrame(reinterpret_cast<const std::byte *>(buf), size, ts);
		} catch(const std::exception &) {
		}
	}
	return true;
}

static void on_audio_header(ChiakiAudioHeader *h, void *) {
	if(h->rate != 48000 || h->frame_size != 480)
		std::cerr << "audio inesperado: " << h->rate << " Hz, " << h->frame_size << " muestras" << std::endl;
}
static void on_audio_frame(uint8_t *buf, size_t size, void *) {
	uint64_t n = audio_packets++;
	for(auto &p : current_targets()) {
		if(!p->audio->isOpen())
			continue;
		try {
			p->audio->sendFrame(reinterpret_cast<const std::byte *>(buf), size, rtc::FrameInfo(uint32_t(n * 480)));
		} catch(const std::exception &) {
		}
	}
}

static void on_event(ChiakiEvent *e, void *) {
	if(e->type == CHIAKI_EVENT_CONNECTED)
		ps5_connected = true;
	else if(e->type == CHIAKI_EVENT_QUIT) {
		ps5_quit_reason = chiaki_quit_reason_string(e->quit.reason);
		ps5_connected = false;
		ps5_quit = true;
	}
}

// ── sesión con la PS5 ────────────────────────────────────────────────────────
static void session_close() {
	std::lock_guard<std::recursive_mutex> life(lifecycle_mu);
	{
		std::unique_lock<std::shared_mutex> l(session_mu);
		if(!session_alive)
			return;
		session_alive = false;
	}
	chiaki_session_stop(&session);
	chiaki_session_join(&session);
	chiaki_session_fini(&session);
	ps5_connected = false;
}

static std::string session_open() {
	std::lock_guard<std::recursive_mutex> life(lifecycle_mu);
	if(ps5_quit)
		session_close(); // la consola cortó: se limpia y se vuelve a conectar
	{
		std::shared_lock<std::shared_mutex> l(session_mu);
		if(session_alive && ps5_connected)
			return "";
	}
	session_close();
	ps5_quit = false;

	ChiakiConnectInfo info = {};
	info.ps5 = true;
	info.host = ps5_host.c_str();
	strncpy(info.regist_key, ps5_regist_key.c_str(), sizeof(info.regist_key));
	memcpy(info.morning, ps5_morning, sizeof(info.morning));
	chiaki_connect_video_profile_preset(&info.video_profile, CHIAKI_VIDEO_RESOLUTION_PRESET_1080p, CHIAKI_VIDEO_FPS_PRESET_60);
	info.video_profile.codec = CHIAKI_CODEC_H264;
	info.enable_idr_on_fec_failure = true;

	{
		std::unique_lock<std::shared_mutex> l(session_mu);
		if(chiaki_session_init(&session, &info, &ps5_log) != CHIAKI_ERR_SUCCESS)
			return "No se pudo iniciar la sesión con la PS5";
		static ChiakiAudioSink sink = {nullptr, on_audio_header, on_audio_frame};
		chiaki_session_set_audio_sink(&session, &sink);
		chiaki_session_set_video_sample_cb(&session, on_video, nullptr);
		chiaki_session_set_event_cb(&session, on_event, nullptr);
		chiaki_session_start(&session);
		session_alive = true;
	}
	for(int i = 0; i < 150 && !ps5_connected && !ps5_quit; i++)
		std::this_thread::sleep_for(100ms);
	if(ps5_connected)
		return "";
	std::string why = ps5_quit ? ps5_quit_reason : "sin respuesta en 15 s";
	session_close();
	return "La PS5 no aceptó la conexión (" + why + "). Si está en reposo, despiértala.";
}

// ── SDP en modo público ─────────────────────────────────────────────────────
/** Reescribe las líneas a=candidate: `keep` decide cuáles quedan y `extra` se agrega en la primera sección de medios. */
static std::string rewrite_candidates(const std::string &sdp, const std::function<bool(const std::string &)> &keep, const std::string &extra) {
	std::istringstream in(sdp);
	std::string out, line;
	bool added = extra.empty();
	int media_sections = 0;
	while(std::getline(in, line)) {
		if(!line.empty() && line.back() == '\r')
			line.pop_back();
		if(line.rfind("m=", 0) == 0 && ++media_sections == 2 && !added) { // la primera sección terminó sin candidatos
			out += extra + "\r\n";
			added = true;
		}
		if(line.rfind("a=candidate:", 0) == 0) {
			if(!added) {
				out += extra + "\r\n";
				added = true;
			}
			if(!keep(line))
				continue;
		}
		out += line + "\r\n";
	}
	if(!added)
		out += extra + "\r\n";
	return out;
}

/** ¿El candidato apunta a una IP pública? Descarta privadas, loopback, link-local, CGNAT y nombres (.local). */
static bool candidate_is_public(const std::string &line) {
	std::istringstream in(line);
	std::string tok, addr;
	for(int i = 0; i < 5 && in >> tok; i++) // foundation, componente, transporte, prioridad, dirección
		addr = tok;
	in_addr v4;
	if(inet_pton(AF_INET, addr.c_str(), &v4) == 1) {
		uint32_t a = ntohl(v4.s_addr);
		return !((a >> 24) == 10 || (a >> 24) == 127 || (a >> 24) == 0 || (a >> 20) == 0xAC1 || (a >> 16) == 0xC0A8 ||
			(a >> 16) == 0xA9FE || (a >> 22) == (0x64400000u >> 22) || (a >> 28) >= 0xE);
	}
	in6_addr v6;
	if(inet_pton(AF_INET6, addr.c_str(), &v6) == 1)
		return (v6.s6_addr[0] & 0xE0) == 0x20; // solo unicast global (2000::/3)
	return false;
}

// ── peer WebRTC ──────────────────────────────────────────────────────────────
static void peer_close() {
	std::shared_ptr<Peer> old;
	{
		std::lock_guard<std::mutex> l(peer_mu);
		old.swap(peer);
	}
	if(old)
		old->pc->close();
	release_controller(); // después de cerrar: un paquete en vuelo del peer viejo ya no puede dejar nada apretado
}

static void watchers_close() {
	std::vector<std::shared_ptr<Peer>> old;
	{
		std::lock_guard<std::mutex> l(peer_mu);
		old.swap(watchers);
		watcher_count = 0;
	}
	for(auto &w : old)
		w->pc->close();
}

static void on_pad(const std::shared_ptr<Peer> &p, const rtc::binary &m) {
	if(m.size() != 16 || current_peer() != p) // formato fijo, y solo del peer vigente
		return;
	auto b = reinterpret_cast<const uint8_t *>(m.data());
	auto u16 = [&](int i) { return uint16_t(b[i] | (b[i + 1] << 8)); };
	uint16_t seq = u16(0);
	ChiakiControllerState st;
	chiaki_controller_state_set_idle(&st);
	st.buttons = (uint32_t(b[2]) | (uint32_t(b[3]) << 8) | (uint32_t(b[4]) << 16) | (uint32_t(b[5]) << 24)) & ALLOWED_BUTTONS;
	st.left_x = int16_t(u16(6));
	st.left_y = int16_t(u16(8));
	st.right_x = int16_t(u16(10));
	st.right_y = int16_t(u16(12));
	st.l2_state = b[14];
	st.r2_state = b[15];
	{
		std::lock_guard<std::mutex> l(p->pad_mu);
		if(p->have_seq && int16_t(seq - p->last_seq) <= 0) // llegó tarde o repetido
			return;
		p->last_seq = seq;
		p->have_seq = true;
		p->last_pad = Clock::now();
		p->neutral = false;
	}
	set_controller(st);
}

/**
 * Arma una conexión que envía el video y el audio de la PS5 y deja la oferta en `sdp`.
 * Solo el jugador recibe el canal del mando; un espectador no tiene por dónde enviar input.
 * Devuelve un mensaje de error, o vacío si salió bien.
 */
static std::string make_peer(const std::shared_ptr<Peer> &p, bool player, std::string &sdp) {
	rtc::Configuration config;
	config.portRangeBegin = config.portRangeEnd = udp_port; // un solo puerto UDP para todos
	config.enableIceUdpMux = true;
	p->pc = std::make_shared<rtc::PeerConnection>(config);
	std::weak_ptr<Peer> wp = p;

	auto gathered = std::make_shared<std::promise<void>>();
	auto gathered_once = std::make_shared<std::once_flag>();
	p->pc->onGatheringStateChange([gathered, gathered_once](rtc::PeerConnection::GatheringState s) {
		if(s == rtc::PeerConnection::GatheringState::Complete)
			std::call_once(*gathered_once, [&] { gathered->set_value(); });
	});
	if(player)
		p->pc->onStateChange([](rtc::PeerConnection::State s) {
			using S = rtc::PeerConnection::State;
			if(s == S::Disconnected || s == S::Failed || s == S::Closed)
				release_controller(); // se cayó el jugador: nada queda apretado
		});

	// Video: H.264 Annex-B → RTP. Perfil Main, que es lo que entrega la PS5.
	rtc::Description::Video video("video", rtc::Description::Direction::SendOnly);
	video.addH264Codec(96, "profile-level-id=4d001f;packetization-mode=1;level-asymmetry-allowed=1");
	video.addSSRC(1, "ps5", "ps5-video", "video");
	p->video = p->pc->addTrack(video);
	auto vcfg = std::make_shared<rtc::RtpPacketizationConfig>(1, "ps5", 96, rtc::H264RtpPacketizer::ClockRate);
	auto vpack = std::make_shared<rtc::H264RtpPacketizer>(rtc::NalUnit::Separator::StartSequence, vcfg);
	vpack->addToChain(std::make_shared<rtc::RtcpSrReporter>(vcfg));
	vpack->addToChain(std::make_shared<rtc::RtcpNackResponder>());
	// El navegador pide cuadro clave → se lo pedimos a la PS5. Los espectadores comparten un tope más estricto.
	vpack->addToChain(std::make_shared<rtc::PliHandler>([player] { player ? request_idr() : request_watch_idr(); }));
	p->video->setMediaHandler(vpack);
	if(player)
		p->video->onOpen([] { last_idr_ms = 0; request_idr(); }); // el que entra necesita partir de un cuadro clave
	else
		p->video->onOpen([] { request_watch_idr(); });

	// Audio: Opus tal cual. msid distinto al del video: el navegador no sincroniza labios y no retrasa el video.
	rtc::Description::Audio audio("audio", rtc::Description::Direction::SendOnly);
	audio.addOpusCodec(111);
	audio.addSSRC(2, "ps5", "ps5-audio", "audio");
	p->audio = p->pc->addTrack(audio);
	auto acfg = std::make_shared<rtc::RtpPacketizationConfig>(2, "ps5", 111, rtc::OpusRtpPacketizer::DefaultClockRate);
	auto apack = std::make_shared<rtc::OpusRtpPacketizer>(acfg);
	apack->addToChain(std::make_shared<rtc::RtcpSrReporter>(acfg));
	p->audio->setMediaHandler(apack);

	if(player) {
		// Mando: sin orden ni reintentos. El canal lo crea el servidor; los que abra el navegador se ignoran.
		rtc::DataChannelInit init;
		init.reliability.unordered = true;
		init.reliability.maxRetransmits = 0;
		p->pad = p->pc->createDataChannel("pad", init);
		p->pad->onMessage([wp](rtc::binary m) { if(auto p = wp.lock()) on_pad(p, m); }, [](std::string) {});
	}

	p->pc->setLocalDescription();
	if(gathered->get_future().wait_for(5s) != std::future_status::ready)
		return "No se pudieron reunir los candidatos de red";
	auto local = p->pc->localDescription();
	if(!local)
		return "Sin descripción local";
	sdp = std::string(*local);
	if(!public_ip.empty()) // fuera de casa: una sola puerta de entrada, y ninguna IP local a la vista
		sdp = rewrite_candidates(sdp, [](const std::string &) { return false; },
			"a=candidate:1 1 UDP 2130706431 " + public_ip + " " + std::to_string(public_port) + " typ host");
	return "";
}

static json op_start(const json &req) {
	std::string err = session_open();
	if(!err.empty())
		return {{"error", err}};
	peer_close();
	watchers_close(); // partida nueva: quien quiera mirar vuelve a entrar
	int64_t until = req.value("expires_at", int64_t(0));
	if(until <= now_ms()) { // sin vencimiento válido no se transmite: el corte propio de media no es opcional
		session_close();
		return {{"error", "Turno sin vencimiento válido"}};
	}
	expires_at = until;
	auto p = std::make_shared<Peer>();
	std::string sdp;
	err = make_peer(p, true, sdp);
	if(!err.empty()) { // no dejar la consola tomada si la conexión no llegó a armarse
		expires_at = 0;
		p->pc->close();
		session_close();
		return {{"error", err}};
	}
	{
		std::lock_guard<std::mutex> l(peer_mu);
		peer = p;
	}
	return {{"sdp", sdp}};
}

/** Un espectador pide mirar la partida en curso. No toca la sesión con la PS5 ni la conexión del jugador. */
static json op_watch() {
	if(!current_peer() || !ps5_connected || !expires_at.load())
		return {{"error", "Nadie está jugando ahora"}};
	if(watcher_count.load() >= MAX_WATCHERS)
		return {{"error", "Ya hay " + std::to_string(MAX_WATCHERS) + " personas mirando. Prueba en un rato."}};
	auto p = std::make_shared<Peer>();
	std::string sdp;
	std::string err = make_peer(p, false, sdp);
	if(!err.empty()) {
		p->pc->close();
		return {{"error", err}};
	}
	{
		std::lock_guard<std::mutex> l(peer_mu);
		p->id = next_watch_id++;
		watchers.push_back(p);
		watcher_count = watchers.size();
	}
	if(!expires_at.load()) { // el turno venció mientras se armaba la conexión
		watchers_close();
		return {{"error", "Nadie está jugando ahora"}};
	}
	return {{"sdp", sdp}, {"id", p->id}};
}

static json op_watch_answer(const json &req) {
	int id = req.value("id", 0);
	std::shared_ptr<Peer> p;
	{
		std::lock_guard<std::mutex> l(peer_mu);
		for(auto &w : watchers)
			if(w->id == id)
				p = w;
	}
	if(!p)
		return {{"error", "La conexión para mirar ya no existe"}};
	std::string sdp = req.at("sdp").get<std::string>();
	if(!public_ip.empty())
		sdp = rewrite_candidates(sdp, candidate_is_public, "");
	p->pc->setRemoteDescription(rtc::Description(sdp, "answer"));
	return {{"ok", true}};
}

static json op_answer(const json &req) {
	auto p = current_peer();
	if(!p)
		return {{"error", "No hay conexión en curso"}};
	std::string sdp = req.at("sdp").get<std::string>();
	if(!public_ip.empty()) // no sondear direcciones internas porque un navegador las mencione
		sdp = rewrite_candidates(sdp, candidate_is_public, "");
	p->pc->setRemoteDescription(rtc::Description(sdp, "answer"));
	return {{"ok", true}};
}

static json handle(const json &req) {
	std::string op = req.value("op", "");
	if(op == "start")
		return op_start(req);
	if(op == "answer")
		return op_answer(req);
	if(op == "watch")
		return op_watch();
	if(op == "watch_answer")
		return op_watch_answer(req);
	if(op == "stop") {
		expires_at = 0;
		peer_close();
		watchers_close();
		session_close(); // libera la consola para Felipe
		return {{"ok", true}};
	}
	if(op == "extend") {
		int64_t until = req.value("expires_at", int64_t(0));
		if(until <= now_ms() || !current_peer())
			return {{"error", "Nada que extender"}};
		expires_at = until;
		return {{"ok", true}};
	}
	if(op == "status") {
		auto p = current_peer();
		return {{"ps5", ps5_connected ? "connected" : "idle"}, {"peer", p ? int(p->pc->state()) : -1}, {"expires_at", expires_at.load()},
			{"watchers", watcher_count.load()}};
	}
	if(op == "wake") {
		uint64_t credential = strtoull(ps5_regist_key.c_str(), nullptr, 16);
		ChiakiErrorCode e = chiaki_discovery_wakeup(&ps5_log, nullptr, ps5_host.c_str(), credential, true);
		if(e != CHIAKI_ERR_SUCCESS)
			return {{"error", std::string("No se pudo despertar la PS5: ") + chiaki_error_string(e)}};
		return {{"ok", true}};
	}
	if(op == "button" && req.value("button", "") == "PS") { // solo lo manda el admin, desde el panel
		// Se suma a lo que mande el jugador durante 150 ms; si nadie juega, se manda solo.
		forced_buttons = CHIAKI_CONTROLLER_BUTTON_PS;
		if(!current_peer())
			release_controller();
		std::this_thread::sleep_for(150ms);
		forced_buttons = 0;
		if(!current_peer())
			release_controller();
		return {{"ok", true}};
	}
	return {{"error", "Operación desconocida"}};
}

// Vigilante: suelta el mando si el jugador calla, corta al vencer el turno aunque web/ no avise
// y libera el cupo de los espectadores que se fueron.
static void watchdog() {
	for(;;) {
		std::this_thread::sleep_for(50ms);
		if(auto p = current_peer()) {
			bool release = false;
			{
				std::lock_guard<std::mutex> l(p->pad_mu);
				if(!p->neutral && Clock::now() - p->last_pad > PAD_TIMEOUT)
					release = p->neutral = true;
			}
			if(release)
				release_controller();
		}
		int64_t exp = expires_at.load();
		if(watcher_count.load()) {
			using S = rtc::PeerConnection::State;
			std::vector<std::shared_ptr<Peer>> gone;
			{
				std::lock_guard<std::mutex> l(peer_mu);
				for(auto it = watchers.begin(); it != watchers.end();) {
					S st = (*it)->pc->state();
					bool dead = st == S::Disconnected || st == S::Failed || st == S::Closed ||
						(st != S::Connected && Clock::now() - (*it)->created > WATCH_CONNECT_TIMEOUT);
					if(dead) {
						gone.push_back(*it);
						it = watchers.erase(it);
					} else
						++it;
				}
				watcher_count = watchers.size();
			}
			for(auto &w : gone) // se cierran fuera del candado y en este hilo, no dentro de su propio callback
				w->pc->close();
		}
		if(exp && now_ms() >= exp && expires_at.compare_exchange_strong(exp, 0)) { // no pisa un turno recién iniciado
			peer_close();
			watchers_close();
			session_close();
		}
	}
}

extern "C" int serve_main(const char *keys_path, const char *socket_path, int port, const char *public_addr) {
	try {
		json keys = json::parse(std::ifstream(keys_path));
		ps5_host = keys.at("host").get<std::string>();
		ps5_regist_key = keys.at("regist_key").get<std::string>();
		std::string morning = keys.at("morning").get<std::string>();
		if(morning.size() != 32)
			throw std::runtime_error("morning inválido");
		for(int i = 0; i < 16; i++)
			ps5_morning[i] = uint8_t(std::stoi(morning.substr(2 * i, 2), nullptr, 16));
	} catch(const std::exception &e) {
		std::cerr << "Archivo de claves inválido (" << keys_path << "): " << e.what() << std::endl;
		return 1;
	}
	udp_port = uint16_t(port);
	if(public_addr && *public_addr) { // host:puerto del túnel; el navegador solo acepta IP, así que se resuelve aquí
		std::string s = public_addr;
		size_t colon = s.rfind(':');
		addrinfo hints = {}, *res = nullptr;
		hints.ai_family = AF_INET;
		if(colon == std::string::npos || getaddrinfo(s.substr(0, colon).c_str(), nullptr, &hints, &res) != 0 || !res) {
			std::cerr << "Dirección pública inválida (se espera host:puerto): " << s << std::endl;
			return 1;
		}
		char ip[INET_ADDRSTRLEN];
		inet_ntop(AF_INET, &reinterpret_cast<sockaddr_in *>(res->ai_addr)->sin_addr, ip, sizeof(ip));
		freeaddrinfo(res);
		public_ip = ip;
		public_port = uint16_t(std::stoi(s.substr(colon + 1)));
	}
	signal(SIGPIPE, SIG_IGN); // si web/ cuelga antes de leer la respuesta, write() falla en vez de matar el proceso
	chiaki_log_init(&ps5_log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, nullptr);
	if(chiaki_lib_init() != CHIAKI_ERR_SUCCESS)
		return 1;
	rtc::InitLogger(rtc::LogLevel::Warning);

	sockaddr_un addr = {};
	addr.sun_family = AF_UNIX;
	if(strlen(socket_path) >= sizeof(addr.sun_path)) {
		std::cerr << "Ruta de socket demasiado larga" << std::endl;
		return 1;
	}
	strcpy(addr.sun_path, socket_path);
	unlink(socket_path);
	umask(0077); // el socket nace 0600: solo el mismo usuario (web/) puede hablarle
	int srv = socket(AF_UNIX, SOCK_STREAM, 0);
	if(srv < 0 || bind(srv, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) < 0 || listen(srv, 4) < 0) {
		perror(socket_path);
		return 1;
	}
	std::thread(watchdog).detach();
	std::cout << "media escuchando en " << socket_path << " · PS5 " << ps5_host << " · UDP " << udp_port
		<< (public_ip.empty() ? " · modo red local" : " · público " + public_ip + ":" + std::to_string(public_port)) << std::endl;

	for(;;) {
		int c = accept(srv, nullptr, nullptr);
		if(c < 0)
			continue;
		timeval tv = {2, 0}; // un cliente que no termina su línea no puede congelar el control
		setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
		std::string line;
		char buf[4096];
		ssize_t n;
		while(line.find('\n') == std::string::npos && line.size() < 64 * 1024 && (n = read(c, buf, sizeof(buf))) > 0)
			line.append(buf, size_t(n));
		json res;
		try {
			res = handle(json::parse(line));
		} catch(const std::exception &e) {
			res = {{"error", std::string("Petición inválida: ") + e.what()}};
		}
		std::string out = res.dump() + "\n";
		(void)!write(c, out.data(), out.size());
		close(c);
	}
}
