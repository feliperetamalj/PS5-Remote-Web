# Traspaso a OpenClaw: PS5 Remote Web

Este documento te entrega el proyecto para que sigas tú. Lo escribió Claude Code, que hizo el desarrollo en el Mac de Felipe (Apple Silicon). Tú corres en el **MacBook Pro Intel 2019** (usuario `elepew`), que es donde el sistema va a vivir.

Léelo completo antes de ejecutar nada. El paso a paso de instalación está en [`DEPLOY_OPENCLAW.md`](DEPLOY_OPENCLAW.md); este documento te da el contexto, el estado real y el orden del trabajo.

## 1. Qué es

Una página privada para que amigos de Felipe jueguen su PS5 (GTA 6) desde Chrome, con su propio mando. No se cobra.

- Cada persona crea una cuenta, que queda **pendiente** hasta que Felipe la aprueba.
- Se reserva por bloques de 1 hora, y **Felipe confirma cada reserva**. Hay lista de espera por bloque y una fila en vivo para las horas libres.
- Juega una persona a la vez. Al vencer el turno, el stream se corta solo.
- La prioridad técnica es la latencia: el video de la PS5 se reenvía sin recomprimir.

Repo: `git@github.com:feliperetamalj/PS5-Remote-Web.git`, rama `main`.

## 2. Cómo está armado

```
PS5 ──Remote Play (cable, red local)──► media (C++: libchiaki + libdatachannel)
                                           │  ▲ socket unix 0600
                                           │  └── web (Node 24 + Hono + SQLite), solo en 127.0.0.1:8080
                                           │            ▲ HTTPS: túnel de playit.gg → ps5remote.felipardo.cl
                                           ▼            │
                                  video y mando por WebRTC (UDP 50000) ──► Chrome del jugador
```

| Carpeta | Qué hay |
|---|---|
| `web/server` | API: cuentas, reservas, fila, turnos, admin y señalización. Pruebas con `npm test` |
| `web/client` | Página en React: acceso, calendario, fila, pantalla de juego y panel admin |
| `web/shared/pad.ts` | Formato del paquete del mando (16 bytes) |
| `media/src` | `main.c` (comandos `discover`, `register`, `dump`) y `server.cpp` (`serve`) |
| `media/third_party` | chiaki-ng v1.10.1 y libdatachannel v0.24.8, como submódulos. **No editar** |
| `deploy/` | `install.sh`, `install-services.sh`, plantillas de launchd y `ps5ctl.sh` |
| `docs/` | `decisiones.md`, `seguridad.md`, `roadmap.md`, `mediciones.md` y este traspaso |

## 3. Estado real

**Funciona y está probado** (en el Mac de desarrollo, dentro de la red de la casa):

- Felipe jugó desde su Chrome contra la PS5 real: video a 60 cuadros por segundo, audio y mando. Su veredicto fue que anda bien, con muy poca latencia.
- Flujo completo de cuentas: registro, aprobación, reserva, confirmación, turno y fila.
- 9 pruebas automáticas en verde (`cd web && npm test`).

**Escrito pero sin probar en vivo:**

- Las correcciones de la revisión de seguridad del 2026-11-22. Compilan y pasan las pruebas, pero no se ejercitaron con una partida real.
- El modo público de `media` (video por túnel UDP).
- `deploy/install.sh` y `deploy/install-services.sh`: solo pasaron la revisión de sintaxis. `ps5ctl.sh status` sí se probó.
- **Nada se ha compilado en Intel.** En Apple Silicon con macOS 26 hicieron falta tres ajustes, comentados en `media/build.sh`. Espera que aparezca alguno más.

**No hecho:**

- Medición de latencia con cámara lenta (`docs/mediciones.md` está vacío).
- Modo espectador (diseñado en `roadmap.md`, fase F4b; sin código).
- Despertar la PS5 automáticamente antes de un turno. Existe el botón manual en el panel admin.

## 4. Datos del entorno

| Dato | Valor |
|---|---|
| PS5 | `192.168.100.44`, nombre "PS5 Depto", por cable |
| Dominio | `ps5remote.felipardo.cl`, túnel HTTPS de playit.gg ya creado por Felipe |
| Puerto web | `127.0.0.1:8080` |
| Puerto de video | UDP `50000` |
| Internet | Hay indicios de CGNAT (el segundo salto es `100.81.192.1`), así que no se pueden abrir puertos en el router |
| playit.gg | Tiene nodo en Chile. El túnel HTTPS medía 6 ms desde la casa |
| Registro de Remote Play | Hecho con la **cuenta PSN principal** de Felipe, de forma temporal |

Las claves de la PS5 están en el Mac de desarrollo, en `~/.config/ps5-stream/ps5.json`. No están en el repo y no deben estarlo.

## 5. Reglas

1. **No tocar** `~/Server` (Minecraft), tu propia configuración ni ningún servicio existente del Mac. No detener nada.
2. **No tocar los túneles de playit que ya existen.** Solo ajustar el destino del túnel HTTPS de este proyecto y crear el túnel UDP nuevo.
3. **Secretos:** nunca mostrar ni subir el contenido de `~/.config/ps5-stream/`. Nunca pedirle a Felipe su contraseña de PlayStation.
4. **Pasos de Felipe:** todo lo que pida `sudo`, un PIN de la consola o una decisión suya, se le pide y se espera.
5. **No abrir puertos en el router ni cambiar el firewall.**
6. **Si algo falla, parar y reportar** el comando y las últimas 20 líneas de salida. No parchar fuera del repo ni editar `media/third_party/`.
7. **Cambios al código:** commits chicos, mensaje en español, y `cd web && npm test` en verde antes de subir. La documentación va en español.
8. **Honestidad con los números:** lo que midas va tal cual a `docs/mediciones.md`. Si algo no da, se informa con el número.

