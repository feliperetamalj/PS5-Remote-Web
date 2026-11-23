# Seguridad: modelo de amenazas

Objetivo: el amigo solo puede **jugar**. No debe poder entrar al Mac, al sistema de la PS5 ni a la cuenta PSN de Felipe.

## Superficie expuesta
| Entrada | Quién llega | Defensa |
|---|---|---|
| HTTPS (playit.gg → `127.0.0.1:8080`) | Cualquiera en internet | Login, cuentas pendientes hasta que se aprueban, límite de intentos, CSP estricta, revisión de `Origin`, cookies `__Host-` con HttpOnly, Secure y SameSite=Strict, validación en cada endpoint, SQL parametrizado, límite de tamaño del cuerpo de cada petición |
| UDP (1 puerto, WebRTC) | Quien tenga un SDP válido | ICE (ufrag y pwd por sesión), DTLS y SRTP. Un solo peer a la vez. Solo se acepta el DataChannel `pad`, con mensajes de exactamente 16 bytes |
| Socket unix de `media` | Solo procesos locales del usuario `ps5stream` | Permisos `0600` y lista blanca de comandos |

No se abre ningún puerto TCP en el router. No se expone SSH ni el panel de administración en otro puerto.

## Amigo → sistema de la PS5
1. **Filtro en el servidor:** `buttons &= ALLOWED_MASK`. Se bloquean **PS** (menú de inicio) y **Create** (`CHIAKI_CONTROLLER_BUTTON_SHARE`, capturas y transmisiones). Solo el admin puede enviar PS, desde el panel, para casos de emergencia.
2. **Cuenta PSN de invitados** (checklist para Felipe). **Pendiente obligatorio antes de la Fase 5:** durante el desarrollo el registro se hace con la cuenta principal de Felipe, solo para medir en la red local. Antes de abrir a internet hay que crear la cuenta de invitados, registrar de nuevo con ella y borrar el registro de la cuenta principal (Ajustes → Sistema → Uso a distancia → Historial de conexiones).
   - [ ] Crear una cuenta "miembro de la familia" dedicada (por ejemplo `felipe-invitados`), con **límite de gasto 0**, comunicación y chat de voz restringidos, y el nivel de edad que permita GTA 6.
   - [ ] Iniciar sesión con ella en la PS5 y registrar Remote Play **con esa cuenta**. Como la PS5 es la consola principal de Felipe, el juego y PS Plus se comparten.
   - [ ] En la cuenta principal de Felipe: pedir contraseña en cada compra (Ajustes → Usuarios y cuentas → Cuenta → Pago).
   - [ ] Restricciones de la consola: código de acceso para cambiar ajustes del sistema.
3. Las tiendas dentro del juego llevan a PS Store con la cuenta de invitados, que tiene límite de gasto 0, así que no hay riesgo.

## Internet → Mac
- `web` y `media` corren como el usuario **`ps5stream`** (estándar, sin admin y sin shell), con su propio directorio. No puede leer `~elepew`, `~/Server` ni OpenClaw.
- El Firewall de macOS solo permite conexiones entrantes al binario `media`.
- Perfil `sandbox-exec` opcional para `media` (lectura de su directorio y red).
- Secretos (clave de registro de la PS5, `morning`) en `config.json` `0600`, nunca en git.
- Dependencias fijadas (`package-lock.json` y submódulos en un commit fijo). Revisar si hay versiones nuevas de libdatachannel.

## Cuentas
- Contraseñas con scrypt (`node:crypto`) y sal aleatoria. Mínimo 10 caracteres.
- La sesión es un token aleatorio de 32 bytes. En la base de datos solo queda su SHA-256. Vence a los 14 días.
- Los registros nuevos quedan `pending`. El admin se crea por CLI (`npm run admin:create`) y nunca desde la web.
- Las respuestas de login no revelan si el email existe. El registro sí avisa cuando un correo ya tiene cuenta: sin verificación por correo no hay forma limpia de evitarlo, y se acepta para un sitio entre conocidos.
- **Riesgo aceptado por ahora:** los límites de intentos son globales y por correo, no por IP, porque detrás del túnel todas las visitas llegan desde `127.0.0.1`. Alguien que insista desde internet puede dejar bloqueado el inicio de sesión de todos durante 15 minutos (las sesiones ya abiertas siguen). Se corrige cuando se confirme qué cabecera entrega playit con la IP real.

## Revisión de seguridad del 2026-11-22

Revisión independiente del código de `web/server` y `media/src`. Encontró 2 defectos altos, 4 medios y 9 bajos; ninguno daba acceso al Mac ni permitía apretar PS o Create. Corregidos:

- `media` moría por SIGPIPE si `web` colgaba antes de leer la respuesta; ahora se ignora la señal.
- Carrera al abrir y cerrar la sesión con la PS5 justo en el cambio de turno; ahora hay un candado de ciclo de vida.
- El turno se revalida después de cortar la conexión anterior, y el barrido compara también el usuario.
- Al arrancar, `web` corta cualquier stream que haya quedado de antes y reintenta los cortes que fallen.
- Devolver una cuenta a "pendiente" ahora también cancela sus reservas y su turno.
- El control de `media` ya no se congela con un cliente lento; `start` y `extend` exigen un vencimiento válido; un `start` fallido suelta la consola.
- El botón PS de emergencia del admin ya no lo pisa el mando del jugador.
- Las ofertas de conexión se atienden en serie.

Quedan abiertos los dos puntos marcados arriba como pendiente y riesgo aceptado.

## Privacidad
- WebRTC le muestra al amigo la IP pública del Mac. Es inevitable si el video va directo y se acepta.
- **Pendiente para la etapa 2:** hoy la oferta SDP incluye también las IP locales del Mac (hacen falta para jugar dentro de la red de la casa). Antes de abrir el UDP a internet hay que publicar solo la IP pública y rechazar candidatos privados en la respuesta del navegador.
- Solo se guardan nombre, email y el historial de sesiones con métricas de red.
