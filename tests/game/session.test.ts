import { describe, expect, it } from 'vitest';
import { Session } from '../../src/game/session';
import { MISSIONS } from '../../src/game/missions';

describe('shared preview and launch', () => {
  it.each(MISSIONS)('$id replays precisely its preview frames', mission => {
    const s = new Session([mission]);
    mission.solution.forEach(p => s.edit(e => e.place(p.x, p.y, p.piece, p.rot)));
    for (const p of mission.solution) if (p.wait) while (s.editor.pieceAt(p.x, p.y)!.wait !== p.wait) s.edit(e => e.cycleWait(p.x, p.y));
    const simulation = s.simulation;
    const before = JSON.stringify(s.editor.placements);
    for (const frame of simulation.frames) { s.scrub(frame.tick); expect(s.frame).toBe(frame); }
    expect(JSON.stringify(s.editor.placements)).toBe(before);
    s.launch();
    for (const frame of simulation.frames.slice(1)) { s.advance(0.6); expect(s.frame).toBe(frame); }
    expect(s.phase).toBe('success');
    expect(s.simulation).toBe(simulation);
  });
  it('locks edits, pauses, stops without changing the board, and undoes after failure', () => {
    const s = new Session([MISSIONS[2]]);
    s.place(1, 1, 'straight'); s.place(2, 1, 'straight');
    s.launch(); expect(s.place(1, 0, 'bend')).toBe(false);
    s.pause(); s.advance(10); expect(s.tick).toBe(0);
    s.pause(); s.advance(1.8); expect(s.phase).toBe('failure');
    expect(s.simulation.outcome).toMatchObject({ failures: [{ kind: 'aground', tick: 3 }] });
    s.undo(); expect(s.phase).toBe('editing'); expect(s.editor.placements).toHaveLength(1);
    s.launch(); s.stop(); expect(s.editor.placements).toHaveLength(1);
  });
  it('clamps terminal previews and starts the next mission cleanly', () => {
    const s = new Session(); s.scrub(999); expect(s.tick).toBe(10); expect(s.frame.tick).toBe(2);
    s.scrub(-2); expect(s.tick).toBe(0); s.scrub(NaN); expect(s.tick).toBe(0);
    s.place(2, 1, 'bend'); s.launch(); s.advance(3);
    expect(s.rating).toBe(3); expect(s.next()).toBe(true);
    expect(s.mission.id).toBe('m02'); expect(s.editor.placements).toEqual([]);
  });
});
