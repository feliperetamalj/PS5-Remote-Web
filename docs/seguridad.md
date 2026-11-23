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
2. **Cuenta PSN de invitados** (checklist para Felipe):
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
- Las respuestas de login no revelan si el email existe.

## Privacidad
- WebRTC le muestra al amigo la IP pública del Mac. Es inevitable si el video va directo y se acepta. En producción se quitan del SDP los candidatos con IP privada.
- Solo se guardan nombre, email y el historial de sesiones con métricas de red.
