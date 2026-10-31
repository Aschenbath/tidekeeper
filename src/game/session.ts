import { Editor, type EditResult } from './editor';
import { MISSIONS } from './missions';
import { simulate } from './sim';
import { stars } from './score';
import type { Frame, Mission, PieceType, Simulation } from './types';

export type Phase = 'editing' | 'running' | 'paused' | 'failure' | 'success';

/** UI-independent playback. Preview and launch share the very same cached frames. */
export class Session {
  editor: Editor;
  simulation: Simulation;
  phase: Phase = 'editing';
  tick = 0;
  hintsUsed = 0;
  revision = 0;
  private elapsed = 0;
  constructor(readonly missions: readonly Mission[] = MISSIONS, public missionIndex = 0) {
    this.editor = new Editor(missions[missionIndex]);
    this.simulation = simulate(this.mission, []);
  }
  get mission() { return this.editor.mission; }
  get frame(): Frame { return this.simulation.frames[Math.min(this.tick, this.simulation.frames.length - 1)]; }
  get editable() { return this.phase === 'editing'; }
  get rating() { return stars(this.mission, this.editor.placements, this.simulation, this.hintsUsed); }
  edit(action: (editor: Editor) => EditResult | boolean | object | null): boolean {
    if (!this.editable) return false;
    const result = action(this.editor);
    if (!result || (typeof result === 'object' && 'ok' in result && !result.ok)) return false;
    this.simulation = simulate(this.mission, this.editor.placements);
    this.tick = 0;
    this.revision++;
    return true;
  }
  place(x: number, y: number, piece: PieceType) { return this.edit(e => e.place(x, y, piece)); }
  hint() { return this.edit(e => { const p = e.hint(); if (p) this.hintsUsed++; return p; }); }
  scrub(tick: number) {
    if (!this.editable || !Number.isFinite(tick)) return;
    this.tick = Math.max(0, Math.min(this.mission.tickLimit, Math.round(tick)));
  }
  launch() {
    if (!this.editable) return;
    this.tick = 0; this.elapsed = 0; this.phase = 'running';
  }
  pause() { if (this.phase === 'running') this.phase = 'paused'; else if (this.phase === 'paused') this.phase = 'running'; }
  stop() { this.phase = 'editing'; this.tick = 0; this.elapsed = 0; }
  undo() { this.stop(); return this.edit(e => e.undo()); }
  advance(delta: number): boolean {
    if (this.phase !== 'running') return false;
    this.elapsed += delta;
    let changed = false;
    while (this.elapsed >= 0.6 && this.phase === 'running') {
      this.elapsed -= 0.6; this.tick++; changed = true;
      if (this.tick >= this.simulation.outcome.tick) this.phase = this.simulation.outcome.kind;
    }
    return changed;
  }
  next() {
    if (this.phase !== 'success' || this.missionIndex >= this.missions.length - 1) return false;
    this.missionIndex++; this.editor = new Editor(this.missions[this.missionIndex]);
    this.hintsUsed = 0; this.stop(); this.simulation = simulate(this.mission, []); this.revision++;
    return true;
  }
}
