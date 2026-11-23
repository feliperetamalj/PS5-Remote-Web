# Despliegue en el servidor (runbook para OpenClaw)

Este documento es para el agente OpenClaw que corre en el MacBook Pro Intel 2019 de Felipe (usuario `elepew`). Objetivo: dejar PS5 Remote Web corriendo en ese Mac como servicio, primero solo dentro de la red de la casa.

## Reglas

- **No tocar** `~/Server` (Minecraft), la configuración de OpenClaw ni ningún servicio que ya exista en el Mac.
- **No detener nada.** Si la compilación compite por CPU con el servidor de Minecraft, avisarle a Felipe en vez de parar algo.
- **Nunca** subir al repo ni mostrar en un mensaje el contenido de `~/.config/ps5-stream/` (claves de la PS5 y configuración).
- Los pasos marcados **[Felipe]** necesitan su contraseña o una decisión suya: pedírselos y esperar. No intentar resolverlos de otra forma.
- Si un paso falla, parar ahí y reportar el comando y las últimas 20 líneas de salida. No improvisar arreglos fuera del repo.
- No abrir puertos en el router ni cambiar el firewall: eso es de la etapa 2 y lo decide Felipe.

## Qué se instala

| Proceso | Qué hace | Escucha en |
|---|---|---|
| `web` (Node 24) | Página, cuentas, reservas, admin, señalización | `127.0.0.1:8080` (solo local) |
| `media` (C++) | Sesión de Remote Play con la PS5 y video por WebRTC | Socket unix `~/.config/ps5-stream/media.sock` y UDP 50000 |

Archivos fuera del repo: `~/.config/ps5-stream/` (configuración y claves, permisos 700/600), `~/.local/share/ps5-stream/` (base de datos) y `~/Library/Logs/ps5-stream/` (logs).

## Pasos

### 1. Usuario del servicio **[Felipe]**

El servicio debe correr con un usuario sin privilegios, para que no pueda leer el resto del Mac. Felipe lo crea en Ajustes del Sistema → Usuarios y grupos → Añadir usuario, de tipo **Estándar**, con nombre de cuenta `ps5stream`.

Si Felipe prefiere partir con `elepew` para la prueba en red local, se puede: todos los pasos funcionan igual cambiando el usuario. Queda anotado como pendiente obligatorio antes de abrir a internet.

Los pasos 2 a 4 se corren **como ese usuario** (por ejemplo `sudo -iu ps5stream`, que pide la contraseña de Felipe).

### 2. Dependencias

Homebrew ya debería estar en el Mac. Comprobar e instalar lo que falte:

```bash
brew install node cmake pkg-config protobuf curl opus json-c miniupnpc libevent
node --version   # debe ser 24 o superior
```

En Intel, Homebrew vive en `/usr/local`. Si el usuario del servicio no encuentra `brew` o `node`, agregar `/usr/local/bin` a su PATH.

### 3. Código e instalación

```bash
git clone --recurse-submodules git@github.com:feliperetamalj/PS5-Remote-Web.git ~/ps5-remote-web
~/ps5-remote-web/deploy/install.sh
```

`install.sh` es idempotente. Compila `media` (varios minutos la primera vez), instala y compila `web`, corre las pruebas y crea `~/.config/ps5-stream/config.json` desde el ejemplo.

**Riesgo conocido:** la compilación se validó en un Mac con Apple Silicon y macOS 26, donde hicieron falta tres ajustes que están comentados en `media/build.sh` (OpenSSL 4, curl de Homebrew y el generador de protobuf). En Intel puede aparecer otro. Si falla, el detalle queda en `media/build/cmake.log` y `media/build/make.log`: reportar las líneas con `error` y no editar el código de `media/third_party/`.

### 4. Configuración y claves de la PS5

1. Editar `~/.config/ps5-stream/config.json`:
   - `public_origin`: la dirección exacta con la que se abre la página, sin barra final. Con el túnel de playit es `https://ps5remote.felipardo.cl`.
   - Dejar `port` en 8080.
2. Claves de la PS5 (`~/.config/ps5-stream/ps5.json`) **[Felipe]**. Dos caminos:
   - Copiar el archivo desde el Mac de desarrollo de Felipe (`~/.config/ps5-stream/ps5.json`) y dejarlo con `chmod 600`.
   - O registrar de nuevo. Felipe saca un PIN en la PS5 (Ajustes → Sistema → Uso a distancia → Vincular dispositivo) y se corre:
     ```bash
     ~/ps5-remote-web/media/build/out/media register 192.168.100.44 <id-de-cuenta> <pin> ~/.config/ps5-stream/ps5.json
     ```
3. Comprobar que la consola responde:
   ```bash
   ~/ps5-remote-web/media/build/out/media discover 192.168.100.44
   ```
   Debe decir `estado: ready` (o `standby` si está en reposo).

### 5. Servicios **[Felipe: sudo]**

