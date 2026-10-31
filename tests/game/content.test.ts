import { describe, expect, it } from "vitest";
import { exitSide } from "../../src/game/geometry";
import { loadMission, type RawMission } from "../../src/game/mission";
import { MISSIONS } from "../../src/game/missions";
import { masteryMet } from "../../src/game/score";
import { simulate } from "../../src/game/sim";
import { allSolutions } from "../../src/game/solver";
import { E, N, S, W, type Placement } from "../../src/game/types";

const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;
const straight = (x: number, y: number, rot: 0 | 1): Placement => ({ x, y, piece: "straight", rot });

describe("crossing", () => {
  it("carries boats straight through from every side", () => {
    for (const entry of [N, E, S, W]) expect(exitSide({ piece: "cross", rot: 0 }, entry)).toBe((entry + 2) % 4);
  });

  it("is a mission piece only: players cannot place one", () => {
    const raw = structuredClone(byId("m05")) as unknown as RawMission;
    raw.harbors = raw.harbors.map((h) => ({ ...h, exit: ["N", "E", "S", "W"][h.exit as unknown as number] }));
    raw.docks = raw.docks.map((d) => ({ ...d, open: ["N", "E", "S", "W"][d.open as unknown as number] }));
    raw.solution = [{ x: 1, y: 2, piece: "cross" as never, rot: 0 }];
    expect(() => loadMission(raw)).toThrow(/unknown piece cross/);
  });
});

describe("missions 5-9", () => {
  it("m05: boats meeting in the crossing collide; the lock belongs on the shorter route", () => {
    const m = byId("m05");
    const line = [straight(1, 2, 1), straight(3, 2, 1), straight(4, 2, 1), straight(2, 1, 0), straight(2, 3, 0)];
    expect(simulate(m, line).outcome).toMatchObject({ kind: "failure", tick: 2, failures: [{ kind: "collision", x: 2, y: 2 }, { kind: "collision" }] });
    const lockWest = [{ ...line[0], piece: "lock" as const, wait: 1 }, ...line.slice(1)];
    const run = simulate(m, lockWest);
    expect(run.outcome).toEqual({ kind: "success", tick: 6 });
    expect(masteryMet(m, lockWest, run)).toBe(false);
  });

  it("m06: the long way round uses the slot the second boat needs", () => {
    const m = byId("m06");
    const long: Placement[] = [straight(1, 2, 1), { x: 4, y: 2, piece: "bend", rot: 3 }, straight(4, 1, 0), { x: 4, y: 0, piece: "bend", rot: 1 }, straight(4, 3, 0)];
    expect(simulate(m, long).outcome).toMatchObject({ kind: "failure", failures: [{ kind: "deadEnd", boat: "tri" }] });
  });

  it("m07: a short wait clears the deep bar and grounds on the shallow one", () => {
    const m = byId("m07");
    const board: Placement[] = [{ x: 1, y: 1, piece: "lock", rot: 1, wait: 1 }, straight(2, 1, 1), straight(3, 1, 1)];
    expect(simulate(m, board).outcome).toMatchObject({ kind: "failure", tick: 6, failures: [{ kind: "aground", x: 5, y: 1 }] });
  });

  it("m08: a straight run meets the triangle in the crossing; a long wait lets the next circle catch up", () => {
    const m = byId("m08");
    const plain = m.solution.map((p) => (p.piece === "lock" ? straight(p.x, p.y, 1) : p));
    expect(simulate(m, plain).outcome).toMatchObject({ kind: "failure", tick: 3, failures: [{ kind: "collision", x: 3, y: 2 }, { kind: "collision" }] });
    const longWait = m.solution.map((p) => (p.piece === "lock" ? { ...p, wait: 3 } : p));
    expect(simulate(m, longWait).outcome).toMatchObject({ kind: "failure", failures: [{ kind: "collision", x: 1, y: 2 }, { kind: "collision" }] });
  });

  it("m09: without the lock the circle runs aground; only two boards work", () => {
    const m = byId("m09");
    const noLock = m.solution.map((p) => (p.piece === "lock" ? straight(p.x, p.y, 1) : p));
    expect(simulate(m, noLock).outcome).toMatchObject({ kind: "failure", failures: [{ kind: "aground", x: 5, y: 3 }] });
    expect(allSolutions(m).solutions).toHaveLength(2);
  });

  it("every stored solution earns mastery, and mastery is not automatic where routes differ", () => {
    for (const m of MISSIONS) expect(masteryMet(m, m.solution, simulate(m, m.solution)), m.id).toBe(true);
    for (const id of ["m05", "m07", "m08"]) {
      const m = byId(id);
      expect(allSolutions(m).solutions.some((s) => !masteryMet(m, s, simulate(m, s))), id).toBe(true);
    }
  });
});
