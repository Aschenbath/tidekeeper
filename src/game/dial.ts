/** The tide dial reads like a clock face: angle 0 (away from the player) is tick 0, a full turn is the tick limit. */
export interface DialTurn {
  /** Unrounded position on the face from the previous frame, or null on the first frame of a grab. */
  previous: number | null;
  /** The end the dial stays at after the hand turned past the 12 o'clock seam, until it turns back across. */
  pinned: number | null;
}

export function startDialTurn(): DialTurn {
  return { previous: null, pinned: null };
}

/** Tick for a dial angle (radians, clockwise from away). The first frame of a grab jumps straight to the angle; after
 * that, crossing the seam holds the end it came from instead of jumping from the last tick to the first. */
export function dialTick(turn: DialTurn, angle: number, limit: number): number {
  const position = (((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * limit;
  if (turn.previous !== null && Math.abs(position - turn.previous) > limit / 2) {
    const forward = turn.previous > limit / 2;
    if (turn.pinned === null) turn.pinned = forward ? limit : 0;
    else if ((turn.pinned === limit) !== forward) turn.pinned = null;
  }
  turn.previous = position;
  return turn.pinned ?? Math.round(position);
}
