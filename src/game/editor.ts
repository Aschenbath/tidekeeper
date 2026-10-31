import { DX, DY, hasOpening, key, opposite, openings, rotations } from "./geometry";
import { pieceMap } from "./sim";
import { PIECE_TYPES, type Dir, type Mission, type PieceType, type Placement } from "./types";

export type EditResult = { ok: true } | { ok: false; reason: string };

/** Whether the neighbour of (x, y) in direction `side` has an opening facing back at (x, y). */
export function connectsTowards(mission: Mission, placements: readonly Placement[], x: number, y: number, side: Dir): boolean {
  const nx = x + DX[side], ny = y + DY[side], back = opposite(side);
  if (mission.harbors.some((h) => h.x === nx && h.y === ny && h.exit === back)) return true;
  if (mission.docks.some((d) => d.x === nx && d.y === ny && d.open === back)) return true;
  const piece = pieceMap(mission, placements).get(key(nx, ny));
  return !!piece && hasOpening(piece, back);
}

/** The rotation that joins the most neighbouring channels (lowest rotation on ties), so a dropped piece usually lands right. */
export function autoRotation(mission: Mission, placements: readonly Placement[], x: number, y: number, piece: PieceType): number {
  let best = 0, bestScore = -1;
  for (let rot = 0; rot < rotations(piece); rot++) {
    const score = openings(piece, rot).filter((side) => connectsTowards(mission, placements, x, y, side)).length;
    if (score > bestScore) { best = rot; bestScore = score; }
  }
  return best;
}

/** The player's board for one mission, with unbounded undo/redo. Every change goes through here. */
export class Editor {
  private past: Placement[][] = [];
  private future: Placement[][] = [];
  private current: Placement[] = [];

  constructor(readonly mission: Mission) {}

  get placements(): readonly Placement[] { return this.current; }

  pieceAt(x: number, y: number): Placement | undefined {
    return this.current.find((p) => p.x === x && p.y === y);
  }

  isBuildSlot(x: number, y: number): boolean {
    return this.mission.grid[y]?.[x] === ".";
  }

  remaining(piece: PieceType): number {
    return this.mission.budget[piece] - this.current.filter((p) => p.piece === piece).length;
  }

  remainingAll(): Record<PieceType, number> {
    return Object.fromEntries(PIECE_TYPES.map((piece) => [piece, this.remaining(piece)])) as Record<PieceType, number>;
  }

  place(x: number, y: number, piece: PieceType, rot?: number): EditResult {
    if (!this.isBuildSlot(x, y)) return { ok: false, reason: "Not a build slot" };
    if (this.pieceAt(x, y)) return { ok: false, reason: "Slot already has a piece" };
    if (this.remaining(piece) <= 0) return { ok: false, reason: `No ${piece} pieces left` };
    const r = rot ?? autoRotation(this.mission, this.current, x, y, piece);
    return this.commit([...this.current, { x, y, piece, rot: r % rotations(piece), ...(piece === "lock" ? { wait: 1 } : {}) }]);
  }

  rotate(x: number, y: number): EditResult {
    const p = this.pieceAt(x, y);
    if (!p) return { ok: false, reason: "No piece to rotate" };
    return this.replace(p, { ...p, rot: (p.rot + 1) % rotations(p.piece) });
  }

  cycleWait(x: number, y: number): EditResult {
    const p = this.pieceAt(x, y);
    if (!p || p.piece !== "lock") return { ok: false, reason: "Only locks have a wait" };
    return this.replace(p, { ...p, wait: ((p.wait ?? 1) % 3) + 1 });
  }

  remove(x: number, y: number): EditResult {
    const p = this.pieceAt(x, y);
    if (!p) return { ok: false, reason: "No piece to remove" };
    return this.commit(this.current.filter((q) => q !== p));
  }

  /** Moves a placed piece to another empty build slot as one undoable step (re-oriented to fit). */
  move(fromX: number, fromY: number, x: number, y: number): EditResult {
    const p = this.pieceAt(fromX, fromY);
    if (!p) return { ok: false, reason: "No piece to move" };
    if (!this.isBuildSlot(x, y) || this.pieceAt(x, y)) return { ok: false, reason: "Target is not an empty build slot" };
    const rest = this.current.filter((q) => q !== p);
    return this.commit([...rest, { ...p, x, y, rot: autoRotation(this.mission, rest, x, y, p.piece) }]);
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.current);
    this.current = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.current);
    this.current = next;
    return true;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** Clears the board; undoable like any other change. */
  restart(): EditResult {
    if (!this.current.length) return { ok: false, reason: "Board is already empty" };
    return this.commit([]);
  }

  /** Places one piece of the stored solution that is not on the board yet, replacing a wrong piece in that slot. */
  hint(): Placement | null {
    const missing = this.mission.solution.find((s) => {
      const p = this.pieceAt(s.x, s.y);
      return !p || p.piece !== s.piece || p.rot !== s.rot || (s.piece === "lock" && (p.wait ?? 1) !== (s.wait ?? 1));
    });
    if (!missing) return null;
    const rest = this.current.filter((p) => !(p.x === missing.x && p.y === missing.y));
    const used = rest.filter((p) => p.piece === missing.piece).length;
    if (used >= this.mission.budget[missing.piece]) {
      // Free a piece of that type that is not part of the solution.
      const spare = rest.find((p) => p.piece === missing.piece && !this.mission.solution.some((s) => s.x === p.x && s.y === p.y));
      if (!spare) return null;
      rest.splice(rest.indexOf(spare), 1);
    }
    this.commit([...rest, { ...missing }]);
    return missing;
  }

  private replace(old: Placement, next: Placement): EditResult {
    return this.commit(this.current.map((p) => (p === old ? next : p)));
  }

  private commit(next: Placement[]): EditResult {
    this.past.push(this.current);
    this.future = [];
    this.current = next;
    return { ok: true };
  }
}
