// media: servidor de streaming de PS5 Remote Web (en construcción).
//   media discover <ip>                          → pregunta a la consola su estado por la red local.
//   media register <ip> <id-de-cuenta> <pin> <archivo> → registra este equipo y guarda las claves (permisos 600).
#include <chiaki/base64.h>
#include <chiaki/discovery.h>
#include <chiaki/regist.h>
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

int main(int argc, char **argv)
{
	if(argc == 6 && strcmp(argv[1], "register") == 0)
		return cmd_register(argv[2], argv[3], argv[4], argv[5]);
	if(argc == 3 && strcmp(argv[1], "discover") == 0)
		return cmd_discover(argv[2]);
	fprintf(stderr, "Uso: media discover <ip>\n     media register <ip> <id-de-cuenta-base64> <pin> <archivo-de-claves>\n");
	return 2;
}
