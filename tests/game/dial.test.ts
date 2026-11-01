import { describe, expect, it } from "vitest";
import { dialTick, startDialTurn } from "../../src/game/dial";

const deg = (d: number) => (d * Math.PI) / 180;
const turn = (angles: number[], limit = 10) => { const t = startDialTurn(); return angles.map((a) => dialTick(t, deg(a), limit)); };

describe("tide dial", () => {
  it("reads like a clock face and jumps to the grabbed angle", () => {
    expect(turn([90, 180, 270])).toEqual([3, 5, 8]);
  });

  it("holds the last tick when turned forward past the seam, and follows again after turning back", () => {
    expect(turn([300, 350, 10, 40, 10, 350, 320])).toEqual([8, 10, 10, 10, 10, 10, 9]);
  });

  it("holds tick 0 when turned back past the seam", () => {
    expect(turn([40, 10, 340, 300, 340, 10, 40])).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  it("stays at the end through a second forward crossing", () => {
    expect(turn([340, 20, 200, 340, 20, 340])).toEqual([9, 10, 10, 10, 10, 9]);
  });
});