```bash
sudo ~/ps5-remote-web/deploy/install-services.sh ps5stream
```

Escribe `/Library/LaunchDaemons/com.ps5stream.media.plist` y `com.ps5stream.web.plist`, y los carga. Arrancan con el Mac y se reinician solos si caen.

### 6. Cuenta de administrador **[Felipe]**

Como el usuario del servicio, y con Felipe escribiendo la contraseña:

```bash
cd ~/ps5-remote-web/web
PS5_CONFIG=~/.config/ps5-stream/config.json npm run admin:create -- <correo-de-felipe> "Felipe"
```

### 7. Túnel de playit.gg

Felipe ya creó en playit.gg un túnel de tipo **HTTPS** con el dominio `ps5remote.felipardo.cl`. A OpenClaw le toca dejarlo apuntando al servicio:

- Destino local del túnel: `127.0.0.1`, puerto `8080`. Es el único puerto que se publica.
- El túnel termina el HTTPS; `web` sigue hablando HTTP solo en `127.0.0.1`. No instalar certificados ni proxies en el Mac.
- **No** crear un túnel para el puerto UDP 50000 ni para ningún otro: el video va directo por la red, nunca por playit.
- No modificar los túneles que ya existan (por ejemplo, el de Minecraft).
- `public_origin` en `config.json` debe ser exactamente `https://ps5remote.felipardo.cl`. Si no coincide, la página carga pero todo intento de entrar responde "Origen no permitido".

Comprobación: `curl -sI https://ps5remote.felipardo.cl/api/health` responde `200` y trae la cabecera `content-security-policy`.

Desde que este paso funciona, la página de acceso queda visible en internet. Jugar desde fuera de la casa todavía no funciona (falta abrir el UDP, etapa 2), pero las cuentas y el panel sí son alcanzables: por eso el paso 6 (admin con contraseña fuerte) va antes.

### 8. Video desde fuera de la casa (etapa 2, solo cuando Felipe lo pida)

La conexión de Felipe tiene indicios de CGNAT, así que el video de quienes juegan desde fuera entra por un **túnel UDP de playit.gg** (hay nodo en Chile; el túnel HTTPS medía 6 ms desde la casa).

1. En playit, crear un túnel **UDP** con destino local `127.0.0.1`, puerto `50000`.
2. Anotar la dirección y el puerto públicos que playit le asigna.
3. Reinstalar los servicios con esa dirección:
   ```bash
   sudo ~/ps5-remote-web/deploy/install-services.sh ps5stream <host-publico>:<puerto>
   ```
4. `tail ~/Library/Logs/ps5-stream/media.log` debe decir `público <ip>:<puerto>`.

En ese modo el servidor anuncia solo la dirección del túnel y deja de compartir las IP locales del Mac. Los que juegan dentro de la casa también pasan por el túnel.

Antes de este paso, Felipe tiene que haber cambiado el registro de Remote Play a la cuenta PSN de invitados (ver `docs/seguridad.md`).

### 9. Verificar

```bash
~/ps5-remote-web/deploy/ps5ctl.sh status
```

Debe mostrar `web: ok` y `media: ok`. Después:

- `curl -s http://127.0.0.1:8080/api/health` responde `{"ok":true}`.
- `lsof -nP -iTCP:8080 -sTCP:LISTEN` muestra que escucha **solo** en `127.0.0.1`.
- Felipe abre la página, entra como admin y hace una partida de prueba desde otro computador de la red.
- Reiniciar el Mac y repetir `ps5ctl.sh status`: los dos servicios deben volver solos.

## Operación

| Qué | Comando |
|---|---|
| Estado | `deploy/ps5ctl.sh status` |
| Últimos logs | `deploy/ps5ctl.sh logs` |
| Reiniciar | `deploy/ps5ctl.sh restart` (sudo) |
| Detener | `deploy/ps5ctl.sh stop` (sudo) |
| Actualizar | `git pull --recurse-submodules && deploy/install.sh && deploy/ps5ctl.sh restart` |

## Revertir

```bash
~/ps5-remote-web/deploy/ps5ctl.sh stop
sudo rm /Library/LaunchDaemons/com.ps5stream.media.plist /Library/LaunchDaemons/com.ps5stream.web.plist
```

Con eso el Mac queda como antes. El repo, `~/.config/ps5-stream` y `~/.local/share/ps5-stream` se pueden borrar después si Felipe lo pide; no hacerlo por iniciativa propia, porque ahí están las cuentas y las reservas.

## Qué reportarle a Felipe al terminar

- Salida de `ps5ctl.sh status`.
- Cualquier ajuste que haya hecho falta para compilar en Intel, con el comando exacto, para dejarlo en `media/build.sh`.
- Uso de CPU de `media` durante una partida y si afectó al servidor de Minecraft.
- Lo que quedó pendiente (por ejemplo, si se usó `elepew` en vez de `ps5stream`).
