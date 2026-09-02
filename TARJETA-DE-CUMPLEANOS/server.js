import 'dotenv/config';
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'birthday.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    alt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_main INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rsvps (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    status TEXT NOT NULL,
    companions INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

const defaultSettings = {
  celebrantName: 'Muriel',
  invitationTitle: 'Estas invitado a celebrar un dia muy especial',
  mainPhrase: '¡Celebremos juntos!',
  personalMessage: 'Ven a celebrar conmigo una noche inolvidable.',
  eventDate: '2026-12-20',
  eventTime: '20:00',
  celebration: 'Cumpleanos',
  venueName: 'Salon de eventos',
  address: 'Av. Principal 123, Lima',
  locationReference: 'A una cuadra del parque central',
  mapsUrl: 'https://www.google.com/maps',
  extraInfo: 'Dress code: elegante casual.',
  confirmationMessage: 'Gracias por confirmar tu asistencia. Nos encantara celebrar contigo.',
  theme: 'elegante',
  primaryColor: '#08245c',
  secondaryColor: '#c8a247',
  backgroundColor: '#f7f3ea',
  surfaceColor: '#ffffff',
  textColor: '#091833',
  fontFamily: 'Montserrat',
  coverImage: '',
  previewText: 'Acompananos a celebrar un cumpleanos inolvidable.',
  adminNotice: 'Recuerda cambiar la contrasena antes de publicar la invitacion.'
};

function now() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function getSettings() {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  if (!row) return defaultSettings;
  return { ...defaultSettings, ...JSON.parse(row.data) };
}

function saveSettings(data) {
  const merged = { ...defaultSettings, ...data };
  db.prepare(`
    INSERT INTO settings (id, data, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(JSON.stringify(merged), now());
  return merged;
}

if (!db.prepare('SELECT id FROM settings WHERE id = 1').get()) {
  saveSettings(defaultSettings);
}

function listPhotos() {
  return db.prepare('SELECT id, url, alt, sort_order AS sortOrder, is_main AS isMain, created_at AS createdAt FROM photos ORDER BY sort_order, created_at').all()
    .map((photo) => ({ ...photo, isMain: Boolean(photo.isMain) }));
}

function getStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS count, COALESCE(SUM(companions), 0) AS companions FROM rsvps GROUP BY status').all();
  const base = { total: 0, yes: 0, no: 0, maybe: 0, estimatedAttendees: 0 };
  for (const row of rows) {
    base.total += row.count;
    if (row.status === 'yes') {
      base.yes = row.count;
      base.estimatedAttendees += row.count + row.companions;
    }
    if (row.status === 'no') base.no = row.count;
    if (row.status === 'maybe') base.maybe = row.count;
  }
  return base;
}

function publicInvitationPayload() {
  const settings = getSettings();
  const photos = listPhotos();
  const mainPhoto = photos.find((photo) => photo.isMain) || null;
  return {
    settings: {
      ...settings,
      coverImage: settings.coverImage || mainPhoto?.url || ''
    },
    photos
  };
}

function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imagenes.'));
    cb(null, true);
  }
});

function mailer() {
  if (!process.env.SMTP_HOST || !process.env.NOTIFY_EMAIL) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

async function notifyRsvp(rsvp) {
  const body = `Nueva confirmacion de asistencia\n\nNombre: ${rsvp.fullName}\nEstado: ${rsvp.statusLabel}\nAcompanantes: ${rsvp.companions}\nMensaje: ${rsvp.message || 'Sin mensaje'}`;
  db.prepare('INSERT INTO notifications (id, title, body, seen, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(uid(), 'Nueva confirmacion de asistencia', body, now());

  const transport = mailer();
  if (!transport) return;
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'invitacion@example.com',
    to: process.env.NOTIFY_EMAIL,
    subject: 'Nueva confirmacion de asistencia',
    text: body
  });
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'birthday_admin',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

app.get('/', (req, res) => {
  const { settings, photos } = publicInvitationPayload();

  const origin = `${req.protocol}://${req.get('host')}`;

  const mainPhoto =
    photos.find((photo) => photo.isMain) ||
    photos[0] ||
    null;

  const imagePath =
    settings.coverImage ||
    mainPhoto?.url ||
    '/assets/social-preview.svg';

  const cover = new URL(imagePath, origin).toString();

  const title = `Cumpleaños de ${settings.celebrantName}`;

  const description =
    settings.previewText ||
    settings.personalMessage ||
    'Te invito a celebrar este día tan especial conmigo.';

  const html = fs
    .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(description))
    .replaceAll('{{IMAGE}}', escapeHtml(cover))
    .replaceAll('{{URL}}', escapeHtml(`${origin}${req.originalUrl}`));

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.type('html').send(html);
});

