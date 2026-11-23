// media: servidor de streaming de PS5 Remote Web (en construcción).
//   media serve <claves> <socket> [puerto-udp]    → servidor de streaming (ver server.cpp).
//   media discover <ip>                          → pregunta a la consola su estado por la red local.
//   media dump <claves> <salida.h264> [segundos] [--press-x] [--720]
//                                                 → se conecta, guarda el H.264 crudo y opcionalmente aprieta X.
//   media register <ip> <id-de-cuenta> <pin> <archivo> → registra este equipo y guarda las claves (permisos 600).
#include <chiaki/base64.h>
#include <chiaki/discovery.h>
#include <chiaki/regist.h>
#include <chiaki/session.h>
#include <chiaki/controller.h>
#include <fcntl.h>
#include <stdlib.h>
#include <chiaki/log.h>
#include <arpa/inet.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int found = 0;

static void on_host(ChiakiDiscoveryHost *h, void *user)
{
	(void)user;
	found = 1;
	printf("estado:   %s\n", chiaki_discovery_host_state_string(h->state));
	printf("consola:  %s (%s)\n", h->host_name ? h->host_name : "?", h->host_type ? h->host_type : "?");
	printf("sistema:  %s\n", h->system_version ? h->system_version : "?");
	printf("puerto:   %hu\n", (unsigned short)h->host_request_port);
	if(h->running_app_name)
		printf("jugando:  %s\n", h->running_app_name);
}

static int cmd_discover(const char *ip)
{
	ChiakiLog log;
	chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, NULL);

	struct sockaddr_in addr = { 0 };
	addr.sin_family = AF_INET;
	addr.sin_port = htons(CHIAKI_DISCOVERY_PORT_PS5);
	if(inet_pton(AF_INET, ip, &addr.sin_addr) != 1)
	{
		fprintf(stderr, "IP inválida: %s\n", ip);
		return 1;
	}

	ChiakiDiscovery discovery;
	ChiakiDiscoveryThread thread;
	if(chiaki_discovery_init(&discovery, &log, AF_INET) != CHIAKI_ERR_SUCCESS
		|| chiaki_discovery_thread_start_oneshot(&thread, &discovery, on_host, NULL) != CHIAKI_ERR_SUCCESS)
	{
		fprintf(stderr, "No se pudo iniciar el descubrimiento\n");
		return 1;
	}

	ChiakiDiscoveryPacket packet = { 0 };
	packet.cmd = CHIAKI_DISCOVERY_CMD_SRCH;
	packet.protocol_version = CHIAKI_DISCOVERY_PROTOCOL_VERSION_PS5;
	chiaki_discovery_send(&discovery, &packet, (struct sockaddr *)&addr, sizeof(addr));

	for(int i = 0; i < 20 && !found; i++) // hasta 2 s
		usleep(100 * 1000);

	chiaki_discovery_thread_stop(&thread);
	chiaki_discovery_fini(&discovery);
	if(!found)
		fprintf(stderr, "La consola no respondió en %s (¿apagada del todo o en otra red?)\n", ip);
	return found ? 0 : 1;
}

static int regist_result = -1; // -1 esperando, 0 ok, 1 falló
static const char *regist_out;
static const char *regist_host;

static void on_regist(ChiakiRegistEvent *ev, void *user)
{
	(void)user;
	if(ev->type != CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS || !ev->registered_host)
	{
		regist_result = 1;
		return;
	}
	ChiakiRegisteredHost *h = ev->registered_host;
	// Las claves son secretos: el archivo nace con 0600 y nunca se imprimen.
	int fd = open(regist_out, O_WRONLY | O_CREAT | O_TRUNC, 0600);
	FILE *f = fd >= 0 ? fdopen(fd, "w") : NULL;
	if(!f)
	{
		perror(regist_out);
		regist_result = 1;
		return;
	}
	char key[CHIAKI_SESSION_AUTH_SIZE + 1] = { 0 };
	memcpy(key, h->rp_regist_key, CHIAKI_SESSION_AUTH_SIZE);
	fprintf(f, "{\n  \"host\": \"%s\",\n  \"regist_key\": \"%s\",\n  \"morning\": \"", regist_host, key);
	for(size_t i = 0; i < sizeof(h->rp_key); i++)
		fprintf(f, "%02x", h->rp_key[i]);
	fprintf(f, "\"\n}\n");
	fclose(f);
	printf("Registrada: %.*s. Claves guardadas en %s\n", (int)sizeof(h->server_nickname), h->server_nickname, regist_out);
	regist_result = 0;
}

