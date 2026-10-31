import type { Dir, PieceType, Placement } from "./types";

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
export const key = (x: number, y: number) => `${x},${y}`;

const BASE: Record<PieceType, Dir[]> = { straight: [0, 2], lock: [0, 2], bend: [0, 1] };

export function rotations(piece: PieceType): number {
  return piece === "bend" ? 4 : 2;
}

/** Open sides of a piece: the base openings turned clockwise `rot` quarter turns. */
export function openings(piece: PieceType, rot: number): Dir[] {
  return BASE[piece].map((d) => ((d + rot) % 4) as Dir);
}

export function hasOpening(p: Pick<Placement, "piece" | "rot">, side: Dir): boolean {
  return openings(p.piece, p.rot).includes(side);
}

/** The side a boat leaves through after entering through `entry`, or null if `entry` is closed. */
export function exitSide(p: Pick<Placement, "piece" | "rot">, entry: Dir): Dir | null {
  const open = openings(p.piece, p.rot);
  if (!open.includes(entry)) return null;
  return open.find((d) => d !== entry) ?? null;
}
