import type { Mission, Placement, Simulation } from "./types";

/** Stars for a finished run: 1 for delivering everything, +1 without hints, +1 for the mission's mastery goal. */
export function stars(mission: Mission, placements: readonly Placement[], run: Simulation, hintsUsed: number): 0 | 1 | 2 | 3 {
  if (run.outcome.kind !== "success") return 0;
  return (1 + (hintsUsed === 0 ? 1 : 0) + (masteryMet(mission, placements, run) ? 1 : 0)) as 1 | 2 | 3;
}

export function masteryMet(mission: Mission, placements: readonly Placement[], run: Simulation): boolean {
  if (run.outcome.kind !== "success") return false;
  const goal = mission.mastery;
  if (goal.kind === "maxPieces") return placements.length <= goal.value;
  if (goal.kind === "arriveBy") return run.outcome.tick <= goal.value;
  return !placements.some((p) => p.piece === "lock");
}

export function masteryText(mission: Mission): string {
  const goal = mission.mastery;
  if (goal.kind === "maxPieces") return `Use at most ${goal.value} pieces`;
  if (goal.kind === "arriveBy") return `Deliver everything by tick ${goal.value}`;
  return "Solve it without a lock";
}
