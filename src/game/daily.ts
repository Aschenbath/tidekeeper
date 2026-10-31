import { openings, rotations } from "./geometry";
import { simulate } from "./sim";
import { allSolutions } from "./solver";
import type { BoardPiece, Dir, Mission, Placement, Shape } from "./types";

/** mulberry32: a tiny deterministic PRNG, so the same seed gives the same puzzle on every device. */
export function prng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the string's UTF-16 code units. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The player's local calendar day as YYYY-MM-DD; the daily puzzle follows their own day. */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const FLIP: Record<"x" | "y", (d: Dir) => Dir> = {
  x: (d) => (d === 1 ? 3 : d === 3 ? 1 : d) as Dir,
  y: (d) => (d === 0 ? 2 : d === 2 ? 0 : d) as Dir,
};

/** The rotation whose openings are this piece's openings flipped. */
function flipPiece<T extends Pick<BoardPiece, "piece" | "rot">>(p: T, flip: (d: Dir) => Dir): T {
  const want = openings(p.piece, p.rot).map(flip).sort().join();
  for (let rot = 0; rot < rotations(p.piece); rot++) if (openings(p.piece, rot).sort().join() === want) return { ...p, rot };
  return p;
}

/** Mirrors a mission left-right ("x") or top-bottom ("y"); the mirrored stored solution still works. */
export function mirror(mission: Mission, axis: "x" | "y"): Mission {
  const flip = FLIP[axis];
  const at = (x: number, y: number) => (axis === "x" ? { x: mission.width - 1 - x, y } : { x, y: mission.height - 1 - y });
  const move = <T extends { x: number; y: number }>(p: T): T => ({ ...p, ...at(p.x, p.y) });
  return {
    ...mission,
    grid: axis === "x" ? mission.grid.map((row) => [...row].reverse().join("")) : [...mission.grid].reverse(),
    harbors: mission.harbors.map((h) => ({ ...move(h), exit: flip(h.exit) })),
    docks: mission.docks.map((d) => ({ ...move(d), open: flip(d.open) })),
    fixed: mission.fixed.map((p) => flipPiece(move(p), flip)),
    bars: mission.bars.map(move),
    solution: mission.solution.map((p) => flipPiece(move(p), flip)),
  };
}

const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)];

/** One random variation of a template: mirrored, tide phase shifted, bar depths and later launches nudged, shapes relabelled. */
function vary(template: Mission, rand: () => number): Mission {
  let m = template;
  if (rand() < 0.5) m = mirror(m, "x");
  if (rand() < 0.5) m = mirror(m, "y");
  const shift = Math.floor(rand() * m.tide.length);
  const tide = m.tide.map((_, i) => m.tide[(i + shift) % m.tide.length]);
  const top = Math.max(...tide);
  const bars = m.bars.map((bar) => ({ ...bar, threshold: Math.min(top, Math.max(1, bar.threshold + pick(rand, [-1, 0, 0, 1]))) }));
  const boats = m.boats.map((boat) => (boat.launch > 0 ? { ...boat, launch: Math.max(1, boat.launch + pick(rand, [-1, 0, 1])) } : boat));
  const used = [...new Set(m.boats.map((b) => b.shape))];
  const pool: Shape[] = ["circle", "triangle", "square", "diamond"];
  // Fisher-Yates, not sort(random): sort order with a random comparator differs between engines.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const relabel = (shape: Shape) => (used.includes(shape) ? shuffled[used.indexOf(shape)] : shape);
  return {
    ...m, tide, bars,
    boats: boats.map((b) => ({ ...b, shape: relabel(b.shape) })),
    docks: m.docks.map((d) => ({ ...d, shape: relabel(d.shape) })),
    budget: { straight: m.budget.straight + 1, bend: m.budget.bend + 1, lock: m.budget.lock },
  };
}

const tickOf = (m: Mission, board: Placement[]) => simulate(m, board).outcome.tick;

export interface Daily { date: string; mission: Mission; template: string; attempt: number }

/**
 * The puzzle for a calendar day: a seeded variation of one campaign template that the solver proves solvable, that
 * the template's own answer no longer solves, and that straights alone cannot solve. The stored solution is the smallest working board found, and the
 * mastery goal is the earliest arrival when timing matters, otherwise the fewest pieces.
 */
export function dailyMission(date: string, templates: readonly Mission[], options: { attempts?: number; maxNodes?: number } = {}): Daily {
  const base = hashString(date);
  for (let attempt = 0; attempt < (options.attempts ?? 40); attempt++) {
    const rand = prng(base + attempt * 7919);
    const template = pick(rand, templates);
    const m = vary(template, rand);
    if (simulate(m, m.solution).outcome.kind === "success") continue;
    const { solutions } = allSolutions(m, { maxNodes: options.maxNodes ?? 30_000, limit: 400 });
    if (!solutions.length) continue;
    // A variation that a plain line of straights solves has lost the template's idea (tide, lock or timing).
    if (solutions.some((s) => s.every((p) => p.piece === "straight"))) continue;
    const best = [...solutions].sort((a, b) => a.length - b.length || tickOf(m, a) - tickOf(m, b))[0];
    const ticks = solutions.map((s) => tickOf(m, s));
    const fastest = Math.min(...ticks);
    const mission: Mission = {
      ...m, id: `daily-${date}`, title: `Daily tide · ${template.title}`, coach: [], solution: best,
      tickLimit: Math.max(m.tickLimit, Math.max(...ticks) + 2),
      mastery: fastest < Math.max(...ticks) ? { kind: "arriveBy", value: fastest } : { kind: "maxPieces", value: best.length },
    };
    return { date, mission, template: template.id, attempt };
  }
  const template = templates[base % templates.length];
  return { date, mission: { ...template, id: `daily-${date}`, title: `Daily tide · ${template.title}`, coach: [] }, template: template.id, attempt: -1 };
}
