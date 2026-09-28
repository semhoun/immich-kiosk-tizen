export class Presentation {
  constructor({ container, overlay, time, date, clock = typeof window === 'undefined' ? globalThis : window, now = () => new Date() }) {
    Object.assign(this, { container, overlay, time, date, clock, now });
    this.mode = 'simple';
    this.active = false;
    this.suspended = false;
    this.timer = null;
    this.overlay.hidden = true;
  }

  clearTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  start(mode = 'simple') {
    if (mode !== 'simple' && mode !== 'enriched') throw new TypeError('Unknown presentation mode');
    this.mode = mode;
    this.active = true;
    this.overlay.hidden = mode !== 'enriched';
    this.updateClock();
  }

  updateClock() {
    this.clearTimer();
    if (!this.active || this.suspended || this.mode !== 'enriched') return;
    const now = this.now();
    this.time.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    this.date.textContent = now.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.updateClock();
    }, 60000 - now.getSeconds() * 1000 - now.getMilliseconds());
  }

  show(image) {
    if (!this.active) return;
    image.classList.remove('photo-enter');
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
    this.container.appendChild(image);
    if (this.mode === 'enriched') {
      // History reuses image nodes: commit the removed class before restarting the fade.
      void image.offsetWidth;
      image.classList.add('photo-enter');
    }
  }

  suspend(hidden) {
    this.suspended = hidden;
    this.updateClock();
  }

  stop() {
    this.active = false;
    this.clearTimer();
    this.overlay.hidden = true;
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
  }
}
