import { KioskClient, KioskError } from './kiosk.js';
import { normalizeSettings, loadSettings, saveSettings, forgetPassword, clearSettings } from './settings.js';
import { Player, decodePhoto } from './player.js';
import { Presentation } from './presentation.js';
import { FullView, fullURL } from './full.js';

const $ = id => document.getElementById(id);
const fields = ['url', 'password', 'remember', 'duration', 'fit', 'mode'];
const presentation = new Presentation({ container: $('photo'), overlay: $('photo-overlay'), time: $('clock-time'), date: $('clock-date') });
const full = new FullView($('full-frame'));
let storage;
try { storage = window.localStorage; } catch (_) { /* Session-only mode remains usable. */ }
let player = null;
let connection = null;
let generation = 0;
let modalResolve = null;
let modalFocus = null;
let editing = null;
let acceptedHttp = '';
const messages = {
  AUTH: 'Mot de passe refusé. Vérifiez les réglages.',
  NETWORK: 'Connexion impossible. Vérifiez le serveur, le réseau, les certificats et la configuration CORS.',
  TIMEOUT: 'Le serveur ne répond pas dans le délai prévu.',
  INCOMPATIBLE: 'Réponse Kiosk incompatible avec ce lecteur.',
  NO_PHOTOS: 'Aucune photo disponible. Vérifiez les sources et filtres Kiosk.',
  IMAGE: 'Cette photo ne peut pas être décodée par la télévision.',
  SECURITY: 'Adresse ou redirection refusée pour protéger votre connexion.'
};
function message(text) { $('message').textContent = text; }
function updateMode() {
  const full = $('mode').value === 'full';
  $('duration').disabled = $('fit').disabled = full;
  $('connect').textContent = full ? 'Ouvrir le site Full' : 'Tester la connexion';
  $('mode-help').textContent = full ?
    'Présentation et rythme du site Kiosk original. En Full, le mot de passe est transmis dans le paramètre password de l’URL après confirmation.' :
    $('mode').value === 'enriched' ? 'Lecteur local avec horloge, date et fondu. Ce mode ne reproduit pas tous les widgets Kiosk.' :
    'Lecteur local léger, conçu pour Tizen 5.5.';
}
$('mode').addEventListener('change', updateMode);
function errorText(error) {
  if (error instanceof KioskError && ['INCOMPATIBLE', 'SECURITY', 'IMAGE'].includes(error.code)) return error.message;
  return messages[error.code] || 'Impossible de continuer. Vérifiez les réglages du serveur.';
}
function fill(settings) {
  if (!settings) settings = { url: '', password: '', remember: false, duration: 15, fit: 'contain' };
  if (!Array.from($('duration').options).some(option => option.value === String(settings.duration))) {
    const option = document.createElement('option');
    option.value = settings.duration;
    option.textContent = settings.duration + ' secondes';
    $('duration').appendChild(option);
  }
  fields.forEach(key => { if (key === 'remember') $(key).checked = settings[key]; else $(key).value = key === 'mode' ? settings.mode || 'simple' : settings[key]; });
  updateMode();
}
function readSettings() {
  const settings = normalizeSettings({ url: $('url').value, password: $('password').value, remember: $('remember').checked, duration: $('duration').value, fit: $('fit').value, mode: $('mode').value });
  fill(settings);
  return settings;
}
function persist(settings) {
  if (!storage) { message('Stockage indisponible : réglages conservés pour cette session seulement.'); return; }
  try { saveSettings(storage, settings); } catch (_) { message('Enregistrement impossible sur cette télévision.'); }
}
function screensaver(enabled) {
  // AppCommon documents no getter or extra privilege; restore normal ON behavior.
  try {
    const api = window.webapis && window.webapis.appcommon;
    if (api) api.setScreenSaver(enabled ? api.AppCommonScreenSaverState.SCREEN_SAVER_ON : api.AppCommonScreenSaverState.SCREEN_SAVER_OFF, () => {}, () => {});
  } catch (_) { /* Firmware support is best effort, never bypass panel protection. */ }
}
function stop() {
  generation++;
  if (connection) connection.abort();
  connection = null;
  if (player) player.stop();
  player = null;
  presentation.stop();
  full.stop();
  $('full-view').hidden = true;
  screensaver(true);
}
function showSettings(text = '') {
  stop();
  $('viewer').hidden = true;
  $('settings').hidden = false;
  message(text);
  $('mode').focus();
}
function ask(title, text) {
  if (modalResolve) closeModal(false);
  modalFocus = document.activeElement;
  $('modal-title').textContent = title;
  $('modal-text').textContent = text;
  $('modal').hidden = false;
  $('cancel').focus();
  return new Promise(resolve => { modalResolve = resolve; });
}
function closeModal(value) {
  $('modal').hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  if (modalFocus) modalFocus.focus();
  if (resolve) resolve(value);
}
$('cancel').onclick = () => closeModal(false);
$('confirm').onclick = () => closeModal(true);
async function run(start, automatic = false) {
  stop();
  const token = generation;
  let settings;
  try { settings = readSettings(); } catch (_) { message('Saisissez une adresse HTTP ou HTTPS valide, sans identifiants intégrés.'); $('url').focus(); return; }
  if (settings.mode === 'full') {
    try { fullURL(settings); } catch (error) { message(error.message); return; }
    let notice = 'La lecture est gérée par le site Kiosk original. Haut ou Retour permettent de retrouver les réglages.';
    if (settings.password) {
      notice += ' Le mot de passe sera transmis dans le paramètre password de l’URL du cadre. Il peut apparaître dans les journaux du serveur ou du proxy et les données du navigateur. L’application n’enregistre pas cette URL.';
      if (settings.url.startsWith('http:')) notice += ' Attention : HTTP n’est pas chiffré, le réseau peut aussi lire le mot de passe et les photos. Préférez HTTPS.';
    }
    if (!automatic || (settings.password && settings.url.startsWith('http:'))) {
      if (!await ask('Ouvrir le site Kiosk original ?', notice)) return;
    }
    if (token !== generation || document.hidden) return;
    persist(settings);
    $('settings').hidden = true;
    $('viewer').hidden = true;
    $('full-view').hidden = false;
    full.start(settings);
    $('full-view').focus();
    screensaver(false);
    return;
  }
  if (settings.url.startsWith('http:') && settings.password && acceptedHttp !== settings.url) {
    const accepted = await ask('Envoyer le mot de passe en HTTP ?', 'Cette connexion n’est pas chiffrée. Le réseau peut lire votre mot de passe et vos photos. Utilisez HTTPS si possible.');
    if (!accepted || token !== generation) return;
    acceptedHttp = settings.url;
  }
  if (document.hidden || token !== generation) return;
  persist(settings);
  const client = new KioskClient(settings);
  if (!start) {
    const controller = new AbortController();
    connection = controller;
    message('Connexion en cours…');
    let photo;
    try {
      await client.connect(controller.signal);
      if (token !== generation) return;
      photo = await client.photo(controller.signal);
      if (token !== generation) return;
      await decodePhoto(photo, controller.signal);
      if (token === generation) message('Connexion réussie. Une photo a été chargée et décodée.');
    }
    catch (error) { if (token === generation && error.name !== 'AbortError') message(errorText(error)); }
    finally { if (photo) photo.dispose(); if (token === generation) connection = null; }
    return;
  }
  $('settings').hidden = true;
  $('viewer').hidden = false;
  $('viewer').classList.toggle('cover', settings.fit === 'cover');
  $('viewer').classList.remove('paused');
  $('player-actions').hidden = true;
  $('player-status').textContent = 'Chargement de la première photo…';
  $('viewer').focus();
  presentation.start(settings.mode);
  player = new Player({ client, duration: settings.duration,
    show: image => {
      presentation.show(image);
      $('player-actions').hidden = true;
      // Remove the initial remote hint after the first decoded image arrives.
      $('viewer').blur();
    },
    status: text => { $('player-status').textContent = text; },
    error: (error, retry) => {
      if (error.code === 'AUTH') { showSettings(errorText(error)); return; }
      $('player-status').textContent = errorText(error) + (retry ? ' Nouvelle tentative automatique…' : '');
      $('player-actions').hidden = retry;
      if (!retry) { $('retry').focus(); screensaver(true); }
    }
  });
  screensaver(false);
  player.start();
}
$('form').onsubmit = event => { event.preventDefault(); if (editing) endEditing(); else run(true); };
$('connect').onclick = () => run(false);
$('configure').onclick = () => showSettings();
$('retry').onclick = () => { if (player) { $('player-actions').hidden = true; $('player-status').textContent = 'Nouvelle tentative…'; screensaver(false); player.retry(); } };
$('remember').onchange = () => {
  if (!$('remember').checked && storage) {
    try { forgetPassword(storage); message('Le mot de passe enregistré a été supprimé.'); }
    catch (_) { message('Échec de suppression du mot de passe enregistré. Effacez le stockage de l’application.'); }
  }
};
$('clear').onclick = async () => {
  if (!await ask('Effacer les réglages ?', 'L’adresse et le mot de passe enregistrés seront supprimés.')) return;
  stop();
  acceptedHttp = '';
  try { if (storage) clearSettings(storage); } catch (_) { message('Impossible d’effacer le stockage local.'); return; }
  fill({ url: '', password: '', remember: false, duration: 15, fit: 'contain' });
  showSettings('Réglages effacés.');
};
function endEditing() {
  if (!editing) return;
  const field = editing;
  editing = null;
  field.blur();
  $('connect').focus();
}
['url', 'password'].forEach(id => {
  // Samsung opens its IME when an editable input receives focus. Do not toggle
  // readonly or cancel its key events: that can suppress native text entry.
  $(id).addEventListener('focus', () => { editing = $(id); });
  $(id).addEventListener('blur', () => { if (editing === $(id)) editing = null; });
});
function changeChoice(select, direction) {
  const options = Array.from(select.options).filter(option => !option.disabled);
  const index = options.findIndex(option => option.value === select.value);
  select.value = options[(index + direction + options.length) % options.length].value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
function moveFocus(key) {
  const root = !$('modal').hidden ? $('modal') : (!$('settings').hidden ? $('settings') : !$('full-view').hidden ? $('full-view') : $('player-actions'));
  const controls = Array.from(root.querySelectorAll('input,select,button')).filter(el => !el.disabled && el.getClientRects().length);
  const current = document.activeElement;
  if (!controls.includes(current)) { if (controls[0]) controls[0].focus(); return; }
  const rect = current.getBoundingClientRect();
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  const candidates = controls.filter(el => el !== current).map(el => {
    const r = el.getBoundingClientRect();
    const dx = (r.left + r.right - rect.left - rect.right) / 2;
    const dy = (r.top + r.bottom - rect.top - rect.bottom) / 2;
    const primary = (horizontal ? dx : dy) * sign;
    const cross = Math.abs(horizontal ? dy : dx);
    return { el, primary, score: primary + cross * 3 };
  }).filter(item => item.primary > 5).sort((a, b) => a.score - b.score);
  if (candidates[0]) candidates[0].el.focus();
}
document.addEventListener('keydown', async event => {
  const code = event.keyCode;
  const key = ({ 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: ' ', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 10009: 'BrowserBack' })[code] || event.key || '';
  const back = key === 'Escape' || key === 'BrowserBack' || code === 10009;
  if (editing) {
    if (code === 65376 || code === 65385 || back) endEditing();
    return;
  }
  if (modalResolve && key === 'Tab') {
    event.preventDefault();
    (document.activeElement === $('cancel') ? $('confirm') : $('cancel')).focus();
    return;
  }
  if (back) {
    event.preventDefault();
    if (modalResolve) { closeModal(false); return; }
    if (!$('viewer').hidden || !$('full-view').hidden) { showSettings(); return; }
    stop();
    if (await ask('Quitter Immich Kiosk ?', 'Le diaporama sera arrêté.')) {
      stop();
      try { window.tizen.application.getCurrentApplication().exit(); } catch (_) { message('Application arrêtée. Vous pouvez fermer cette fenêtre.'); }
    }
    return;
  }
  if (!modalResolve && (key === 'ArrowUp' || code === 38) && (!$('viewer').hidden || !$('full-view').hidden)) {
    event.preventDefault();
    showSettings();
    return;
  }
  if (!$('full-view').hidden && !modalResolve && key === 'Tab') {
    event.preventDefault();
    $('full-view').focus();
    return;
  }
  if (!$('viewer').hidden && $('modal').hidden && $('player-actions').hidden && player) {
    if (key === 'ArrowLeft') { event.preventDefault(); player.previous(); }
    else if (key === 'ArrowRight') { event.preventDefault(); player.next(); }
    else if (key === 'Enter' || key === ' ' || [10252, 415, 19].includes(code)) {
      event.preventDefault();
      player.pause(code === 415 ? false : code === 19 ? true : !player.paused);
      $('viewer').classList.toggle('paused', player.paused);
      screensaver(player.paused);
    }
    return;
  }
  const focused = document.activeElement;
  if (focused.tagName === 'SELECT' && ['ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) {
    event.preventDefault();
    changeChoice(focused, key === 'ArrowLeft' ? -1 : 1);
  } else if (key.startsWith('Arrow')) { event.preventDefault(); moveFocus(key); }
  else if (key === 'Enter' && (focused === $('remember') || focused.tagName === 'BUTTON')) {
    event.preventDefault();
    focused.click();
  }
});
document.addEventListener('visibilitychange', () => {
  presentation.suspend(document.hidden);
  full.suspend(document.hidden);
  if (document.hidden) {
    if (modalResolve) closeModal(false);
    if (connection) { generation++; connection.abort(); connection = null; }
    if (player) player.suspend(true);
    screensaver(true);
  } else if (player) { player.suspend(false); screensaver(player.paused); }
  else if (!$('full-view').hidden) { screensaver(false); $('full-view').focus(); }
});
// Keep TV Return in the local shell, not inside a cross-origin document.
window.addEventListener('blur', () => {
  if (!$('full-view').hidden && document.activeElement && document.activeElement.tagName === 'IFRAME') $('full-view').focus();
});
window.addEventListener('pagehide', stop);
try {
  if (window.tizen && window.tizen.tvinputdevice) ['MediaPlay', 'MediaPause', 'MediaPlayPause'].forEach(key => { try { window.tizen.tvinputdevice.registerKey(key); } catch (_) {} });
} catch (_) { /* Desktop preview has no TV APIs. */ }
try { fill(storage ? loadSettings(storage) : { url: '', password: '', remember: false, duration: 15, fit: 'contain' }); }
catch (_) { message('Réglages enregistrés illisibles. Saisissez à nouveau le serveur.'); }
$('mode').focus();
document.documentElement.setAttribute('data-kiosk-ready', 'true');
window.dispatchEvent(new Event('kiosk-ready'));
if ($('url').value) run(true, true);
