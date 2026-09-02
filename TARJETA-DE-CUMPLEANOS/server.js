import 'dotenv/config';
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.'
  );
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const STORAGE_BUCKET = 'photos';

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
  confirmationMessage:
    'Gracias por confirmar tu asistencia. Nos encantara celebrar contigo.',
  theme: 'elegante',
  primaryColor: '#08245c',
  secondaryColor: '#c8a247',
  backgroundColor: '#f7f3ea',
  surfaceColor: '#ffffff',
  textColor: '#091833',
  fontFamily: 'Montserrat',
  coverImage: '',
  previewText: 'Acompananos a celebrar un cumpleanos inolvidable.',
  adminNotice:
    'Recuerda cambiar la contrasena antes de publicar la invitacion.'
};

function now() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

/* =========================================================
   SETTINGS
========================================================= */

async function getSettings() {
  const { data, error } = await supabase
    .from('invitation_settings')
    .select('data')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('Error obteniendo settings:', error);
    throw error;
  }

  if (!data) {
    await saveSettings(defaultSettings);
    return defaultSettings;
  }

  return {
    ...defaultSettings,
    ...(data.data || {})
  };
}

async function saveSettings(data) {
  const merged = {
    ...defaultSettings,
    ...data
  };

  const { error } = await supabase
    .from('invitation_settings')
    .upsert(
      {
        id: 1,
        data: merged,
        updated_at: now()
      },
      {
        onConflict: 'id'
      }
    );

  if (error) {
    console.error('Error guardando settings:', error);
    throw error;
  }

  return merged;
}

/* =========================================================
   PHOTOS
========================================================= */

async function listPhotos() {
  const { data, error } = await supabase
    .from('photos')
    .select(
      'id, url, alt, sort_order, is_main, created_at, storage_path'
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error obteniendo fotos:', error);
    throw error;
  }

  return (data || []).map((photo) => ({
    id: photo.id,
    url: photo.url,
    alt: photo.alt,
    sortOrder: photo.sort_order,
    isMain: Boolean(photo.is_main),
    createdAt: photo.created_at,
    storagePath: photo.storage_path || ''
  }));
}

/* =========================================================
   RSVP / ESTADISTICAS
========================================================= */

async function getStats() {
  const { data, error } = await supabase
    .from('rsvps')
    .select('status, companions');

  if (error) {
    console.error('Error obteniendo estadisticas:', error);
    throw error;
  }

  const base = {
    total: 0,
    yes: 0,
    no: 0,
    maybe: 0,
    estimatedAttendees: 0
  };

  for (const row of data || []) {
    base.total += 1;

    if (row.status === 'yes') {
      base.yes += 1;
      base.estimatedAttendees +=
        1 + Number(row.companions || 0);
    }

    if (row.status === 'no') {
      base.no += 1;
    }

    if (row.status === 'maybe') {
      base.maybe += 1;
    }
  }

  return base;
}

/* =========================================================
   PUBLIC PAYLOAD
========================================================= */

async function publicInvitationPayload() {
  const [settings, photos] = await Promise.all([
    getSettings(),
    listPhotos()
  ]);

  const mainPhoto =
    photos.find((photo) => photo.isMain) ||
    photos[0] ||
    null;

  return {
    settings: {
      ...settings,
      coverImage:
        settings.coverImage ||
        mainPhoto?.url ||
        ''
    },
    photos
  };
}

/* =========================================================
   ADMIN
========================================================= */

function requireAdmin(req, res, next) {
  if (req.session?.admin) {
    return next();
  }

  return res.status(401).json({
    error: 'No autorizado'
  });
}

/* =========================================================
   MULTER
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(
        new Error('Solo se permiten imagenes.')
      );
    }

    cb(null, true);
  }
});

/* =========================================================
   EMAIL
========================================================= */

function mailer() {
  if (
    !process.env.SMTP_HOST ||
    !process.env.NOTIFY_EMAIL
  ) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure:
      String(process.env.SMTP_SECURE).toLowerCase() ===
      'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      : undefined
  });
}

