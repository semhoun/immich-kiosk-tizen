export class KioskError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KioskError';
    this.code = code;
  }
}

export function baseURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new KioskError('SECURITY', 'Adresse serveur non autorisée.');
  }
  url.searchParams.delete('password');
  url.searchParams.delete('authsecret');
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

export function imageURL(source, base) {
  let url;
  try { url = new URL(source, base); }
  catch (_) { throw new KioskError('IMAGE', 'Adresse de photo invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin ||
      url.username || url.password || !url.pathname.startsWith(base.pathname) ||
      url.searchParams.has('password') || url.searchParams.has('authsecret')) {
    throw new KioskError('SECURITY', 'La photo pointe vers une destination non autorisée.');
  }
  url.hash = '';
  return url;
}

export async function readLimited(response, limit) {
  const length = Number(response.headers.get('content-length'));
  if (length > limit) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw new KioskError('INCOMPATIBLE', 'Réponse serveur trop volumineuse.');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new KioskError('INCOMPATIBLE', 'Réponse serveur trop volumineuse.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function request(url, { password = '', deviceId, signal, method = 'GET', body, limit = 24 * 1024 * 1024, timeout = 15000 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (signal) signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const headers = { Accept: 'text/html, image/jpeg, image/png, image/webp' };
    if (password) headers['X-Api-Key'] = password;
    if (deviceId) headers['kiosk-device-id'] = deviceId;
    const response = await fetch(url.href, {
      method, body, headers, signal: controller.signal, redirect: 'error',
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
    });
    if (response.status === 401 || response.status === 403) {
      throw new KioskError('AUTH', 'Mot de passe refusé ou accès interdit.');
    }
    if (response.status >= 500) throw new KioskError('NETWORK', 'Le serveur est temporairement indisponible.');
    if (!response.ok) throw new KioskError('INCOMPATIBLE', 'Le serveur refuse cette requête Kiosk.');
    return { bytes: await readLimited(response, limit), type: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
  } catch (error) {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (timedOut) throw new KioskError('TIMEOUT', 'Le serveur ne répond pas dans le délai prévu.');
    if (error instanceof KioskError) throw error;
    throw new KioskError('NETWORK', 'Connexion impossible. Vérifiez le réseau, TLS, CORS et les redirections du serveur.');
  } finally {
    // Errors may arrive with a still-streaming body; keep cancellation ownership
    // until it has been terminated, before removing the parent signal listener.
    controller.abort();
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}
