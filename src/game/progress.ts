// Saved progress. Pure functions over a plain object; the view passes in localStorage (or nothing) and every access is
// guarded, so the game still works when storage is blocked, full or cleared.

export interface MissionRecord { stars: number; pieces: number; tick: number }

export interface Progress {
  version: 1;
  missions: Record<string, MissionRecord>;
  daily: { lastSolved: string | null; streak: number; best: Record<string, { pieces: number; tick: number }> };
  settings: { reach: "near" | "far"; sound: boolean; panel: "right" | "left" };
}

export const STORAGE_KEY = "tidekeeper.progress.v1";

export function emptyProgress(): Progress {
  return { version: 1, missions: {}, daily: { lastSolved: null, streak: 0, best: {} }, settings: { reach: "near", sound: true, panel: "right" } };
}

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);

/** Reads saved progress, keeping every well-formed field and dropping the rest. */
export function parseProgress(text: string | null | undefined): Progress {
  const p = emptyProgress();
  let raw: any;
  try { raw = JSON.parse(text ?? ""); } catch { return p; }
  if (!raw || typeof raw !== "object" || raw.version !== 1) return p;
  for (const [id, r] of Object.entries(raw.missions ?? {}) as [string, any][]) {
    const stars = count(r?.stars), pieces = count(r?.pieces), tick = count(r?.tick);
    if (stars !== null && stars <= 3 && pieces !== null && tick !== null) p.missions[id] = { stars, pieces, tick };
  }
  if (isDate(raw.daily?.lastSolved)) p.daily.lastSolved = raw.daily.lastSolved;
  p.daily.streak = count(raw.daily?.streak) ?? 0;
  for (const [date, r] of Object.entries(raw.daily?.best ?? {}) as [string, any][]) {
    const pieces = count(r?.pieces), tick = count(r?.tick);
    if (isDate(date) && pieces !== null && tick !== null) p.daily.best[date] = { pieces, tick };
  }
  if (raw.settings?.reach === "far") p.settings.reach = "far";
  if (raw.settings?.sound === false) p.settings.sound = false;
  if (raw.settings?.panel === "left") p.settings.panel = "left";
  return p;
}

const better = (a: { pieces: number; tick: number }, b: { pieces: number; tick: number }) => a.pieces < b.pieces || (a.pieces === b.pieces && a.tick < b.tick);

/** Records a finished campaign mission, keeping the best stars and the best board. */
export function recordMission(p: Progress, id: string, result: MissionRecord): Progress {
  const old = p.missions[id];
  const next = !old ? result : {
    stars: Math.max(old.stars, result.stars),
    ...(better(result, old) ? { pieces: result.pieces, tick: result.tick } : { pieces: old.pieces, tick: old.tick }),
  };
  return { ...p, missions: { ...p.missions, [id]: next } };
}

/** The calendar day before a YYYY-MM-DD date. */
export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Records a solved daily puzzle: the streak grows on consecutive days, restarts after a gap, and counts a day once. */
export function recordDaily(p: Progress, date: string, result: { pieces: number; tick: number }): Progress {
  const last = p.daily.lastSolved;
  const streak = last === date ? p.daily.streak : last === previousDay(date) ? p.daily.streak + 1 : 1;
  const old = p.daily.best[date];
  const best = !old || better(result, old) ? result : old;
  const lastSolved = last && last > date ? last : date;
  return { ...p, daily: { lastSolved, streak: lastSolved === date ? streak : p.daily.streak, best: { ...p.daily.best, [date]: best } } };
}

/** The streak to show today: still alive if the last solve was today or yesterday. */
export function currentStreak(p: Progress, today: string): number {
  const last = p.daily.lastSolved;
  return last === today || last === previousDay(today) ? p.daily.streak : 0;
}

/** Villages lit on the archipelago map: one per solved campaign mission. */
export function villagesLit(p: Progress, campaign: readonly { id: string }[]): string[] {
  return campaign.filter((m) => (p.missions[m.id]?.stars ?? 0) > 0).map((m) => m.id);
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadProgress(store: Store | undefined): Progress {
  try { return parseProgress(store?.getItem(STORAGE_KEY)); } catch { return emptyProgress(); }
}

/** Returns false when the progress could not be saved (blocked or full storage); the game carries on in memory. */
export function saveProgress(store: Store | undefined, p: Progress): boolean {
  try { if (!store) return false; store.setItem(STORAGE_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

export function resetProgress(store: Store | undefined): Progress {
  try { store?.removeItem(STORAGE_KEY); } catch { /* storage unavailable: nothing to clear */ }
  return emptyProgress();
}
