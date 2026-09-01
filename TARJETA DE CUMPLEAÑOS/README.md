# Invitacion digital interactiva de cumpleanos

Proyecto web completo para compartir una invitacion de cumpleanos por WhatsApp. Incluye invitacion publica, cuenta regresiva, ubicacion con Google Maps, confirmacion de asistencia, panel privado de administracion, estadisticas y notificaciones.

## Requisitos

- Node.js 22.5 o superior.
- npm.

## Instalacion

```bash
npm install
copy .env.example .env
npm run dev
```

Abre:

- Invitacion: `http://localhost:3000`
- Administracion: `http://localhost:3000/admin`

Credenciales iniciales:

- Usuario: `admin`
- Contrasena: `admin123`

Cambia `ADMIN_USER`, `ADMIN_PASSWORD` y `SESSION_SECRET` en `.env` antes de publicar.

## Que se puede editar desde el panel

- Nombre, frases, fecha, hora, lugar, direccion y datos adicionales.
- Colores principales, fondo, superficie, texto, fuente y tema.
- Imagen de portada.
- Fotografia principal: subir, eliminar y marcar como portada.
- URL de Google Maps.
- Mensaje de confirmacion.
- Confirmaciones recibidas y estadisticas de asistencia.

## Notificaciones

Todas las confirmaciones quedan registradas como notificaciones dentro del panel. Para recibirlas por correo, configura estas variables en `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=tu-app-password
NOTIFY_EMAIL=tu-correo@gmail.com
```

Para Gmail se recomienda usar una clave de aplicacion, no la contrasena normal de la cuenta.

## Compartir por WhatsApp

La invitacion tiene un boton de compartir. En celulares usa el menu nativo del dispositivo y en computadoras abre WhatsApp Web. Para que WhatsApp muestre una vista previa atractiva al enviar el enlace, publica el proyecto en internet y define:

```env
PUBLIC_URL=https://tu-dominio.com
```

Tambien conviene subir una foto principal desde el panel, porque esa imagen se usa como portada y como imagen de vista previa cuando esta disponible.

## Publicacion en internet

Opciones sencillas:

- Render, Railway, Fly.io o un VPS con Node.
- Configurar `PORT`, `PUBLIC_URL`, `SESSION_SECRET`, `ADMIN_USER` y `ADMIN_PASSWORD`.
- Asegurar que las carpetas `data/` y `uploads/` sean persistentes para no perder RSVP ni fotos.

Ejemplo de comando de produccion:

```bash
npm install
npm start
```

## Estructura

- `server.js`: backend Express, autenticacion, SQLite, fotos, RSVP y notificaciones.
- `public/index.html`: invitacion publica.
- `public/admin.html`: panel privado.
- `public/assets/styles.css`: diseno responsive y temas.
- `public/assets/app.js`: logica de invitacion.
- `public/assets/admin.js`: logica de administracion.
- `data/birthday.sqlite`: base de datos local creada automaticamente.
- `uploads/`: imagenes subidas desde el panel.
