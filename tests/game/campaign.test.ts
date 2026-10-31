import { describe, expect, it, vi } from 'vitest';
import { Campaign, DailyCache, missionUnlocked, nextMissionIndex } from '../../src/game/campaign';
import { emptyProgress, STORAGE_KEY } from '../../src/game/progress';
import { MISSIONS } from '../../src/game/missions';

const solve = (c: Campaign) => {
  c.result();
  c.session.edit(e => { for (const p of c.session.mission.solution) { e.place(p.x, p.y, p.piece, p.rot); for (let i = 1; i < (p.wait ?? 1); i++) e.cycleWait(p.x, p.y); } return true; });
  c.session.launch(); c.session.advance(100); c.result();
};
describe('campaign flow', () => {
  it('locks the next village, records success, then unlocks and resumes it', () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v); }, removeItem: (k: string) => { data.delete(k); } };
    const c = new Campaign(store);
    expect(c.select(1)).toBe(false); solve(c);
    expect(c.progress.missions.m01.stars).toBe(3);
    expect(c.next()).toBe(true); expect(c.session.mission.id).toBe('m02');
    expect(new Campaign(store).session.mission.id).toBe('m02');
    c.settings({ reach: 'far', sound: false });
    expect(new Campaign(store).progress.settings).toEqual({ reach: 'far', sound: false });
    c.reset(); expect(JSON.parse(data.get(STORAGE_KEY)!).missions).toEqual({});
    expect(c.session.mission.id).toBe('m01'); expect(c.select(8)).toBe(false);
  });
  it('records daily success once and keeps a puzzle stable across a midnight solve', () => {
    let date = '2026-11-01'; const c = new Campaign(undefined, () => date);
    c.daily(); date = '2026-11-02'; solve(c); c.result();
    expect(c.progress.daily.lastSolved).toBe('2026-11-01'); expect(c.progress.daily.streak).toBe(1);
    expect(c.dailySummary().streak).toBe(1); expect(c.next()).toBe(false);
    c.daily(); solve(c); expect(c.progress.daily.streak).toBe(2);
  });
  it('caches each date and does not compute from results or settings', () => {
    const generate = vi.fn((date: string) => ({date, mission: MISSIONS[0], template:'m01', attempt:0}));
    const cache = new DailyCache(generate);
    expect(cache.get('2026-11-01')).toBe(cache.get('2026-11-01'));
    cache.get('2026-11-02'); cache.get('2026-11-01'); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('keeps playing if storage throws and never unlocks from a preview or failure', () => {
    const fail = () => { throw new Error('blocked'); }; const c = new Campaign({getItem:fail,setItem:fail,removeItem:fail});
    c.session.scrub(9); expect(c.result()).toBe(false);
    c.session.launch(); c.session.advance(100); c.result(); expect(c.select(1)).toBe(false);
    c.session.stop(); solve(c); expect(c.saved).toBe(false); expect(c.select(1)).toBe(true);
    c.reset(); expect(c.progress).toEqual(emptyProgress());
  });
  it('rejects out-of-range map entries', () => {
    expect(missionUnlocked(emptyProgress(), MISSIONS, -1)).toBe(false);
    expect(missionUnlocked(emptyProgress(), MISSIONS, 9)).toBe(false);
    expect(nextMissionIndex(emptyProgress(), MISSIONS)).toBe(0);
  });
});
