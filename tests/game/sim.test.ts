import { describe, expect, it } from "vitest";
import { exitSide, openings } from "../../src/game/geometry";
import { loadMission, type RawMission } from "../../src/game/mission";
import { MISSIONS } from "../../src/game/missions";
import { simulate } from "../../src/game/sim";
import { solve } from "../../src/game/solver";
import { E, N, S, W, type Mission, type Placement } from "../../src/game/types";

const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;
const raw = (overrides: Partial<RawMission>): RawMission => ({
  id: "t", title: "test", coach: [], grid: [], harbors: [], docks: [], fixed: [], bars: [], tide: [1], boats: [],
  budget: { straight: 9, bend: 9, lock: 9 }, tickLimit: 20, mastery: { kind: "noLock" }, solution: [], ...overrides,
});
const withLimit = (mission: Mission, tickLimit: number): Mission => ({ ...mission, tickLimit });

describe("geometry", () => {
  it("rotates openings clockwise", () => {
    expect(openings("straight", 1)).toEqual([E, W]);
    expect(openings("bend", 2)).toEqual([S, W]);
    expect(exitSide({ piece: "bend", rot: 0 }, N)).toBe(E);
    expect(exitSide({ piece: "bend", rot: 0 }, S)).toBeNull();
  });
});

describe("mission loader", () => {
  it("rejects unequal rows, unlisted harbors and over-budget solutions", () => {
    expect(() => loadMission(raw({ grid: ["H.D", "~~"] }))).toThrow(/equal length/);
    expect(() => loadMission(raw({ grid: ["H.D"], docks: [{ x: 2, y: 0, open: "W", shape: "circle" }] }))).toThrow(/'H' cells/);
    expect(() => loadMission(raw({
      grid: ["H.D"], harbors: [{ id: "h", x: 0, y: 0, exit: "E" }], docks: [{ x: 2, y: 0, open: "W", shape: "circle" }],
      boats: [{ id: "b", harbor: "h", shape: "circle", launch: 0 }], budget: { straight: 0, bend: 0, lock: 0 },
      solution: [{ x: 1, y: 0, piece: "straight", rot: 1 }],
    }))).toThrow(/over budget/);
  });
});