static int cmd_register(const char *ip, const char *account_b64, const char *pin, const char *out)
{
	ChiakiLog log;
	chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, NULL);

	ChiakiRegistInfo info = { 0 };
	info.target = CHIAKI_TARGET_PS5_1;
	info.host = ip;
	size_t id_size = sizeof(info.psn_account_id);
	if(chiaki_base64_decode(account_b64, strlen(account_b64), info.psn_account_id, &id_size) != CHIAKI_ERR_SUCCESS
		|| id_size != CHIAKI_PSN_ACCOUNT_ID_SIZE)
	{
		fprintf(stderr, "El ID de cuenta debe ser base64 de 8 bytes (12 caracteres, termina en '=')\n");
		return 1;
	}
	char *end;
	unsigned long p = strtoul(pin, &end, 10);
	if(strlen(pin) != 8 || *end)
	{
		fprintf(stderr, "El PIN son 8 dígitos, sin espacios\n");
		return 1;
	}
	info.pin = (uint32_t)p;
	regist_out = out;
	regist_host = ip;

	ChiakiRegist regist;
	if(chiaki_regist_start(&regist, &log, &info, on_regist, NULL) != CHIAKI_ERR_SUCCESS)
	{
		fprintf(stderr, "No se pudo iniciar el registro\n");
		return 1;
	}
	for(int i = 0; i < 150 && regist_result < 0; i++) // hasta 15 s
		usleep(100 * 1000);
	chiaki_regist_stop(&regist);
	chiaki_regist_fini(&regist);
	if(regist_result != 0)
		fprintf(stderr, "Registro rechazado: revisa que el PIN siga vigente y que el ID sea el de la cuenta que muestra el PIN\n");
	return regist_result == 0 ? 0 : 1;
}

// ── dump: spike de la Fase 1 ─────────────────────────────────────────────────
static FILE *dump_file;
static volatile int dump_connected, dump_quit;
static long v_calls, v_bytes, v_lost, v_recovered, a_frames, a_bytes;
static int first_nals[4] = { -1, -1, -1, -1 };

static int first_nal_type(const uint8_t *b, size_t n)
{
	for(size_t i = 0; i + 4 < n; i++)
		if(b[i] == 0 && b[i + 1] == 0 && (b[i + 2] == 1 || (b[i + 2] == 0 && b[i + 3] == 1)))
			return b[i + (b[i + 2] == 1 ? 3 : 4)] & 0x1f;
	return -1;
}

// Corre en el hilo de red de chiaki: solo escribir y contar, nada que bloquee.
static bool on_video(uint8_t *buf, size_t size, int32_t frames_lost, bool recovered, void *user)
{
	(void)user;
	if(v_calls < 4)
		first_nals[v_calls] = first_nal_type(buf, size);
	fwrite(buf, 1, size, dump_file);
	v_calls++;
	v_bytes += (long)size;
	v_lost += frames_lost;
	v_recovered += recovered;
	return true;
}

static void on_audio_header(ChiakiAudioHeader *h, void *user)
{
	(void)user;
	printf("audio:    %u canales, %u Hz, %u bits, %u muestras por cuadro\n", h->channels, h->rate, h->bits, h->frame_size);
}

static void on_audio_frame(uint8_t *buf, size_t size, void *user)
{
	(void)buf; (void)user;
	a_frames++;
	a_bytes += (long)size;
}

static void on_event(ChiakiEvent *e, void *user)
{
	(void)user;
	if(e->type == CHIAKI_EVENT_CONNECTED)
		dump_connected = 1;
	else if(e->type == CHIAKI_EVENT_LOGIN_PIN_REQUEST)
		printf("La consola pide el código de acceso del usuario (no soportado todavía)\n");
	else if(e->type == CHIAKI_EVENT_VIDEO_FEC_FAILURE)
		printf("FEC falló en el cuadro %d (IDR pedido: %s)\n", e->video_fec_failure.frame_index, e->video_fec_failure.idr_request_sent ? "sí" : "no");
	else if(e->type == CHIAKI_EVENT_QUIT)
	{
		printf("sesión terminada: %s%s%s\n", chiaki_quit_reason_string(e->quit.reason), e->quit.reason_str ? " · " : "", e->quit.reason_str ? e->quit.reason_str : "");
		dump_quit = 1;
	}
}

/** Lee "clave": "valor" del archivo que escribe `register` (formato propio, no JSON general). */
static int read_key(const char *text, const char *key, char *out, size_t out_size)
{
	char pat[64];
	snprintf(pat, sizeof(pat), "\"%s\": \"", key);
	const char *p = strstr(text, pat);
	if(!p)
		return 0;
	p += strlen(pat);
	const char *end = strchr(p, '"');
	if(!end || (size_t)(end - p) >= out_size)
		return 0;
	memcpy(out, p, (size_t)(end - p));
	out[end - p] = 0;
	return 1;
}

