import { exitSide, rotations } from "./geometry";
import { simulate } from "./sim";
import { PIECE_TYPES, type Dir, type Mission, type PieceType, type Placement } from "./types";

export interface SolveResult {
  solution: Placement[] | null;
  nodes: number;
  /** True when the search hit maxNodes before finishing, so "no solution" is not proven. */
  exhausted: boolean;
}

/** Pieces that accept a boat entering through `entry`, with every lock wait. */
function candidates(entry: Dir): { piece: PieceType; rot: number; wait?: number }[] {
  const out: { piece: PieceType; rot: number; wait?: number }[] = [];
  for (const piece of PIECE_TYPES)
    for (let rot = 0; rot < rotations(piece); rot++) {
      if (exitSide({ piece, rot }, entry) === null) continue;
      if (piece === "lock") for (const wait of [1, 2, 3]) out.push({ piece, rot, wait });
      else out.push({ piece, rot });
    }
  return out;
}

/**
 * Finds placements that deliver every boat. Boats follow their channels deterministically, so the first failure of a
 * partial board is either fixable only by filling the empty slot a boat is about to enter (we branch over every piece
 * that accepts it) or not fixable at all (collision, grounding, wrong dock, or a mismatched piece: we prune).
 * Pieces off every boat's path never matter, so this search is complete for the given budget.
 */
export function solve(mission: Mission, options: { maxNodes?: number; start?: Placement[] } = {}): SolveResult {
  let solution: Placement[] | null = null;
  const { nodes, exhausted } = explore(mission, options.maxNodes ?? 200_000, options.start ?? [], (board) => { solution = board; return true; });
  return { solution, nodes, exhausted };
}

/** Every working board the search can reach (pieces only on boat paths), up to `limit` boards. */
export function allSolutions(mission: Mission, options: { maxNodes?: number; limit?: number } = {}) {
  const solutions: Placement[][] = [];
  const limit = options.limit ?? 1000;
  const { nodes, exhausted } = explore(mission, options.maxNodes ?? 200_000, [], (board) => solutions.push(board) >= limit);
  return { solutions, nodes, exhausted };
}

/** Depth-first search over working boards; `visit` returns true to stop. */
function explore(mission: Mission, maxNodes: number, start: Placement[], visit: (board: Placement[]) => boolean) {
  let nodes = 0;
  let exhausted = false;
  let stopped = false;
  const search = (placements: Placement[]) => {
    if (++nodes > maxNodes) { exhausted = true; return; }
    const { outcome } = simulate(mission, placements);
    if (outcome.kind === "success") { stopped = visit(placements); return; }
    if (outcome.failures.some((f) => !f.emptySlot)) return;
    // Several boats can stall at empty slots in the same tick; fill the first and let re-simulation reach the others.
    const slot = outcome.failures[0].emptySlot!;
    if (mission.grid[slot.y]?.[slot.x] !== ".") return;
    for (const option of candidates(slot.entry)) {
      if (placements.filter((p) => p.piece === option.piece).length >= mission.budget[option.piece]) continue;
      search([...placements, { x: slot.x, y: slot.y, ...option }]);
      if (stopped || exhausted) return;
    }
  };
  search(start);
  return { nodes, exhausted };
}
