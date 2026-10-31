import { DIR_NAMES, PIECE_TYPES, type BoardPiece, type Dir, type Mission, type PieceType, type Placement, type Shape } from "./types";
import { rotations } from "./geometry";

const SHAPES: Shape[] = ["circle", "triangle", "square", "diamond"];

/** Mission JSON as authored: directions are written as "N" | "E" | "S" | "W". */
export interface RawMission extends Omit<Mission, "width" | "height" | "harbors" | "docks"> {
  harbors: { id: string; x: number; y: number; exit: string }[];
  docks: { x: number; y: number; open: string; shape: string }[];
}

function dir(value: string, where: string): Dir {
  const index = DIR_NAMES.indexOf(value as (typeof DIR_NAMES)[number]);
  if (index < 0) throw new Error(`${where}: direction must be N, E, S or W, got ${JSON.stringify(value)}`);
  return index as Dir;
}

/** Parses and validates a mission; throws with the mission id and the first problem found. */
export function loadMission(raw: RawMission): Mission {
  const fail = (message: string): never => { throw new Error(`Mission ${raw.id}: ${message}`); };
  const height = raw.grid.length;
  const width = raw.grid[0]?.length ?? 0;
  if (!height || !width || raw.grid.some((row) => row.length !== width)) fail("grid rows must be non-empty and equal length");
  if (width > 7 || height > 6) fail("grid is larger than 7 × 6");
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? raw.grid[y][x] : undefined);
  const expect = (x: number, y: number, char: string, what: string) => {
    if (at(x, y) !== char) fail(`${what} at ${x},${y} must be '${char}' in the grid, found '${at(x, y) ?? "off-board"}'`);
  };
  for (const row of raw.grid) for (const char of row) if (!"#~.HD=".includes(char)) fail(`unknown grid char '${char}'`);

  const harbors = raw.harbors.map((h) => { expect(h.x, h.y, "H", `harbor ${h.id}`); return { ...h, exit: dir(h.exit, `harbor ${h.id}`) }; });
  const docks = raw.docks.map((d) => {
    expect(d.x, d.y, "D", "dock");
    if (!SHAPES.includes(d.shape as Shape)) fail(`dock shape ${d.shape}`);
    return { ...d, open: dir(d.open, "dock"), shape: d.shape as Shape };
  });
  const checkPiece = (p: BoardPiece, what: string, fixed = false) => {
    if (!PIECE_TYPES.includes(p.piece as PieceType) && !(fixed && p.piece === "cross")) fail(`${what}: unknown piece ${p.piece}`);
    if (!Number.isInteger(p.rot) || p.rot < 0 || p.rot >= rotations(p.piece)) fail(`${what}: bad rotation ${p.rot}`);
    if (p.piece === "lock" && ![1, 2, 3].includes(p.wait ?? 1)) fail(`${what}: lock wait must be 1..3`);
  };
  raw.fixed.forEach((p) => { expect(p.x, p.y, "=", "fixed piece"); checkPiece(p, `fixed ${p.x},${p.y}`, true); });
  for (const char of ["H", "D", "="]) {
    const listed = char === "H" ? harbors : char === "D" ? docks : raw.fixed;
    const count = raw.grid.join("").split(char).length - 1;
    if (count !== listed.length) fail(`grid has ${count} '${char}' cells but ${listed.length} are listed`);
  }
  for (const bar of raw.bars) {
    if (!".=".includes(at(bar.x, bar.y) ?? "#")) fail(`bar at ${bar.x},${bar.y} must be on a build slot or fixed piece`);
  }
  if (!raw.tide.length || raw.tide.some((level) => !Number.isInteger(level) || level < 0)) fail("tide must be non-negative integers");
  if (!raw.boats.length) fail("needs at least one boat");
  for (const boat of raw.boats) {
    if (!harbors.some((h) => h.id === boat.harbor)) fail(`boat ${boat.id} has unknown harbor ${boat.harbor}`);
    if (!SHAPES.includes(boat.shape)) fail(`boat ${boat.id} shape ${boat.shape}`);
    if (!docks.some((d) => d.shape === boat.shape)) fail(`no dock for boat ${boat.id} (${boat.shape})`);
  }
  if (new Set(raw.boats.map((b) => b.id)).size !== raw.boats.length) fail("boat ids must be unique");
  for (const piece of PIECE_TYPES) if (!Number.isInteger(raw.budget[piece]) || raw.budget[piece] < 0) fail(`budget.${piece}`);
  const used: Record<PieceType, number> = { straight: 0, bend: 0, lock: 0 };
  for (const p of raw.solution) {
    expect(p.x, p.y, ".", "solution piece");
    checkPiece(p, `solution ${p.x},${p.y}`);
    used[p.piece]++;
  }
  for (const piece of PIECE_TYPES) if (used[piece] > raw.budget[piece]) fail(`solution uses ${used[piece]} ${piece} over budget`);
  return { ...raw, width, height, harbors, docks };
}
