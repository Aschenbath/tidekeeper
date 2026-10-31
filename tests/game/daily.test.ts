import { describe, expect, it } from "vitest";
import { dailyMission, hashString, localDate, mirror, prng } from "../../src/game/daily";
import { DAILY_TEMPLATES, MISSIONS } from "../../src/game/missions";
import { simulate } from "../../src/game/sim";

describe("daily remix", () => {
  it("has a stable seed and sequence", () => {
    expect(hashString("2026-11-01")).not.toBe(hashString("2026-11-02"));
    const a = prng(42), b = prng(42);
    const seq = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seq);
    for (const v of seq) expect(v >= 0 && v < 1).toBe(true);
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("mirroring keeps every stored solution working", () => {
    for (const m of MISSIONS)
      for (const axis of ["x", "y"] as const) {
        const flipped = mirror(m, axis);
        expect(simulate(flipped, flipped.solution).outcome, `${m.id} ${axis}`).toEqual(simulate(m, m.solution).outcome);
      }
  });

  it("gives the same proven, non-trivial puzzle for the same date", () => {
    for (let i = 0; i < 30; i++) {
      const date = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
      const day = dailyMission(date, DAILY_TEMPLATES);
      expect(dailyMission(date, DAILY_TEMPLATES)).toEqual(day);
      expect(day.attempt, date).toBeGreaterThanOrEqual(0);
      const m = day.mission;
      expect(simulate(m, m.solution).outcome.kind, date).toBe("success");
      expect(simulate(m, []).outcome.kind).toBe("failure");
      expect(m.solution.some((p) => p.piece !== "straight")).toBe(true);
      for (const piece of ["straight", "bend", "lock"] as const)
        expect(m.solution.filter((p) => p.piece === piece).length).toBeLessThanOrEqual(m.budget[piece]);
    }
  });
});
