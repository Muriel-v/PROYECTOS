const state = { settings: null };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

init();

async function init() {
  const response = await fetch('/api/invitation');
  const data = await response.json();
  state.settings = data.settings;
  applyTheme(data.settings);
  renderInvitation();
  startCountdown();
  setupRsvp();
  setupShare();
  setupReveal();
}

function applyTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--primary', '#08245c');
  root.style.setProperty('--secondary', '#c8a247');
  root.style.setProperty('--bg', '#f7f3ea');
  root.style.setProperty('--surface', '#ffffff');
  root.style.setProperty('--text', '#091833');
  root.style.fontFamily = 'Montserrat, Inter, system-ui, sans-serif';
}

function renderInvitation() {
  const s = state.settings;
  document.title = `Cumpleanos de ${s.celebrantName}`;
  $('#coverImage').src = s.coverImage || '';
  $('#coverImage').alt = `Foto principal de ${s.celebrantName}`;
  $('#invitationTitle').textContent = s.invitationTitle;
  $('#mainPhrase').textContent = cleanMainPhrase(s.mainPhrase, s.celebrantName);
  $('#personalMessage').textContent = s.personalMessage;
  $('#datePill').textContent = formatDate(s.eventDate);
  $('#timePill').textContent = `${formatTime(s.eventTime)} hrs`;
  $('#detailDate').textContent = formatDate(s.eventDate);
  $('#detailTime').textContent = `${formatTime(s.eventTime)} hrs`;
  $('#detailVenue').textContent = s.venueName;
  $('#detailExtra').textContent = s.extraInfo;
  $('#locationName').textContent = s.venueName;
  $('#locationAddress').textContent = s.address;
  $('#locationReference').textContent = s.locationReference;
  $('#mapsButton').href = s.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`;
  renderMap(s);
}


function cleanMainPhrase(value, celebrantName) {
  const phrase = String(value || '').trim();
  if (!phrase) return `¡Celebremos a ${celebrantName}!`;
  const withoutAge = phrase
    .replace(/\s*cumple\s+\d+\s*a(?:ñ|n)os?\s*/giu, ' ')
    .replace(/\s+\d+\s*a(?:ñ|n)os?\s*/giu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return withoutAge || `¡Celebremos a ${celebrantName}!`;
}

function renderMap(settings) {
  const query = settings.address || settings.venueName;
  const frame = $('#mapEmbed');
  if (!query) {
    frame.innerHTML = '';
    return;
  }
  frame.innerHTML = `<iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed" title="Mapa del evento"></iframe>`;
}

function startCountdown() {
  const tick = () => {
    const s = state.settings;
    const target = new Date(`${s.eventDate}T${s.eventTime || '00:00'}:00`);
    const diff = target.getTime() - Date.now();
    if (Number.isNaN(target.getTime()) || diff <= 0) {
      $('#countdownTitle').textContent = 'Hoy es el gran dia!';
      setUnit('days', 0);
      setUnit('hours', 0);
      setUnit('minutes', 0);
      setUnit('seconds', 0);
      return;
    }
    const seconds = Math.floor(diff / 1000);
    setUnit('days', Math.floor(seconds / 86400));
    setUnit('hours', Math.floor((seconds % 86400) / 3600));
    setUnit('minutes', Math.floor((seconds % 3600) / 60));
    setUnit('seconds', seconds % 60);
  };
  tick();
  setInterval(tick, 1000);
}

function setUnit(unit, value) {
  document.querySelector(`[data-unit="${unit}"]`).textContent = String(value).padStart(unit === 'days' ? 1 : 2, '0');
}

function setupRsvp() {
  $('#rsvpForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector('button');
    button.disabled = true;
    button.textContent = 'Enviando...';
    try {
      const response = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo registrar la confirmacion.');
      form.reset();
      $('#rsvpResult').hidden = false;
      $('#rsvpResult').textContent = result.message;
    } catch (error) {
      $('#rsvpResult').hidden = false;
      $('#rsvpResult').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Confirmar asistencia';
    }
  });
}

function setupShare() {
  $('#shareButton').addEventListener('click', async () => {
    const s = state.settings;
    const shareData = {
      title: `Cumpleanos de ${s.celebrantName}`,
      text: s.previewText || s.personalMessage,
      url: window.location.href
    };
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${shareData.title}\n${shareData.text}\n${shareData.url}`)}`;
    window.open(whatsapp, '_blank', 'noopener,noreferrer');
  });
}

function setupReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
  }, { threshold: .14 });
  $$('.section-reveal').forEach((section) => observer.observe(section));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'full' }).format(date);
}

function formatTime(value) {
  if (!value) return '';
  const [hour, minute] = value.split(':');
  return `${hour}:${minute}`;
}