app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/api/invitation', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  res.json(publicInvitationPayload());
});

app.post('/api/rsvp', async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  const status = String(req.body.status || '').trim();
  const companions = Math.max(0, Math.min(20, Number.parseInt(req.body.companions || '0', 10) || 0));
  const message = String(req.body.message || '').trim().slice(0, 1000);
  const statusLabels = { yes: 'Si asistire', no: 'No podre asistir', maybe: 'Aun no estoy seguro/a' };

  if (!fullName || !statusLabels[status]) {
    return res.status(400).json({ error: 'Completa tu nombre y selecciona una opcion valida.' });
  }

  const rsvp = { id: uid(), fullName, status, statusLabel: statusLabels[status], companions, message, createdAt: now() };
  db.prepare('INSERT INTO rsvps (id, full_name, status, companions, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(rsvp.id, rsvp.fullName, rsvp.status, rsvp.companions, rsvp.message, rsvp.createdAt);

  try {
    await notifyRsvp(rsvp);
  } catch (error) {
    console.error('No se pudo enviar email de notificacion:', error);
  }

  res.status(201).json({ ok: true, message: getSettings().confirmationMessage });
});

app.post('/api/admin/login', async (req, res) => {
  const user = String(req.body.user || '');
  const password = String(req.body.password || '');
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const matches = user === expectedUser && await bcrypt.compare(password, await bcrypt.hash(expectedPassword, 10));
  if (!matches) return res.status(401).json({ error: 'Usuario o contrasena incorrectos.' });
  req.session.admin = { user };
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => res.json({ authenticated: Boolean(req.session?.admin) }));
app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
  const rsvps = db.prepare('SELECT id, full_name AS fullName, status, companions, message, created_at AS createdAt FROM rsvps ORDER BY created_at DESC').all();
  const notifications = db.prepare('SELECT id, title, body, seen, created_at AS createdAt FROM notifications ORDER BY created_at DESC LIMIT 20').all()
    .map((item) => ({ ...item, seen: Boolean(item.seen) }));
  res.json({ ...publicInvitationPayload(), rsvps, stats: getStats(), notifications });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = Object.keys(defaultSettings);
  const next = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) next[key] = String(req.body[key] ?? '');
  }
  res.json({ settings: saveSettings({ ...getSettings(), ...next }) });
});

app.post('/api/admin/photos', requireAdmin, upload.array('photos', 12), (req, res) => {
  const existingCount = db.prepare('SELECT COUNT(*) AS count FROM photos').get().count;
  const insert = db.prepare('INSERT INTO photos (id, url, alt, sort_order, is_main, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  req.files.forEach((file, index) => {
    const id = uid();
    insert.run(id, `/uploads/${file.filename}`, file.originalname, existingCount + index, existingCount === 0 && index === 0 ? 1 : 0, now());
  });
  res.status(201).json({ photos: listPhotos() });
});

app.put('/api/admin/photos/order', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const update = db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?');
  ids.forEach((id, index) => update.run(index, id));
  res.json({ photos: listPhotos() });
});

app.put('/api/admin/photos/:id/main', requireAdmin, (req, res) => {
  db.exec('UPDATE photos SET is_main = 0');
  db.prepare('UPDATE photos SET is_main = 1 WHERE id = ?').run(req.params.id);
  const main = db.prepare('SELECT url FROM photos WHERE id = ?').get(req.params.id);
  if (main) saveSettings({ ...getSettings(), coverImage: main.url });
  res.json({ photos: listPhotos(), settings: getSettings() });
});

app.delete('/api/admin/photos/:id', requireAdmin, (req, res) => {
  const photo = db.prepare('SELECT url FROM photos WHERE id = ?').get(req.params.id);
  if (photo?.url?.startsWith('/uploads/')) {
    const diskPath = path.join(__dirname, photo.url);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  }
  db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
  res.json({ photos: listPhotos() });
});

app.post('/api/admin/notifications/seen', requireAdmin, (_req, res) => {
  db.exec('UPDATE notifications SET seen = 1');
  res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

app.listen(PORT, () => {
  console.log(`Invitacion lista en http://localhost:${PORT}`);
});
