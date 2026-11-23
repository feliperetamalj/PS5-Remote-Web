# Decisiones (ADR)

## ADR-000: Arquitectura general

**Estado:** Aceptada · **Fecha:** 2026-11-22 · **Decide:** Felipe

### Contexto
Se quiere jugar la PS5 de Felipe desde Chrome con la menor latencia posible, con cuentas, reservas por hora aprobadas por Felipe, lista de espera por bloque y una fila en vivo. No hay cobro. Corre en un MacBook Pro Intel 2019 que también aloja Minecraft y OpenClaw, que no se tocan.

### Decisión
Dos procesos:
- `media/` (C++ con libchiaki y libdatachannel). Todo lo de tiempo real: H.264 y Opus sin recomprimir, y el mando por DataChannel.
- `web/` (Node 24 con Hono y `node:sqlite`). Todo lo demás: cuentas, reservas, fila, admin y señalización con un solo POST.

Solo `web/` habla con `media/`, por un socket unix `0600`. La web se publica por playit.gg con dominio propio, y el video va por un único puerto UDP directo.

### Opciones consideradas
| Opción | Complejidad | Latencia | Comentario |
|---|---|---|---|
| A. C++ (media) + Node (web) | Media | Mínima | libchiaki es C, así que media queda sin capas extra. Web en TS, igual que el frontend |
| B. Go + Pion + cgo, un solo binario | Media | Mínima | Callbacks desde hilos C hacia Go y un toolchain más. Se descarta salvo que libdatachannel falle |
| C. Capturar la ventana de chiaki-ng y recomprimir | Baja | +10 a 20 ms | Prohibido por el brief |

### Consecuencias
- Hay dos lenguajes, pero cada uno está donde rinde más.
- `media/` hereda la licencia **AGPL-3.0** de chiaki-ng. El repo se licencia AGPL-3.0 y la página enlaza al código.
- La pila WebRTC se confirma en ADR-001, después del spike de la Fase 1.

## Resultados del spike de la Fase 1 (2026-11-22)

`media dump` contra la PS5 real (chiaki-ng v1.10.1, cable, este Mac), 10 s en la pantalla de ajustes:

| Qué | Resultado |
|---|---|
| Video | H.264 perfil **Main**, nivel 5.0, 1920x1080, yuv420p, sin cuadros B, 61,4 cuadros por segundo |
| Orden de entrega | 1.ª llamada: SPS/PPS solo. 2.ª: IDR. Después cuadros P. Hay que anteponer el SPS/PPS guardado a cada IDR |
| Pérdidas en LAN | 0 cuadros perdidos, 0 recuperados |
| Audio | **Opus crudo**, 2 canales, 48 kHz, 480 muestras por paquete (10 ms), unos 66 kbps |
| Mando | X apretada 100 ms por `chiaki_session_set_controller_state`: la consola abrió el diálogo esperado |
| Archivo | `ffmpeg` lo decodifica completo sin errores |

Pendiente para la Fase 2: el bitrate medido (1,4 Mbps) es de una pantalla casi estática; hay que medirlo en juego. Y confirmar que Chrome acepta perfil Main nivel 5.0 por WebRTC (`profile-level-id`).

## ADR-001: Pila WebRTC del servidor

**Estado:** Aceptada · **Fecha:** 2026-11-22

**Decisión:** libdatachannel v0.24.8 (submódulo, estática). El servidor de streaming **ofrece** y el navegador responde, en dos pasos (`/api/play/offer` y `/api/play/answer`). Así los códecs los fija el servidor y el canal `pad` lo crea él; los canales que abra el navegador se ignoran.

**Primera prueba de punta a punta** (este Mac, navegador integrado de la app, PS5 por cable, menú de ajustes):

| Qué | Resultado |
|---|---|
| Video | H.264 de la PS5 sin recomprimir, anunciado como `profile-level-id=4d001f`. El navegador lo decodifica a 60 cuadros por segundo |
| Colchón del navegador | 8 ms con `jitterBufferTarget = 0` |
| Decodificación | 1,3 a 2,1 ms por cuadro |
| Pérdida | 0 paquetes |
| Mando | X enviada por el DataChannel `pad` con un mando simulado: la consola cerró el diálogo |

Falta: medir con cámara lenta (Fase 0 y Fase 2), probar desde otro computador de la red, con un mando real y con un juego en movimiento.
## ADR-002: Passthrough H.264 vs recompresión (pendiente de Fase 2)

## ADR-003: Modo espectador

**Estado:** Aceptada · **Fecha:** 2026-11-22 · **Decide:** Felipe

### Contexto
Felipe quiere que los demás amigos puedan ver en vivo la partida de quien está jugando.

### Decisión
`media/` reenvía los mismos paquetes H.264 y Opus a peers adicionales de solo recepción. Un espectador no tiene DataChannel `pad`, así que no puede mandar ningún input. `web/` expone `POST /api/watch/offer` solo a cuentas aprobadas y con un tope de espectadores.

### Consecuencias
- No se recomprime nada: cada espectador cuesta unos 15 Mbps de subida, que la fibra de 940 Mbps aguanta de sobra.
- Cuando entra un espectador hay que pedirle un cuadro clave a la PS5, y eso le produce un salto breve de calidad al jugador. Se limita a un pedido cada pocos segundos y se mide en la Fase 2.
- El jugador ve un aviso de "N personas mirando", y Felipe puede apagar el modo desde el panel.
- Se construye después de que el stream de un solo jugador cumpla la meta de latencia, no antes.
