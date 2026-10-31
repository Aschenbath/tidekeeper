import type { Progress } from './progress';
import { currentStreak, loadProgress, recordDaily, recordMission, resetProgress, saveProgress } from './progress';
import { dailyMission, localDate, type Daily } from './daily';
import { DAILY_TEMPLATES, MISSIONS } from './missions';
import { Session } from './session';

type Store = Parameters<typeof loadProgress>[0];

/** Read localStorage inside the guard too: its property getter can throw. */
export function browserStorage(): Store {
  try { return window.localStorage; } catch { return undefined; }
}

/** The expensive daily search is only reached from navigation, never playback. */
export class DailyCache {
  private days = new Map<string, Daily>();
  constructor(private generate = dailyMission) {}
  get(date: string): Daily {
    let daily = this.days.get(date);
    if (!daily) { daily = this.generate(date, DAILY_TEMPLATES); this.days.set(date, daily); }
    return daily;
  }
}

export class Campaign {
  progress: Progress;
  session: Session;
  dailyDate: string | null = null;
  saved = true;
  private recorded = false;
  readonly cache = new DailyCache();
  constructor(private store?: Store, private today = localDate) {
    this.progress = loadProgress(store);
    this.session = new Session(MISSIONS, nextMissionIndex(this.progress, MISSIONS));
  }
  select(index: number): boolean {
    if (!missionUnlocked(this.progress, MISSIONS, index)) return false;
    this.session = new Session(MISSIONS, index); this.dailyDate = null; this.recorded = false;
    return true;
  }
  daily(): Daily {
    const daily = this.cache.get(this.today());
    this.session = new Session([daily.mission]); this.dailyDate = daily.date; this.recorded = false;
    return daily;
  }
  dailySummary() {
    const date = this.today();
    return { date, streak: currentStreak(this.progress, date), best: this.progress.daily.best[date] ?? null };
  }
  next(): boolean {
    return !this.dailyDate && this.session.phase === 'success' && this.select(this.session.missionIndex + 1);
  }
  result(): boolean {
    const s = this.session;
    if (s.phase !== 'success' && s.phase !== 'failure') { this.recorded = false; return false; }
    if (this.recorded) return false;
    this.recorded = true;
    if (s.phase === 'success') {
      const result = { pieces: s.editor.placements.length, tick: s.simulation.outcome.tick, stars: s.rating };
      this.progress = this.dailyDate ? recordDaily(this.progress, this.dailyDate, result) : recordMission(this.progress, s.mission.id, result);
    }
    this.persist(); return true;
  }
  settings(patch: Partial<Progress['settings']>) {
    this.progress = { ...this.progress, settings: { ...this.progress.settings, ...patch } }; this.persist();
  }
  reset() {
    this.progress = resetProgress(this.store); this.select(0); this.persist();
  }
  private persist() { this.saved = saveProgress(this.store, this.progress); }
}

/** Campaign access follows the preceding village's saved delivery. */
export function missionUnlocked(progress: Progress, campaign: readonly { id: string }[], index: number): boolean {
  return index >= 0 && index < campaign.length && (index === 0 || (progress.missions[campaign[index - 1].id]?.stars ?? 0) > 0);
}

/** Returning players continue at the first village still waiting for a letter. */
export function nextMissionIndex(progress: Progress, campaign: readonly { id: string }[]): number {
  const index = campaign.findIndex((mission) => !(progress.missions[mission.id]?.stars > 0));
  return index < 0 ? Math.max(0, campaign.length - 1) : index;
}
