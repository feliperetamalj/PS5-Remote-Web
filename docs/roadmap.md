# Roadmap

Hay una compuerta después de las Fases 0 y 2: si los números de latencia no dan, se para y se le informa a Felipe. Cada medición queda en [`mediciones.md`](mediciones.md).

| Fase | Qué | Estado |
|---|---|---|
| F-1 | Repo, Homebrew y dependencias | Hecho (falta la URL del repo) |
| F0 | Línea base: TV directa contra chiaki-ng a 1080p60 y 720p60 | Pendiente (necesita a Felipe) |
| F1 | Spike de libchiaki: guardar `.h264` y apretar X por script | Hecho (resultados en `decisiones.md`) |
| F2 | WebRTC en LAN: video y audio sin recomprimir, mando por DataChannel | Pendiente |
| F3 | Web app: cuentas, reservas, fila, admin y pantalla de juego | Hecho, sin streaming real |
| F4 | Integración `web/` ↔ `media/`: turnos, corte al vencer, estadísticas | Pendiente |
| F4b | Modo espectador (ADR-003) | Pendiente |
| F5 | **Primero:** cambiar el registro de Remote Play de la cuenta principal a una cuenta de invitados. Luego internet: CGNAT, puerto UDP, playit.gg con HTTPS, usuario `ps5stream`, revisiones de seguridad | Pendiente |
| F6 | Traspaso a OpenClaw: scripts, launchd y runbook | Pendiente |
| F7 | Prueba real: un amigo en Santiago juega 30 min | Pendiente |

## F4b · Modo espectador

Solo se empieza cuando F2 cumple la meta (latencia agregada ≤ 10 ms sobre F0 con un jugador).

**`media/`**
- Nueva operación `watch` en el socket de control: recibe un SDP y devuelve la respuesta, igual que `start`.
- Los espectadores reciben los mismos paquetes RTP de video y audio. No se crea DataChannel `pad` para ellos y se rechaza cualquier DataChannel que abran.
- Tope de espectadores configurable (por defecto 4).
- El pedido de cuadro clave de un espectador (al entrar o por pérdida) se limita a uno cada 3 s en total, para no degradar al jugador.
- Al terminar el turno se cierran también todos los espectadores.

**`web/`**
- `POST /api/watch/offer`: solo cuentas aprobadas, solo si hay alguien jugando, y respeta el tope.
- Página "Ver en vivo" en `/app`, visible cuando la consola está ocupada. Sin mando, con audio opcional.
- El jugador ve "N personas mirando". El admin ve la lista y tiene un interruptor para apagar el modo.

**Listo cuando**
- Con 4 espectadores, la latencia del jugador no sube más de 2 ms respecto de F2 y no hay cuadros perdidos de más. Queda medido en `mediciones.md`.
- Un espectador no puede mandar input: probado enviando paquetes por un DataChannel propio.