## 6. Qué te toca, en orden

### Tarea 1: desplegar en este Mac (solo red local)

Sigue [`DEPLOY_OPENCLAW.md`](DEPLOY_OPENCLAW.md), pasos 1 a 6 y 9.

- Lo más probable que falle es la compilación de `media` en Intel. Los registros quedan en `media/build/cmake.log` y `media/build/make.log`.
- Si necesitas un ajuste de compilación, hazlo en `media/build.sh`, coméntalo como los otros tres y súbelo.
- **Listo cuando:** `deploy/ps5ctl.sh status` muestra `web: ok` y `media: ok`, y siguen así después de reiniciar el Mac.

### Tarea 2: conectar el túnel HTTPS

Paso 7 del runbook. Destino local `127.0.0.1:8080`, y `public_origin` exactamente `https://ps5remote.felipardo.cl`.

- Hazlo **después** de que Felipe haya creado su cuenta de admin con contraseña fuerte, porque desde ese momento la página queda visible en internet.
- Averigua qué cabecera envía playit con la IP real del visitante (por ejemplo `X-Forwarded-For`) y repórtala. Hoy los límites de intentos de login no distinguen por IP, y ese dato permite corregirlo.
- **Listo cuando:** Felipe entra a `https://ps5remote.felipardo.cl` desde otro computador de la casa y juega una partida.

### Tarea 3: video desde fuera de la casa

Paso 8 del runbook. **Solo cuando Felipe lo pida**, y después de que haya cambiado el registro de Remote Play a una cuenta PSN de invitados.

- Crear un túnel **UDP** en playit con destino `127.0.0.1:50000` y reinstalar los servicios con su dirección pública.
- Revisar si el plan de playit de Felipe limita el ancho de banda: el video son hasta 15 Mbps continuos por jugador.
- Medir desde el Mac la latencia hacia la dirección del túnel UDP (`ping`). Si pasa de 15 ms, avisar antes de seguir.
- Primera prueba: Felipe desde el celular con datos móviles. Después, un amigo en Santiago durante 30 minutos.
- **Listo cuando:** esa prueba de 30 minutos termina sin cortes y los números del medidor (ping, colchón, pérdida) quedan en `docs/mediciones.md`.

### Tarea 4: vigilar la convivencia con Minecraft

Durante una partida, mide el uso de CPU y memoria de `media` y de `node`, y si el servidor de Minecraft se resiente. Reporta los números.

## 7. Qué revisar si algo no funciona

| Síntoma | Dónde mirar |
|---|---|
| La página carga pero nadie puede entrar ("Origen no permitido") | `public_origin` no coincide con la dirección real |
| "El servidor de streaming no está corriendo" | `deploy/ps5ctl.sh logs`; falta `ps5.json` o el servicio `media` cayó |
| "La PS5 no aceptó la conexión" | La consola está en reposo (botón "Despertar PS5" del admin) o alguien la está usando |
| El mando no se detecta | La página no está en HTTPS, o no es Chrome |
| Conecta pero no llega video | En modo público, la dirección del túnel UDP es incorrecta; `media.log` muestra cuál se anuncia |
| El registro de la PS5 se rechaza | El PIN venció (dura 5 minutos) o el ID de cuenta no es el de la cuenta que mostró el PIN |

Comandos útiles:

```bash
deploy/ps5ctl.sh status
deploy/ps5ctl.sh logs
media/build/out/media discover 192.168.100.44
printf '{"op":"status"}\n' | nc -U ~/.config/ps5-stream/media.sock
```

## 8. Habilidades que conviene usar

No sé qué habilidades tienes instaladas, así que esto describe las capacidades que el trabajo necesita. Usa las equivalentes que tengas:

- **Terminal y git:** todo el despliegue es por línea de comandos.
- **Navegador:** para el panel de playit.gg y para comprobar la página. No necesitas la contraseña de Felipe para nada más.
- **Depuración estructurada:** para la compilación en Intel. Reproduce, aísla y reporta antes de cambiar algo.
- **Lista de verificación de despliegue:** antes de cada tarea, confirma requisitos, cómo verificar y cómo revertir.
- **Revisión de código y de seguridad:** si cambias algo en `web/server` o `media/src`, revísalo antes de subirlo. La revisión anterior y lo que quedó abierto están en `docs/seguridad.md`.
- **Runbook y documentación:** todo ajuste que hagas queda escrito en `DEPLOY_OPENCLAW.md` o en `media/build.sh`.

En el desarrollo se trabajó con una regla de simplicidad que conviene mantener: la solución más chica que funcione, sin dependencias nuevas si la biblioteca estándar alcanza, y sin construir cosas "por si acaso".

## 9. Pendientes que son de Felipe

- Crear el usuario `ps5stream` en el Mac (o autorizar partir con `elepew`).
- Dar la contraseña de `sudo` cuando se instalen los servicios.
- Copiar `ps5.json` desde su Mac de desarrollo o sacar un PIN nuevo en la consola.
- Crear su cuenta de admin.
- Crear la cuenta PSN de invitados y volver a registrar con ella. **Obligatorio antes de la Tarea 3.**
- Las mediciones con cámara lenta.

## 10. Qué reportar al terminar cada tarea

1. Qué hiciste y qué quedó verificado, con la salida de `deploy/ps5ctl.sh status`.
2. Qué no pudiste verificar.
3. Ajustes que hayas hecho al código o a los scripts, con el commit.
4. Números medidos: latencia, CPU y cualquier corte.
5. Qué necesitas de Felipe para la tarea siguiente.