static int cmd_dump(const char *keys_path, const char *out_path, int seconds, int press_x, int hd720)
{
	char text[1024] = { 0 }, host[64], key[CHIAKI_SESSION_AUTH_SIZE + 1], morning_hex[33];
	FILE *kf = fopen(keys_path, "r");
	if(!kf || fread(text, 1, sizeof(text) - 1, kf) == 0)
	{
		perror(keys_path);
		return 1;
	}
	fclose(kf);
	if(!read_key(text, "host", host, sizeof(host)) || !read_key(text, "regist_key", key, sizeof(key))
		|| !read_key(text, "morning", morning_hex, sizeof(morning_hex)) || strlen(morning_hex) != 32)
	{
		fprintf(stderr, "Archivo de claves inválido: %s\n", keys_path);
		return 1;
	}

	ChiakiLog log;
	chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, NULL);
	if(chiaki_lib_init() != CHIAKI_ERR_SUCCESS)
		return 1;

	ChiakiConnectInfo info = { 0 };
	info.ps5 = true;
	info.host = host;
	strncpy(info.regist_key, key, sizeof(info.regist_key)); // rellena con \0
	for(int i = 0; i < 16; i++)
		sscanf(morning_hex + 2 * i, "%2hhx", &info.morning[i]);
	chiaki_connect_video_profile_preset(&info.video_profile,
		hd720 ? CHIAKI_VIDEO_RESOLUTION_PRESET_720p : CHIAKI_VIDEO_RESOLUTION_PRESET_1080p, CHIAKI_VIDEO_FPS_PRESET_60);
	info.video_profile.codec = CHIAKI_CODEC_H264; // Chrome lo decodifica sin recomprimir
	info.enable_idr_on_fec_failure = true;

	dump_file = fopen(out_path, "wb");
	if(!dump_file)
	{
		perror(out_path);
		return 1;
	}

	ChiakiSession session;
	ChiakiErrorCode err = chiaki_session_init(&session, &info, &log);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		fprintf(stderr, "chiaki_session_init: %s\n", chiaki_error_string(err));
		return 1;
	}
	ChiakiAudioSink sink = { .user = NULL, .header_cb = on_audio_header, .frame_cb = on_audio_frame };
	chiaki_session_set_audio_sink(&session, &sink);
	chiaki_session_set_video_sample_cb(&session, on_video, NULL);
	chiaki_session_set_event_cb(&session, on_event, NULL);
	chiaki_session_start(&session);

	for(int i = 0; i < 200 && !dump_connected && !dump_quit; i++) // hasta 20 s
		usleep(100 * 1000);
	if(dump_connected)
	{
		printf("conectado: %ux%u a %u fps, %u kbps pedidos\n", info.video_profile.width, info.video_profile.height, info.video_profile.max_fps, info.video_profile.bitrate);
		for(int tenth = 0; tenth < seconds * 10 && !dump_quit; tenth++)
		{
			if(press_x && tenth == seconds * 5) // a la mitad: X apretada 100 ms
			{
				ChiakiControllerState st;
				chiaki_controller_state_set_idle(&st);
				st.buttons = CHIAKI_CONTROLLER_BUTTON_CROSS;
				chiaki_session_set_controller_state(&session, &st);
				usleep(100 * 1000);
				chiaki_controller_state_set_idle(&st);
				chiaki_session_set_controller_state(&session, &st);
				printf("X apretada 100 ms\n");
				continue;
			}
			usleep(100 * 1000);
		}
	}
	else if(!dump_quit)
		fprintf(stderr, "No conectó en 20 s\n");

	chiaki_session_stop(&session);
	chiaki_session_join(&session);
	chiaki_session_fini(&session);
	fclose(dump_file);

	if(v_calls > 1)
	{
		printf("video:    %ld cuadros en %d s (%.1f fps), %.1f Mbps, %ld perdidos, %ld recuperados\n",
			v_calls - 1, seconds, (double)(v_calls - 1) / seconds, (double)v_bytes * 8 / seconds / 1e6, v_lost, v_recovered);
		printf("NAL inicial de las 4 primeras entregas: %d %d %d %d  (7 = SPS, 5 = IDR, 1 = cuadro P)\n", first_nals[0], first_nals[1], first_nals[2], first_nals[3]);
		printf("audio:    %ld paquetes Opus, %.0f kbps\n", a_frames, (double)a_bytes * 8 / seconds / 1e3);
	}
	return dump_connected && v_calls > 1 ? 0 : 1;
}

int serve_main(const char *keys_path, const char *socket_path, int port); // server.cpp

int main(int argc, char **argv)
{
	if(argc >= 4 && strcmp(argv[1], "serve") == 0)
		return serve_main(argv[2], argv[3], argc > 4 ? atoi(argv[4]) : 50000);
	if(argc >= 4 && strcmp(argv[1], "dump") == 0)
	{
		int seconds = 10, press_x = 0, hd720 = 0;
		for(int i = 4; i < argc; i++)
		{
			if(strcmp(argv[i], "--press-x") == 0) press_x = 1;
			else if(strcmp(argv[i], "--720") == 0) hd720 = 1;
			else seconds = atoi(argv[i]);
		}
		if(seconds < 1 || seconds > 600)
			seconds = 10;
		return cmd_dump(argv[2], argv[3], seconds, press_x, hd720);
	}
	if(argc == 6 && strcmp(argv[1], "register") == 0)
		return cmd_register(argv[2], argv[3], argv[4], argv[5]);
	if(argc == 3 && strcmp(argv[1], "discover") == 0)
		return cmd_discover(argv[2]);
	fprintf(stderr, "Uso: media serve <claves> <socket> [puerto-udp]\n     media discover <ip>\n     media dump <claves> <salida.h264> [segundos] [--press-x] [--720]\n     media register <ip> <id-de-cuenta-base64> <pin> <archivo-de-claves>\n");
	return 2;
}
