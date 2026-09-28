export function decodePhoto(photo, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      if (error) { image.removeAttribute('src'); reject(error); }
      else resolve(image);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.alt = '';
    image.onerror = () => finish(Object.assign(new Error('Image illisible.'), { code: 'IMAGE' }));
    image.onload = () => {
      image.decode().then(() => finish(), () => finish(Object.assign(new Error('Image illisible.'), { code: 'IMAGE' })));
    };
    image.src = photo.url;
  });
}

export class Player {
  constructor({ client, duration = 15, decode = decodePhoto, show, status = () => {}, error = () => {}, clock = globalThis }) {
    Object.assign(this, { client, duration, decode, show, status, error, clock });
    this.history = [];
    this.index = -1;
    this.preloaded = null;
    this.timer = null;
    this.request = null;
    this.epoch = 0;
    this.active = false;
    this.paused = false;
    this.suspended = false;
    this.failures = 0;
    this.blocked = false;
    this.connected = false;
    this.retryPending = false;
  }

  start() { this.active = true; this.pump(); }
  clearTimer() { if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null; }
  schedule(callback, delay) {
    this.clearTimer();
    if (!this.active || this.suspended || this.paused) return;
    this.timer = this.clock.setTimeout(() => { this.timer = null; callback(); }, delay);
  }
  arm() {
    if (this.retryPending) {
      this.schedule(() => { this.retryPending = false; this.blocked = false; this.pump(); }, 2000 * 2 ** (this.failures - 1));
      return;
    }
    if (!this.blocked && this.index >= 0) this.schedule(() => this.next(), this.duration * 1000);
  }
  present(entry) { this.show(entry.image); this.status(this.paused ? 'En pause' : ''); }
  next() {
    if (!this.active || this.suspended) return;
    this.clearTimer();
    if (this.index < this.history.length - 1) this.present(this.history[++this.index]);
    else if (this.preloaded) {
      this.history.push(this.preloaded);
      this.preloaded = null;
      if (this.history.length > 10) this.history.shift().dispose();
      this.index = this.history.length - 1;
      this.present(this.history[this.index]);
    } else { this.wantNext = true; }
    this.arm();
    this.pump();
  }
  previous() {
    if (this.index > 0) { this.wantNext = false; this.present(this.history[--this.index]); this.arm(); }
  }
  pause(value = !this.paused) {
    this.paused = value;
    if (value) this.wantNext = false;
    this.clearTimer();
    this.status(value ? 'En pause' : '');
    if (!value) { this.arm(); this.pump(); }
  }
  suspend(value) {
    this.suspended = value;
    if (value) { this.epoch++; this.clearTimer(); if (this.request) this.request.abort(); }
    else { this.arm(); this.pump(); }
  }
  retry() { this.failures = 0; this.retryPending = false; this.blocked = false; this.clearTimer(); this.pump(); }
  async pump() {
    if (!this.active || this.suspended || this.request || this.preloaded || this.blocked) return;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.request = controller;
    let photo;
    try {
      if (!this.connected) {
        await this.client.connect(controller.signal);
        if (epoch !== this.epoch || !this.active) return;
        this.connected = true;
      }
      if (epoch !== this.epoch || !this.active) return;
      photo = await this.client.photo(controller.signal);
      if (epoch !== this.epoch || !this.active) return;
      const image = await this.decode(photo, controller.signal);
      if (epoch !== this.epoch || !this.active) return;
      this.preloaded = { image, dispose: photo.dispose };
      photo = null;
      this.failures = 0;
    } catch (error) {
      if (epoch === this.epoch && this.active && error.name !== 'AbortError') {
        this.clearTimer();
        const retry = ['NETWORK', 'TIMEOUT'].includes(error.code) && this.failures < 3 && !this.paused;
        this.blocked = true;
        this.error(error, retry);
        if (retry) { this.failures++; this.retryPending = true; this.arm(); }
      }
    } finally {
      if (photo) photo.dispose();
      this.request = null;
      if (this.active && !this.suspended && epoch !== this.epoch) this.pump();
    }
    if (this.active && epoch === this.epoch && this.preloaded) {
      if (this.index < 0 || this.wantNext) { this.wantNext = false; this.next(); }
      else this.arm();
    }
  }
  stop() {
    this.active = false;
    this.epoch++;
    this.clearTimer();
    if (this.request) this.request.abort();
    this.history.forEach(entry => entry.dispose());
    this.history = [];
    if (this.preloaded) this.preloaded.dispose();
    this.preloaded = null;
    this.index = -1;
  }
}
