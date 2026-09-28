import { baseURL, imageURL, request, KioskError } from './network.js';
import { normalizeSettings } from './settings.js';
export { KioskError } from './network.js';

// Source-reviewed contract, not a claim of integration against a deployed server.
export const CONTRACT = {
  version: 'v0.44.1',
  commit: 'd567ac041fc93c3d5421aecdcdf5941118022ccb'
};
const IMAGE_LIMIT = 16 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function fragment(html) {
  // Template contents are inert: remote scripts, images and iframes never enter
  // the live document, including during parsing.
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

export function parseMetadata(html) {
  const nodes = fragment(html).querySelectorAll('script#kiosk-data');
  if (nodes.length !== 1) throw new KioskError('INCOMPATIBLE', 'Réponse Kiosk incompatible : métadonnées absentes.');
  let data;
  try { data = JSON.parse(nodes[0].textContent); }
  catch (_) { throw new KioskError('INCOMPATIBLE', 'Métadonnées Kiosk illisibles.'); }
  if (!data || typeof data.version !== 'string' || data.version.replace(/^v/, '') !== '0.44.1') {
    throw new KioskError('INCOMPATIBLE', 'Version Kiosk non validée. Contrat pris en charge : v0.44.1.');
  }
  return { version: data.version };
}

export function parsePhoto(html) {
  const root = fragment(html);
  if (root.querySelector('.frame-error')) {
    throw new KioskError('INCOMPATIBLE', 'Kiosk signale une erreur de sélection. Vérifiez les sources, filtres et journaux du serveur.');
  }
  if (root.querySelector('video')) throw new KioskError('INCOMPATIBLE', 'Kiosk a renvoyé une vidéo. Vérifiez les options photos uniquement et disable_url_queries.');
  const photos = root.querySelectorAll('.frame .frame--image > img');
  if (photos.length !== 1) throw new KioskError('INCOMPATIBLE', 'Réponse photo incompatible : une seule photo est attendue.');
  const source = photos[0].getAttribute('src');
  if (!source) throw new KioskError('IMAGE', 'La réponse ne contient pas de source photo.');
  return source;
}

export function dataImage(source) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(source);
  if (!match || match[2].length > Math.ceil(IMAGE_LIMIT / 3) * 4) {
    throw new KioskError('IMAGE', 'Format de photo non pris en charge ou photo trop volumineuse.');
  }
  let binary;
  try { binary = atob(match[2]); }
  catch (_) { throw new KioskError('IMAGE', 'Photo encodée illisible.'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  validateImage(bytes, match[1]);
  return new Blob([bytes], { type: match[1] });
}

function validateImage(bytes, type) {
  const starts = values => values.every((value, index) => bytes[index] === value);
  const valid = type === 'image/jpeg' ? starts([255, 216, 255]) :
    type === 'image/png' ? starts([137, 80, 78, 71, 13, 10, 26, 10]) :
    type === 'image/webp' && starts([82, 73, 70, 70]) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!valid || bytes.length > IMAGE_LIMIT) throw new KioskError('IMAGE', 'Le contenu reçu n’est pas une photo JPEG, PNG ou WebP valide.');
}

export function photoParams(settings) {
  const params = new URL(settings.url).searchParams;
  params.delete('password');
  params.delete('authsecret');
  params.delete('history');
  for (const key of ['show_videos', 'live_photos', 'show_animated_gifs']) params.set(key, 'false');
  params.set('use_original_image', 'false');
  params.set('background_blur', 'false');
  params.set('layout', 'single');
  params.set('client_width', String(Math.max(1, Math.round(globalThis.innerWidth || 1920))));
  params.set('client_height', String(Math.max(1, Math.round(globalThis.innerHeight || 1080))));
  params.set('client_time', new Date().toISOString());
  return params;
}

export class KioskClient {
  constructor(settings) {
    this.settings = normalizeSettings(settings);
    this.base = baseURL(this.settings.url);
    const random = new Uint32Array(4);
    crypto.getRandomValues(random);
    this.deviceId = Array.from(random, value => value.toString(16)).join('-');
    this.connected = false;
  }

  async connect(signal) {
    this.connected = false;
    const result = await request(this.base, { password: this.settings.password, signal });
    if (result.type !== 'text/html') throw new KioskError('INCOMPATIBLE', 'Le serveur ne renvoie pas une page Kiosk HTML.');
    const metadata = parseMetadata(new TextDecoder().decode(result.bytes));
    this.connected = true;
    return metadata;
  }

  async photo(signal) {
    if (!this.connected) throw new KioskError('INCOMPATIBLE', 'Testez la connexion Kiosk avant de charger une photo.');
    const endpoint = new URL('asset/new', this.base);
    const result = await request(endpoint, {
      password: this.settings.password, deviceId: this.deviceId, signal,
      method: 'POST', body: photoParams(this.settings)
    });
    if (result.type !== 'text/html' || result.bytes.length === 0) {
      throw new KioskError('INCOMPATIBLE', 'Kiosk ne renvoie aucune vue photo (veille ou protocole incompatible).');
    }
    const source = parsePhoto(new TextDecoder().decode(result.bytes));
    let blob;
    if (source.startsWith('data:')) blob = dataImage(source);
    else {
      const url = imageURL(source, this.base);
      const image = await request(url, { password: this.settings.password, signal, limit: IMAGE_LIMIT });
      if (!TYPES.includes(image.type)) throw new KioskError('IMAGE', 'Format photo non pris en charge.');
      validateImage(image.bytes, image.type);
      blob = new Blob([image.bytes], { type: image.type });
    }
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = URL.createObjectURL(blob);
    return { url, dispose: () => URL.revokeObjectURL(url) };
  }
}