async function notifyRsvp(rsvp) {
  const body = `
Nueva confirmacion de asistencia

Nombre: ${rsvp.fullName}
Estado: ${rsvp.statusLabel}
Acompanantes: ${rsvp.companions}
Mensaje: ${rsvp.message || 'Sin mensaje'}
`;

  const { error } = await supabase
    .from('notifications')
    .insert({
      id: uid(),
      title: 'Nueva confirmacion de asistencia',
      body,
      seen: false,
      created_at: now()
    });

  if (error) {
    console.error(
      'Error guardando notificacion:',
      error
    );
  }

  const transport = mailer();

  if (!transport) {
    return;
  }

  await transport.sendMail({
    from:
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      'invitacion@example.com',
    to: process.env.NOTIFY_EMAIL,
    subject: 'Nueva confirmacion de asistencia',
    text: body
  });
}

/* =========================================================
   EXPRESS
========================================================= */

const app = express();

app.set('trust proxy', 1);

app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  session({
    name: 'birthday_admin',
    secret:
      process.env.SESSION_SECRET ||
      crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(
  '/assets',
  express.static(
    path.join(PUBLIC_DIR, 'assets')
  )
);

/* =========================================================
   PAGINA PRINCIPAL
========================================================= */

app.get('/', async (req, res) => {
  try {
    const { settings, photos } =
      await publicInvitationPayload();

    const origin =
      `${req.protocol}://${req.get('host')}`;

    const mainPhoto =
      photos.find((photo) => photo.isMain) ||
      photos[0] ||
      null;

    const imagePath =
      settings.coverImage ||
      mainPhoto?.url ||
      '/assets/social-preview.svg';

    const cover = new URL(
      imagePath,
      origin
    ).toString();

    const title =
      `Cumpleaños de ${settings.celebrantName}`;

    const description =
      settings.previewText ||
      settings.personalMessage ||
      'Te invito a celebrar este día tan especial conmigo.';

    const html = fs
      .readFileSync(
        path.join(PUBLIC_DIR, 'index.html'),
        'utf8'
      )
      .replaceAll(
        '{{TITLE}}',
        escapeHtml(title)
      )
      .replaceAll(
        '{{DESCRIPTION}}',
        escapeHtml(description)
      )
      .replaceAll(
        '{{IMAGE}}',
        escapeHtml(cover)
      )
      .replaceAll(
        '{{URL}}',
        escapeHtml(
          `${origin}${req.originalUrl}`
        )
      );

    res.set({
      'Cache-Control':
        'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0'
    });

    res.type('html').send(html);
  } catch (error) {
    console.error(
      'Error cargando invitacion:',
      error
    );

    res.status(500).send(
      'Error cargando la invitacion.'
    );
  }
});

/* =========================================================
   ADMIN HTML
========================================================= */

app.get('/admin', (_req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, 'admin.html')
  );
});

/* =========================================================
   API INVITATION
========================================================= */

app.get('/api/invitation', async (_req, res) => {
  try {
    res.set({
      'Cache-Control':
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    });

    res.json(
      await publicInvitationPayload()
    );
  } catch (error) {
    console.error(
      'Error en /api/invitation:',
      error
    );

    res.status(500).json({
      error: 'No se pudo cargar la invitacion.'
    });
  }
});

/* =========================================================
   RSVP
========================================================= */

