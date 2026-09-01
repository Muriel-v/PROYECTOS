const $ = (selector) => document.querySelector(selector);
let dashboard = null;

boot();

async function boot() {
  const me = await fetchJson('/api/admin/me');
  if (me.authenticated) await showAdmin();
  setupLogin();
}

function setupLogin() {
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#loginError').textContent = '';
    try {
      await fetchJson('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
      });
      await showAdmin();
    } catch (error) {
      $('#loginError').textContent = error.message;
    }
  });
}

async function showAdmin() {
  $('#loginPanel').hidden = true;
  $('#adminPanel').hidden = false;
  await loadDashboard();
  setupSettings();
  setupPhotos();
  $('#logoutButton').onclick = async () => {
    await fetchJson('/api/admin/logout', { method: 'POST' });
    location.reload();
  };
}

async function loadDashboard() {
  dashboard = await fetchJson('/api/admin/dashboard');
  applyAdminTheme(dashboard.settings);
  renderStats(dashboard.stats);
  renderSettings(dashboard.settings);
  renderPhotos(dashboard.photos);
  renderRsvps(dashboard.rsvps);
  renderNotifications(dashboard.notifications);
}

function applyAdminTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--primary', settings.primaryColor);
  root.style.setProperty('--secondary', settings.secondaryColor);
  root.style.setProperty('--surface', '#ffffff');
}

function renderStats(stats) {
  const items = [
    ['Confirmaciones', stats.total],
    ['Asistiran', stats.yes],
    ['No asistiran', stats.no],
    ['No seguros', stats.maybe],
    ['Asistentes estimados', stats.estimatedAttendees]
  ];
  $('#statsGrid').innerHTML = items.map(([label, value]) => `
    <article class="stat-card"><span>${label}</span><strong>${value}</strong></article>
  `).join('');
}

function renderSettings(settings) {
  const form = $('#settingsForm');
  Object.entries(settings).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

function setupSettings() {
  $('#settingsForm').onsubmit = async (event) => {
    event.preventDefault();

    const resultBox = $('#settingsResult');
    const button = event.currentTarget.querySelector('button[type="submit"]');

    const payload = Object.fromEntries(
      new FormData(event.currentTarget).entries()
    );

    button.disabled = true;
    button.textContent = 'Guardando...';

    resultBox.textContent = '';

    try {
      const result = await fetchJson('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      dashboard.settings = result.settings;

      applyAdminTheme(result.settings);
      renderSettings(result.settings);

      resultBox.textContent = '✓ Cambios guardados correctamente.';

      setTimeout(() => {
        resultBox.textContent = '';
      }, 3000);

    } catch (error) {

      resultBox.textContent = `✕ ${error.message}`;

    } finally {

      button.disabled = false;
      button.textContent = 'Guardar cambios';

    }
  };
}

function setupPhotos() {
  $('#photoForm').onsubmit = async (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.photos;
    if (!input.files.length) return;
    const body = new FormData();
    [...input.files].forEach((file) => body.append('photos', file));
    const result = await fetchJson('/api/admin/photos', { method: 'POST', body });
    dashboard.photos = result.photos;
    renderPhotos(result.photos);
    input.value = '';
  };
}

function renderPhotos(photos) {
  if (!photos.length) {
    $('#adminPhotos').innerHTML = '<p class="wide-note">Sube imagenes para activar la galeria.</p>';
    return;
  }
  $('#adminPhotos').innerHTML = photos.map((photo, index) => `
    <article class="admin-photo">
      <img src="${photo.url}" alt="${photo.alt}">
      <div class="photo-actions">
        <button class="btn ghost" type="button" data-action="up" data-id="${photo.id}" ${index === 0 ? 'disabled' : ''}>Subir</button>
        <button class="btn ghost" type="button" data-action="down" data-id="${photo.id}" ${index === photos.length - 1 ? 'disabled' : ''}>Bajar</button>
        <button class="btn secondary" type="button" data-action="main" data-id="${photo.id}">${photo.isMain ? 'Principal' : 'Hacer principal'}</button>
        <button class="btn ghost" type="button" data-action="delete" data-id="${photo.id}">Eliminar</button>
      </div>
    </article>
  `).join('');

  $('#adminPhotos').onclick = async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    await handlePhotoAction(button.dataset.action, button.dataset.id);
  };
}

async function handlePhotoAction(action, id) {
  const photos = [...dashboard.photos];
  const index = photos.findIndex((photo) => photo.id === id);
  if (action === 'up' || action === 'down') {
    const nextIndex = action === 'up' ? index - 1 : index + 1;
    [photos[index], photos[nextIndex]] = [photos[nextIndex], photos[index]];
    const result = await fetchJson('/api/admin/photos/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: photos.map((photo) => photo.id) })
    });
    dashboard.photos = result.photos;
    renderPhotos(result.photos);
  }
  if (action === 'main') {
    const result = await fetchJson(`/api/admin/photos/${id}/main`, { method: 'PUT' });
    dashboard.photos = result.photos;
    dashboard.settings = result.settings;
    renderPhotos(result.photos);
    renderSettings(result.settings);
  }
  if (action === 'delete') {
    const result = await fetchJson(`/api/admin/photos/${id}`, { method: 'DELETE' });
    dashboard.photos = result.photos;
    renderPhotos(result.photos);
  }
}

function renderRsvps(rsvps) {
  const labels = { yes: 'Si asistira', no: 'No asistira', maybe: 'No esta seguro/a' };
  $('#rsvpRows').innerHTML = rsvps.map((rsvp) => `
    <tr>
      <td>${escapeHtml(rsvp.fullName)}</td>
      <td>${labels[rsvp.status] || rsvp.status}</td>
      <td>${rsvp.companions}</td>
      <td>${escapeHtml(rsvp.message || '')}</td>
      <td>${new Date(rsvp.createdAt).toLocaleString('es-PE')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Todavia no hay confirmaciones.</td></tr>';
}

function renderNotifications(notifications) {
  $('#notifications').innerHTML = notifications.slice(0, 4).map((item) => `
    <article class="notification">${escapeHtml(item.body)}</article>
  `).join('');
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ocurrio un error.');
  return data;
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
