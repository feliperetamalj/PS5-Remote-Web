// media: servidor de streaming de PS5 Remote Web (en construcción).
// Por ahora solo:  media discover <ip>   → pregunta a la consola su estado por la red local.
#include <chiaki/discovery.h>
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

int main(int argc, char **argv)
{
	if(argc == 3 && strcmp(argv[1], "discover") == 0)
		return cmd_discover(argv[2]);
	fprintf(stderr, "Uso: media discover <ip-de-la-ps5>\n");
	return 2;
}