describe("simulation", () => {
  it("delivers mission 1 along the expected cells", () => {
    const m = byId("m01");
    const run = simulate(m, m.solution);
    expect(run.outcome).toEqual({ kind: "success", tick: 4 });
    expect(run.frames.map((f) => `${f.boats[0].x},${f.boats[0].y}`)).toEqual(["0,1", "1,1", "2,1", "2,2", "2,3"]);
  });

  it("reports a dead end at an empty slot with the entry side", () => {
    const run = simulate(byId("m01"), []);
    expect(run.outcome.kind).toBe("failure");
    if (run.outcome.kind !== "failure") return;
    expect(run.outcome.failures).toMatchObject([{ kind: "deadEnd", tick: 2, x: 1, y: 1, emptySlot: { x: 2, y: 1, entry: W } }]);
  });

  it("reports a dead end when the next piece does not connect", () => {
    const run = simulate(byId("m01"), [{ x: 2, y: 1, piece: "bend", rot: 0 }]);
    expect(run.outcome).toMatchObject({ kind: "failure", failures: [{ kind: "deadEnd", reason: "The next channel does not connect" }] });
  });

  it("refuses a dock of the wrong shape", () => {
    const run = simulate(byId("m02"), [{ x: 1, y: 0, piece: "straight", rot: 1 }, { x: 1, y: 2, piece: "straight", rot: 1 }, { x: 2, y: 2, piece: "straight", rot: 1 }]);
    expect(run.outcome).toMatchObject({ kind: "failure", tick: 2, failures: [{ kind: "wrongDock", boat: "tri", x: 2, y: 0 }] });
  });

  it("runs aground on a dry bar and names the tick", () => {
    const m = byId("m03");
    const run = simulate(m, [{ x: 1, y: 1, piece: "straight", rot: 1 }, { x: 2, y: 1, piece: "straight", rot: 1 }]);
    expect(run.outcome).toMatchObject({ kind: "failure", tick: 3, failures: [{ kind: "aground", x: 3, y: 1 }] });
    if (run.outcome.kind === "failure") expect(run.outcome.failures[0].reason).toContain("tick 3");
    expect(run.frames[3].barsWet).toEqual([false]);
    expect(run.frames[0].barsWet).toEqual([true]);
  });

  it("holds boats in a lock for its wait", () => {
    const m = byId("m04");
    const board = (wait: number): Placement[] => [{ x: 1, y: 1, piece: "lock", rot: 1, wait }, { x: 2, y: 1, piece: "straight", rot: 1 }];
    expect(simulate(m, board(1)).outcome).toMatchObject({ kind: "failure", tick: 4, failures: [{ kind: "aground" }] });
    expect(simulate(m, board(2)).outcome).toEqual({ kind: "success", tick: 6 });
    expect(simulate(m, board(3)).outcome).toEqual({ kind: "success", tick: 7 });
    const run = simulate(m, board(2));
    expect(run.frames.slice(1, 5).map((f) => [f.boats[0].x, f.boats[0].lockRemaining])).toEqual([[1, 2], [1, 1], [1, 0], [2, 0]]);
  });

  it("collides two boats entering one cell together", () => {
    const m = loadMission(raw({
      grid: ["~H~~", "H.=D", "~~~~"],
      harbors: [{ id: "w", x: 0, y: 1, exit: "E" }, { id: "n", x: 1, y: 0, exit: "S" }],
      docks: [{ x: 3, y: 1, open: "W", shape: "circle" }], fixed: [{ x: 2, y: 1, piece: "straight", rot: 1 }],
      boats: [{ id: "a", harbor: "w", shape: "circle", launch: 0 }, { id: "b", harbor: "n", shape: "circle", launch: 0 }],
    }));
    const run = simulate(m, [{ x: 1, y: 1, piece: "bend", rot: 3 }]);
    expect(run.outcome).toMatchObject({ kind: "failure", tick: 1, failures: [{ kind: "collision", boat: "a" }, { kind: "collision", boat: "b" }] });
  });

  it("collides two boats swapping cells", () => {
    const m = loadMission(raw({
      grid: ["~DD~", "H..H", "~~~~"],
      harbors: [{ id: "w", x: 0, y: 1, exit: "E" }, { id: "e", x: 3, y: 1, exit: "W" }],
      docks: [{ x: 1, y: 0, open: "S", shape: "circle" }, { x: 2, y: 0, open: "S", shape: "triangle" }],
      boats: [{ id: "a", harbor: "w", shape: "circle", launch: 0 }, { id: "b", harbor: "e", shape: "triangle", launch: 0 }],
    }));
    const run = simulate(m, [{ x: 1, y: 1, piece: "straight", rot: 1 }, { x: 2, y: 1, piece: "straight", rot: 1 }]);
    expect(run.outcome).toMatchObject({ kind: "failure", tick: 2, failures: [{ kind: "collision" }, { kind: "collision" }] });
  });

  it("keeps later boats in harbor until their launch tick", () => {
    const m = loadMission(raw({
      grid: ["H.D"], harbors: [{ id: "h", x: 0, y: 0, exit: "E" }], docks: [{ x: 2, y: 0, open: "W", shape: "circle" }],
      boats: [{ id: "a", harbor: "h", shape: "circle", launch: 0 }, { id: "b", harbor: "h", shape: "circle", launch: 2 }],
    }));
    const run = simulate(m, [{ x: 1, y: 0, piece: "straight", rot: 1 }]);
    expect(run.outcome).toEqual({ kind: "success", tick: 4 });
    expect(run.frames[2].boats[1].status).toBe("harbor");
    expect(run.frames[3].boats[1]).toMatchObject({ x: 1, status: "sailing" });
  });

  it("runs out of time at the tick limit", () => {
    const m = withLimit(byId("m01"), 3);
    const run = simulate(m, m.solution);
    expect(run.outcome).toMatchObject({ kind: "failure", tick: 3, failures: [{ kind: "outOfTime", boat: "b1" }] });
    expect(run.frames).toHaveLength(4);
  });

  it("is pure: the same board gives the same frames and is not mutated", () => {
    const m = byId("m04");
    const board = structuredClone(m.solution);
    expect(simulate(m, board)).toEqual(simulate(m, board));
    expect(board).toEqual(m.solution);
  });
});

describe("campaign missions", () => {
  for (const m of MISSIONS) {
    it(`${m.id} ${m.title}: stored solution works, empty board fails, solver finds a working board`, () => {
      expect(simulate(m, m.solution).outcome.kind).toBe("success");
      expect(simulate(m, []).outcome.kind).toBe("failure");
      const result = solve(m);
      expect(result.exhausted).toBe(false);
      expect(result.solution).not.toBeNull();
      expect(simulate(m, result.solution!).outcome.kind).toBe("success");
    });
  }

  it("mission 1 is a single piece", () => {
    expect(byId("m01").solution).toHaveLength(1);
    expect(byId("m01").budget).toEqual({ straight: 0, bend: 1, lock: 0 });
  });

  it("solver reports an unsolvable budget", () => {
    const m = { ...byId("m04"), budget: { straight: 2, bend: 0, lock: 0 } };
    expect(solve(m)).toMatchObject({ solution: null, exhausted: false });
  });
});
