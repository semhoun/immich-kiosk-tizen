const STORAGE_KEY = 'immich-kiosk-tizen.settings.v1';

export function normalizeSettings(input) {
  let url;
  try { url = new URL(String(input.url || '').trim()); }
  catch (_) { throw new Error('Saisissez une adresse HTTP ou HTTPS valide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Adresse HTTP(S) sans identifiants intégrés requise.');
  }
  const passwords = url.searchParams.getAll('password').concat(url.searchParams.getAll('authsecret'));
  url.searchParams.delete('password');
  url.searchParams.delete('authsecret');
  url.hash = '';
  const password = String(input.password || passwords[passwords.length - 1] || '');
  const duration = Number(input.duration === undefined ? 15 : input.duration);
  if (!Number.isInteger(duration) || duration < 3 || duration > 3600) {
    throw new Error('La durée doit être un nombre entier entre 3 et 3600 secondes.');
  }
  return {
    url: url.href, password, remember: input.remember === true,
    duration, fit: input.fit === 'cover' ? 'cover' : 'contain',
    mode: ['simple', 'enriched', 'full'].includes(input.mode) ? input.mode : 'simple'
  };
}

export function loadSettings(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!value) return null;
    // A persisted URL must never resurrect an old query-string secret.
    const url = new URL(value.url);
    url.searchParams.delete('password');
    url.searchParams.delete('authsecret');
    return normalizeSettings({ ...value, url: url.href, password: value.remember === true ? value.password : '' });
  } catch (_) { return null; }
}

export function saveSettings(storage, settings) {
  const clean = normalizeSettings(settings);
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...clean, password: clean.remember ? clean.password : '' }));
}

export function forgetPassword(storage = localStorage) {
  const settings = loadSettings(storage);
  if (settings) saveSettings(storage, { ...settings, password: '', remember: false });
  else storage.removeItem(STORAGE_KEY);
}

export function clearSettings(storage = localStorage) {
  storage.removeItem(STORAGE_KEY);
}
