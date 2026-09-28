import { normalizeSettings } from './settings.js';

export function fullURL(settings, parentOrigin = location.origin) {
  const clean = normalizeSettings(settings);
  const url = new URL(clean.url);
  if (url.origin === parentOrigin) throw new Error('Le site Full doit avoir une origine différente de cette application pour rester isolé.');
  // Full alone uses native query authentication; never persist this derived URL.
  if (clean.password) url.searchParams.set('password', clean.password);
  return url.href;
}

export class FullView {
  constructor(container) {
    this.container = container;
    this.url = null;
    this.hidden = false;
  }

  start(settings) {
    this.stop();
    this.url = fullURL(settings);
    this.hidden = false;
    this.mount();
  }

  mount() {
    this.unmount();
    if (!this.url || this.hidden) return;
    const frame = document.createElement('iframe');
    frame.title = 'Site Immich Kiosk original';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', 'autoplay');
    frame.tabIndex = -1;
    frame.src = this.url;
    this.container.appendChild(frame);
  }

  unmount() {
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
  }

  suspend(hidden) {
    this.hidden = hidden;
    if (hidden) this.unmount();
    else this.mount();
  }

  stop() {
    this.url = null;
    this.unmount();
  }
}