app.post('/api/rsvp', async (req, res) => {
  try {
    const fullName =
      String(
        req.body.fullName || ''
      ).trim();

    const status =
      String(
        req.body.status || ''
      ).trim();

    const companions = Math.max(
      0,
      Math.min(
        20,
        Number.parseInt(
          req.body.companions || '0',
          10
        ) || 0
      )
    );

    const message =
      String(
        req.body.message || ''
      )
        .trim()
        .slice(0, 1000);

    const statusLabels = {
      yes: 'Si asistire',
      no: 'No podre asistir',
      maybe: 'Aun no estoy seguro/a'
    };

    if (
      !fullName ||
      !statusLabels[status]
    ) {
      return res.status(400).json({
        error:
          'Completa tu nombre y selecciona una opcion valida.'
      });
    }

    const rsvp = {
      id: uid(),
      fullName,
      status,
      statusLabel:
        statusLabels[status],
      companions,
      message,
      createdAt: now()
    };

    const { error } = await supabase
      .from('rsvps')
      .insert({
        id: rsvp.id,
        full_name: rsvp.fullName,
        status: rsvp.status,
        companions: rsvp.companions,
        message: rsvp.message,
        created_at: rsvp.createdAt
      });

    if (error) {
      console.error(
        'Error guardando RSVP:',
        error
      );

      return res.status(500).json({
        error:
          'No se pudo guardar la confirmacion.'
      });
    }

    try {
      await notifyRsvp(rsvp);
    } catch (error) {
      console.error(
        'No se pudo enviar email:',
        error
      );
    }

    const settings =
      await getSettings();

    res.status(201).json({
      ok: true,
      message:
        settings.confirmationMessage
    });
  } catch (error) {
    console.error(
      'Error en RSVP:',
      error
    );

    res.status(500).json({
      error:
        'Ocurrio un error al confirmar asistencia.'
    });
  }
});

/* =========================================================
   LOGIN ADMIN
========================================================= */

app.post(
  '/api/admin/login',
  async (req, res) => {
    try {
      const user =
        String(
          req.body.user || ''
        );

      const password =
        String(
          req.body.password || ''
        );

      const expectedUser =
        process.env.ADMIN_USER ||
        'admin';

      const expectedPassword =
        process.env.ADMIN_PASSWORD ||
        'admin123';

      const passwordMatches =
        await bcrypt.compare(
          password,
          await bcrypt.hash(
            expectedPassword,
            10
          )
        );

      if (
        user !== expectedUser ||
        !passwordMatches
      ) {
        return res.status(401).json({
          error:
            'Usuario o contrasena incorrectos.'
        });
      }

      req.session.admin = {
        user
      };

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        'Error en login:',
        error
      );

      res.status(500).json({
        error:
          'No se pudo iniciar sesion.'
      });
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  '/api/admin/logout',
  requireAdmin,
  (req, res) => {
    req.session.destroy(() => {
      res.json({
        ok: true
      });
    });
  }
);

/* =========================================================
   SESION
========================================================= */

app.get(
  '/api/admin/me',
  (req, res) => {
    res.json({
      authenticated:
        Boolean(req.session?.admin)
    });
  }
);

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  '/api/admin/dashboard',
  requireAdmin,
  async (_req, res) => {
    try {
      const [
        invitation,
        rsvpsResult,
        notificationsResult,
        stats
      ] = await Promise.all([
        publicInvitationPayload(),

        supabase
          .from('rsvps')
          .select(
            'id, full_name, status, companions, message, created_at'
          )
          .order(
            'created_at',
            {
              ascending: false
            }
          ),

        supabase
          .from('notifications')
          .select(
            'id, title, body, seen, created_at'
          )
          .order(
            'created_at',
            {
              ascending: false
            }
          )
          .limit(20),

        getStats()
      ]);

      if (rsvpsResult.error) {
        throw rsvpsResult.error;
      }

      if (notificationsResult.error) {
        throw notificationsResult.error;
      }

      const rsvps =
        (rsvpsResult.data || []).map(
          (item) => ({
            id: item.id,
            fullName:
              item.full_name,
            status:
              item.status,
            companions:
              item.companions,
            message:
              item.message,
            createdAt:
              item.created_at
          })
        );

      const notifications =
        (notificationsResult.data || []).map(
          (item) => ({
            id: item.id,
            title:
              item.title,
            body:
              item.body,
            seen:
              Boolean(item.seen),
            createdAt:
              item.created_at
          })
        );

      res.json({
        ...invitation,
        rsvps,
        stats,
        notifications
      });
    } catch (error) {
      console.error(
        'Error en dashboard:',
        error
      );

      res.status(500).json({
        error:
          'No se pudo cargar el panel.'
      });
    }
  }
);

