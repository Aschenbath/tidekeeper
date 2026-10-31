import { DX, DY, exitSide, key, opposite } from "./geometry";
import type { BoatFrame, Dir, Failure, Frame, Mission, Placement, Simulation } from "./types";

export const tideLevel = (mission: Mission, tick: number) => mission.tide[tick % mission.tide.length];

export function barsWet(mission: Mission, tick: number): boolean[] {
  const level = tideLevel(mission, tick);
  return mission.bars.map((bar) => level >= bar.threshold);
}

/** Pieces on the board: the mission's fixed pieces plus the player's placements. */
export function pieceMap(mission: Mission, placements: readonly Placement[]): Map<string, Placement> {
  const map = new Map<string, Placement>();
  for (const p of mission.fixed) map.set(key(p.x, p.y), p);
  for (const p of placements) map.set(key(p.x, p.y), p);
  return map;
}

/**
 * Runs the mission with the given placements, one frame per tick from 0 until success or the first failing tick.
 * The preview and the launch animation both use these frames, so what the player previews is what happens.
 *
 * Each tick resolves in a fixed order:
 * 1. every boat picks its move: launch from its harbor, wait in a lock, or follow its channel;
 * 2. moves into rock, water, empty slots, closed sides, harbors or a dock's closed side are dead ends,
 *    and boats entering a dock of another shape are wrong-dock failures (both stay where they were);
 * 3. the remaining moves happen together; two sailing boats in one cell, or two boats swapping cells,
 *    collide (docks and harbors hold any number of boats);
 * 4. any sailing boat on a dry bar runs aground;
 * 5. if all boats are docked the mission succeeds; otherwise reaching the tick limit is out of time.
 * The run stops at the first tick with any failure and reports every failure of that tick.
 */
export function simulate(mission: Mission, placements: readonly Placement[]): Simulation {
  const pieces = pieceMap(mission, placements);
  const harbors = new Map(mission.harbors.map((h) => [h.id, h]));
  const docks = new Map(mission.docks.map((d) => [key(d.x, d.y), d]));
  const harborCells = new Set(mission.harbors.map((h) => key(h.x, h.y)));
  const bars = new Map(mission.bars.map((bar, index) => [key(bar.x, bar.y), index]));
  let boats: BoatFrame[] = mission.boats.map((boat) => {
    const harbor = harbors.get(boat.harbor)!;
    return { id: boat.id, x: harbor.x, y: harbor.y, status: "harbor", heading: harbor.exit, lockRemaining: 0 };
  });
  const frame = (tick: number): Frame => ({ tick, level: tideLevel(mission, tick), barsWet: barsWet(mission, tick), boats: boats.map((b) => ({ ...b })) });
  const frames: Frame[] = [frame(0)];

  for (let tick = 0; tick < mission.tickLimit; tick++) {
    const next = tick + 1;
    const failures: Failure[] = [];
    const fail = (boat: BoatFrame, kind: Failure["kind"], x: number, y: number, reason: string, extra: Partial<Failure> = {}) => {
      failures.push({ kind, boat: boat.id, tick: next, x, y, reason, ...extra });
    };
    const moved = boats.map((boat, index): BoatFrame => {
      if (boat.status === "docked" || boat.status === "failed") return { ...boat };
      if (boat.status === "harbor" && mission.boats[index].launch > tick) return { ...boat };
      if (boat.lockRemaining > 0) return { ...boat, lockRemaining: boat.lockRemaining - 1 };
      let heading: Dir;
      if (boat.status === "harbor") heading = harbors.get(mission.boats[index].harbor)!.exit;
      else {
        const here = pieces.get(key(boat.x, boat.y))!;
        heading = exitSide(here, opposite(boat.heading))!;
      }
      const x = boat.x + DX[heading], y = boat.y + DY[heading];
      const entry = opposite(heading);
      const cell = mission.grid[y]?.[x];
      const dock = docks.get(key(x, y));
      if (dock) {
        if (dock.open !== entry) { fail(boat, "deadEnd", boat.x, boat.y, "The dock is closed on this side"); return { ...boat, status: "failed" }; }
        if (dock.shape !== mission.boats[index].shape) {
          fail(boat, "wrongDock", x, y, `This ${mission.boats[index].shape} boat reached the ${dock.shape} dock`);
          return { ...boat, status: "failed" };
        }
        return { ...boat, x, y, heading, status: "docked" };
      }
      const piece = pieces.get(key(x, y));
      if (cell === undefined || cell === "#" || cell === "~" || harborCells.has(key(x, y))) {
        fail(boat, "deadEnd", boat.x, boat.y, cell === "~" ? "Open water is too rough: no channel ahead" : "Nothing but rock ahead");
        return { ...boat, status: "failed" };
      }
      if (!piece) {
        fail(boat, "deadEnd", boat.x, boat.y, "No channel here yet", { emptySlot: { x, y, entry } });
        return { ...boat, status: "failed" };
      }
      if (exitSide(piece, entry) === null) {
        fail(boat, "deadEnd", boat.x, boat.y, "The next channel does not connect");
        return { ...boat, status: "failed" };
      }
      return { ...boat, x, y, heading, status: "sailing", lockRemaining: piece.piece === "lock" ? piece.wait ?? 1 : 0 };
    });

    const sailing = moved.filter((b) => b.status === "sailing");
    for (let i = 0; i < sailing.length; i++) {
      for (let j = i + 1; j < sailing.length; j++) {
        const a = sailing[i], b = sailing[j];
        const before = (id: string) => boats.find((boat) => boat.id === id)!;
        const swapped = before(a.id).x === b.x && before(a.id).y === b.y && before(b.id).x === a.x && before(b.id).y === a.y;
        if ((a.x === b.x && a.y === b.y) || swapped) {
          for (const boat of [a, b]) if (!failures.some((f) => f.boat === boat.id))
            fail(boat, "collision", boat.x, boat.y, "Two boats met in one channel");
          a.status = b.status = "failed";
        }
      }
    }
    const wet = barsWet(mission, next);
    for (const boat of moved) {
      const bar = bars.get(key(boat.x, boat.y));
      if (boat.status === "sailing" && bar !== undefined && !wet[bar]) {
        fail(boat, "aground", boat.x, boat.y, `Runs aground: the bar is dry at tick ${next}`);
        boat.status = "failed";
      }
    }
    boats = moved;
    frames.push(frame(next));
    if (failures.length) return { frames, outcome: { kind: "failure", tick: next, failures } };
    if (boats.every((b) => b.status === "docked")) return { frames, outcome: { kind: "success", tick: next } };
  }
  const late = boats.filter((b) => b.status !== "docked").map((b): Failure => ({
    kind: "outOfTime", boat: b.id, tick: mission.tickLimit, x: b.x, y: b.y, reason: "The tide turned before this letter arrived",
  }));
  return { frames, outcome: { kind: "failure", tick: mission.tickLimit, failures: late } };
}
