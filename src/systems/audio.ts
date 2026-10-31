export type Cue = 'snap' | 'rotate' | 'wait' | 'dial' | 'launch' | 'dock' | 'error' | 'success';

/** Generated sea and short cues; constructing Sound never creates an AudioContext. */
export class Sound {
  private context?: AudioContext;
  private master?: GainNode;
  private sea?: AudioBufferSourceNode;
  private silent = false;
  get muted() { return this.silent; }
  set muted(value: boolean) {
    this.silent = value;
    if (this.context && this.master) this.master.gain.setTargetAtTime(value ? 0 : 0.55, this.context.currentTime, 0.03);
  }
  unlock() {
    if (this.silent) return;
    try {
      if (!this.context) {
        const c = this.context = new AudioContext();
        this.master = c.createGain(); this.master.gain.value = 0.55; this.master.connect(c.destination);
        const buffer = c.createBuffer(1, c.sampleRate * 4, c.sampleRate), data = buffer.getChannelData(0);
        let seed = 21, last = 0;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          last = (last + (seed / 0x100000000 * 2 - 1) * 0.025) / 1.025;
          data[i] = last * 0.22 * (0.7 + 0.3 * Math.sin(i / data.length * Math.PI * 2));
        }
        const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420;
        this.sea = c.createBufferSource(); this.sea.buffer = buffer; this.sea.loop = true;
        this.sea.connect(filter).connect(this.master); this.sea.start();
      }
      void this.context.resume().catch(() => {});
    } catch { /* Audio is optional; all cues have visible counterparts. */ }
  }
  play(kind: Cue) {
    const c = this.context;
    if (this.silent || !c || !this.master || c.state !== 'running') return;
    const notes = kind === 'success' ? [523.25, 659.25, 783.99] : [{snap:420,rotate:520,wait:620,dial:280,launch:180,dock:880,error:140}[kind]];
    for (let i = 0; i < notes.length; i++) {
      const o = c.createOscillator(), gain = c.createGain(), start = c.currentTime + i * 0.07;
      const duration = kind === 'success' || kind === 'dock' ? 0.8 : 0.2;
      o.type = kind === 'error' ? 'triangle' : 'sine'; o.frequency.setValueAtTime(notes[i], start);
      if (kind === 'launch') o.frequency.exponentialRampToValueAtTime(420, start + duration);
      if (kind === 'error') o.frequency.exponentialRampToValueAtTime(70, start + duration);
      gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.06, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      o.connect(gain).connect(this.master); o.start(start); o.stop(start + duration + 0.01);
      o.onended = () => { o.disconnect(); gain.disconnect(); };
    }
  }
  dispose() { this.sea?.stop(); void this.context?.close().catch(() => {}); }
}