/* =========================================================
   GUARDAR CONFIGURACION
========================================================= */

app.put(
  '/api/admin/settings',
  requireAdmin,
  async (req, res) => {
    try {
      const allowed =
        Object.keys(defaultSettings);

      const current =
        await getSettings();

      const next = {};

      for (const key of allowed) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body,
            key
          )
        ) {
          next[key] =
            String(
              req.body[key] ?? ''
            );
        }
      }

      const settings =
        await saveSettings({
          ...current,
          ...next
        });

      res.json({
        settings
      });
    } catch (error) {
      console.error(
        'Error guardando configuracion:',
        error
      );

      res.status(500).json({
        error:
          'No se pudo guardar la configuracion.'
      });
    }
  }
);

/* =========================================================
   SUBIR FOTOS
========================================================= */

app.post(
  '/api/admin/photos',
  requireAdmin,
  upload.array('photos', 12),
  async (req, res) => {
    try {
      const files = req.files || [];

      if (!files.length) {
        return res.status(400).json({
          error:
            'No se seleccionaron imagenes.'
        });
      }

      const existingPhotos =
        await listPhotos();

      const startOrder =
        existingPhotos.length;

      const insertedPhotos = [];

      for (
        let index = 0;
        index < files.length;
        index++
      ) {
        const file = files[index];

        const extension =
          path
            .extname(
              file.originalname
            )
            .toLowerCase() ||
          '.jpg';

        const storagePath =
          `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;

        const {
          error: uploadError
        } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(
            storagePath,
            file.buffer,
            {
              contentType:
                file.mimetype,
              upsert: false
            }
          );

        if (uploadError) {
          console.error(
            'Error subiendo imagen:',
            uploadError
          );

          throw uploadError;
        }

        const {
          data: publicUrlData
        } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(
            storagePath
          );

        const publicUrl =
          publicUrlData.publicUrl;

        const isMain =
          existingPhotos.length === 0 &&
          index === 0;

        const photo = {
          id: uid(),
          url: publicUrl,
          alt:
            file.originalname,
          sort_order:
            startOrder + index,
          is_main:
            isMain,
          created_at:
            now(),
          storage_path:
            storagePath
        };

        const {
          error: insertError
        } = await supabase
          .from('photos')
          .insert(photo);

        if (insertError) {
          await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([
              storagePath
            ]);

          throw insertError;
        }

        insertedPhotos.push(
          photo
        );
      }

      const photos =
        await listPhotos();

      res.status(201).json({
        photos
      });
    } catch (error) {
      console.error(
        'Error subiendo fotos:',
        error
      );

      res.status(500).json({
        error:
          error?.message ||
          'No se pudieron subir las fotos.'
      });
    }
  }
);

/* =========================================================
   ORDENAR FOTOS
========================================================= */

app.put(
  '/api/admin/photos/order',
  requireAdmin,
  async (req, res) => {
    try {
      const ids =
        Array.isArray(req.body.ids)
          ? req.body.ids
          : [];

      for (
        let index = 0;
        index < ids.length;
        index++
      ) {
        const { error } =
          await supabase
            .from('photos')
            .update({
              sort_order:
                index
            })
            .eq(
              'id',
              ids[index]
            );

        if (error) {
          throw error;
        }
      }

      res.json({
        photos:
          await listPhotos()
      });
    } catch (error) {
      console.error(
        'Error ordenando fotos:',
        error
      );

      res.status(500).json({
        error:
          'No se pudo actualizar el orden.'
      });
    }
  }
);

/* =========================================================
   ESTABLECER FOTO PRINCIPAL
========================================================= */

app.put(
  '/api/admin/photos/:id/main',
  requireAdmin,
  async (req, res) => {
    try {
      const photoId =
        req.params.id;

      const { data: selectedPhoto, error: findError } =
        await supabase
          .from('photos')
          .select(
            'id, url'
          )
          .eq(
            'id',
            photoId
          )
          .maybeSingle();

      if (findError) {
        throw findError;
      }

      if (!selectedPhoto) {
        return res.status(404).json({
          error:
            'Foto no encontrada.'
        });
      }

      const { data: allPhotos, error: listError } =
        await supabase
          .from('photos')
          .select('id');

      if (listError) {
        throw listError;
      }

      for (const photo of allPhotos || []) {
        const { error } =
          await supabase
            .from('photos')
            .update({
              is_main:
                photo.id === photoId
            })
            .eq(
              'id',
              photo.id
            );

        if (error) {
          throw error;
        }
      }

      const settings =
        await getSettings();

      await saveSettings({
        ...settings,
        coverImage:
          selectedPhoto.url
      });

      res.json({
        photos:
          await listPhotos(),
        settings:
          await getSettings()
      });
    } catch (error) {
      console.error(
        'Error estableciendo foto principal:',
        error
      );

      res.status(500).json({
        error:
          'No se pudo establecer la foto principal.'
      });
    }
  }
);

/* =========================================================
   ELIMINAR FOTO
========================================================= */

app.delete(
  '/api/admin/photos/:id',
  requireAdmin,
  async (req, res) => {
    try {
      const photoId =
        req.params.id;

      const {
        data: photo,
        error: findError
      } = await supabase
        .from('photos')
        .select(
          'id, url, storage_path'
        )
        .eq(
          'id',
          photoId
        )
        .maybeSingle();

      if (findError) {
        throw findError;
      }

      if (!photo) {
        return res.status(404).json({
          error:
            'Foto no encontrada.'
        });
      }

      if (photo.storage_path) {
        const {
          error: storageError
        } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([
            photo.storage_path
          ]);

        if (storageError) {
          console.error(
            'No se pudo eliminar archivo de Storage:',
            storageError
          );
        }
      }

      const {
        error: deleteError
      } = await supabase
        .from('photos')
        .delete()
        .eq(
          'id',
          photoId
        );

      if (deleteError) {
        throw deleteError;
      }

      const settings =
        await getSettings();

      if (
        settings.coverImage ===
        photo.url
      ) {
        await saveSettings({
          ...settings,
          coverImage: ''
        });
      }

      res.json({
        photos:
          await listPhotos()
      });
    } catch (error) {
      console.error(
        'Error eliminando foto:',
        error
      );

      res.status(500).json({
        error:
          'No se pudo eliminar la foto.'
      });
    }
  }
);

/* =========================================================
   MARCAR NOTIFICACIONES COMO VISTAS
========================================================= */

app.post(
  '/api/admin/notifications/seen',
  requireAdmin,
  async (_req, res) => {
    try {
      const { error } =
        await supabase
          .from('notifications')
          .update({
            seen: true
          })
          .eq(
            'seen',
            false
          );

      if (error) {
        throw error;
      }

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        'Error actualizando notificaciones:',
        error
      );

      res.status(500).json({
        error:
          'No se pudieron actualizar las notificaciones.'
      });
    }
  }
);

/* =========================================================
   ARCHIVOS PUBLICOS
========================================================= */

app.use(
  express.static(PUBLIC_DIR)
);

/* =========================================================
   MANEJO DE ERRORES
========================================================= */

app.use(
  (error, _req, res, _next) => {
    console.error(
      'Error general:',
      error
    );

    res.status(500).json({
      error:
        error?.message ||
        'Ocurrio un error en el servidor.'
    });
  }
);

/* =========================================================
   INICIAR SERVIDOR
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Invitacion lista en http://localhost:${PORT}`
    );
  }
);