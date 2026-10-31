import { describe, expect, it } from "vitest";
import { currentStreak, emptyProgress, loadProgress, parseProgress, previousDay, recordDaily, recordMission, resetProgress, saveProgress, villagesLit } from "../../src/game/progress";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};
const fail = (): never => { throw new Error("storage blocked"); };
const broken = { getItem: fail, setItem: fail, removeItem: fail };

describe("progress", () => {
  it("survives missing, broken and partly valid saves", () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress("{not json")).toEqual(emptyProgress());
    const p = parseProgress(JSON.stringify({
      version: 1, missions: { m01: { stars: 3, pieces: 1, tick: 4 }, m02: { stars: 9 } },
      daily: { lastSolved: "nope", streak: -1 }, settings: { reach: "far" },
    }));
    expect(p.missions).toEqual({ m01: { stars: 3, pieces: 1, tick: 4 } });
    expect(p.daily).toEqual({ lastSolved: null, streak: 0, best: {} });
    expect(p.settings).toEqual({ reach: "far", sound: true });
  });

  it("keeps the best stars and board per mission", () => {
    let p = recordMission(emptyProgress(), "m02", { stars: 2, pieces: 5, tick: 4 });
    p = recordMission(p, "m02", { stars: 1, pieces: 4, tick: 6 });
    expect(p.missions.m02).toEqual({ stars: 2, pieces: 4, tick: 6 });
    expect(villagesLit(p, [{ id: "m01" }, { id: "m02" }])).toEqual(["m02"]);
  });

  it("grows the daily streak on consecutive days only", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
    let p = recordDaily(emptyProgress(), "2026-12-31", { pieces: 4, tick: 9 });
    p = recordDaily(p, "2027-01-01", { pieces: 4, tick: 9 });
    p = recordDaily(p, "2027-01-01", { pieces: 3, tick: 9 });
    expect(p.daily.streak).toBe(2);
    expect(p.daily.best["2027-01-01"]).toEqual({ pieces: 3, tick: 9 });
    expect(currentStreak(p, "2027-01-02")).toBe(2);
    expect(currentStreak(p, "2027-01-03")).toBe(0);
    expect(recordDaily(p, "2027-01-05", { pieces: 4, tick: 9 }).daily.streak).toBe(1);
  });

  it("works without storage and round-trips with it", () => {
    expect(loadProgress(broken)).toEqual(emptyProgress());
    expect(saveProgress(broken, emptyProgress())).toBe(false);
    expect(resetProgress(broken)).toEqual(emptyProgress());
    expect(loadProgress(undefined)).toEqual(emptyProgress());
    const store = memory();
    const p = recordMission(emptyProgress(), "m01", { stars: 3, pieces: 1, tick: 4 });
    expect(saveProgress(store, p)).toBe(true);
    expect(loadProgress(store)).toEqual(p);
    resetProgress(store);
    expect(loadProgress(store)).toEqual(emptyProgress());
  });
});
