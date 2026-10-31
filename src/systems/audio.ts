/** Generated, local Web Audio feedback. Created only after a player gesture. */
export class Sound {
  muted = false;
  private context?: AudioContext;
  unlock() {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
  }
  play(kind: 'snap' | 'dial' | 'launch' | 'dock' | 'error') {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const c = this.context, o = c.createOscillator(), gain = c.createGain();
    const frequency = { snap: 420, dial: 280, launch: 180, dock: 880, error: 140 }[kind];
    o.type = kind === 'launch' ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(frequency, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(frequency * 1.5, c.currentTime + 0.12);
    gain.gain.setValueAtTime(0.035, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.22);
    o.connect(gain).connect(c.destination); o.start(); o.stop(c.currentTime + 0.23);
    o.onended = () => { o.disconnect(); gain.disconnect(); };
  }
  dispose() { void this.context?.close(); }
}
