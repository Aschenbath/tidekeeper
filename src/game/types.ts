// Pure game types. Nothing in src/game imports IWSDK or Three, so the rules run and test in plain Node.

export type Dir = 0 | 1 | 2 | 3; // N, E, S, W; y grows towards the player (south)
export const N: Dir = 0, E: Dir = 1, S: Dir = 2, W: Dir = 3;
export const DIR_NAMES = ["N", "E", "S", "W"] as const;
export type DirName = (typeof DIR_NAMES)[number];

export type PieceType = "straight" | "bend" | "lock";
export const PIECE_TYPES: PieceType[] = ["straight", "bend", "lock"];
export type Shape = "circle" | "triangle" | "square" | "diamond";

export interface Placement {
  x: number;
  y: number;
  piece: PieceType;
  rot: number; // straight and lock: 0..1, bend: 0..3
  wait?: number; // lock only: 1..3 ticks
}

export interface Harbor { id: string; x: number; y: number; exit: Dir }
export interface Dock { x: number; y: number; open: Dir; shape: Shape }
export interface Bar { x: number; y: number; threshold: number }
export interface Boat { id: string; harbor: string; shape: Shape; launch: number }

export type Mastery =
  | { kind: "maxPieces"; value: number }
  | { kind: "arriveBy"; value: number }
  | { kind: "noLock" };

export interface Mission {
  id: string;
  title: string;
  coach: string[];
  width: number;
  height: number;
  /** Row strings, one char per cell: '#' rock, '~' open water (impassable scenery), '.' build slot,
   *  'H' harbor, 'D' dock, '=' fixed piece. Harbors, docks and fixed pieces are detailed in their lists. */
  grid: string[];
  harbors: Harbor[];
  docks: Dock[];
  fixed: Placement[];
  bars: Bar[];
  /** Tide level per tick, repeating. */
  tide: number[];
  boats: Boat[];
  budget: Record<PieceType, number>;
  tickLimit: number;
  mastery: Mastery;
  solution: Placement[];
}

export type FailureKind = "aground" | "deadEnd" | "collision" | "wrongDock" | "outOfTime";

export interface Failure {
  kind: FailureKind;
  boat: string;
  tick: number;
  x: number;
  y: number;
  reason: string;
  /** For dead ends into an empty build slot: the slot and the side the boat would enter through. */
  emptySlot?: { x: number; y: number; entry: Dir };
}

export type BoatStatus = "harbor" | "sailing" | "docked" | "failed";

export interface BoatFrame {
  id: string;
  x: number;
  y: number;
  status: BoatStatus;
  /** Direction of the last move (heading), for drawing the bow. */
  heading: Dir;
  lockRemaining: number;
}

export interface Frame {
  tick: number;
  level: number;
  /** Bars passable at this tick, in mission.bars order. */
  barsWet: boolean[];
  boats: BoatFrame[];
}

export type Outcome =
  | { kind: "success"; tick: number }
  | { kind: "failure"; tick: number; failures: Failure[] };

export interface Simulation {
  frames: Frame[];
  outcome: Outcome;
}
