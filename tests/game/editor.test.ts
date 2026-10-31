import { describe, expect, it } from "vitest";
import { autoRotation, Editor } from "../../src/game/editor";
import { MISSIONS } from "../../src/game/missions";
import { stars } from "../../src/game/score";
import { simulate } from "../../src/game/sim";

const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;

describe("editor", () => {
  it("auto-rotates a dropped piece to join its neighbours", () => {
    const m = byId("m01");
    expect(autoRotation(m, [], 2, 1, "bend")).toBe(2);
    const editor = new Editor(m);
    expect(editor.place(2, 1, "bend")).toEqual({ ok: true });
    expect(simulate(m, editor.placements).outcome.kind).toBe("success");
  });

  it("only places on empty build slots within budget", () => {
    const editor = new Editor(byId("m01"));
    expect(editor.place(1, 1, "bend")).toMatchObject({ ok: false, reason: "Not a build slot" });
    expect(editor.place(2, 1, "straight")).toMatchObject({ ok: false, reason: "No straight pieces left" });
    editor.place(2, 1, "bend");
    expect(editor.place(2, 1, "bend")).toMatchObject({ ok: false });
    expect(editor.remaining("bend")).toBe(0);
  });

  it("undoes and redoes every change in order", () => {
    const editor = new Editor(byId("m04"));
    editor.place(1, 1, "lock");
    editor.cycleWait(1, 1);
    editor.place(2, 1, "straight");
    editor.rotate(2, 1);
    const snapshots = [];
    snapshots.push(structuredClone(editor.placements));
    while (editor.undo()) snapshots.push(structuredClone(editor.placements));
    expect(snapshots).toHaveLength(5);
    expect(editor.placements).toEqual([]);
    while (editor.redo()) { /* replay */ }
    expect(editor.placements).toEqual(snapshots[0]);
    editor.undo();
    editor.remove(1, 1);
    expect(editor.canRedo).toBe(false);
  });

  it("cycles lock waits 1 → 2 → 3 → 1 and rejects waits on other pieces", () => {
    const editor = new Editor(byId("m04"));
    editor.place(1, 1, "lock");
    const waits = [editor.pieceAt(1, 1)!.wait];
    for (let i = 0; i < 3; i++) { editor.cycleWait(1, 1); waits.push(editor.pieceAt(1, 1)!.wait); }
    expect(waits).toEqual([1, 2, 3, 1]);
    editor.place(2, 1, "straight");
    expect(editor.cycleWait(2, 1)).toMatchObject({ ok: false });
  });

  it("moves a piece as one undoable step and restarts undoably", () => {
    const editor = new Editor(byId("m03"));
    editor.place(1, 0, "bend");
    editor.move(1, 0, 2, 2);
    expect(editor.pieceAt(1, 0)).toBeUndefined();
    expect(editor.pieceAt(2, 2)).toBeDefined();
    editor.undo();
    expect(editor.pieceAt(1, 0)).toBeDefined();
    editor.restart();
    expect(editor.placements).toEqual([]);
    editor.undo();
    expect(editor.placements).toHaveLength(1);
  });

  it("hints walk to the stored solution, replacing wrong pieces", () => {
    for (const m of MISSIONS) {
      const editor = new Editor(m);
      const first = m.solution[0];
      editor.place(first.x, first.y, first.piece, (first.rot + 1) % (first.piece === "bend" ? 4 : 2));
      let hints = 0;
      while (editor.hint()) hints++;
      expect(hints).toBe(m.solution.length);
      expect(simulate(m, editor.placements).outcome.kind).toBe("success");
    }
  });
});

describe("stars", () => {
  it("gives 3 for a clean mastery run, fewer with hints or a slow run", () => {
    const m = byId("m04");
    const fast = [{ x: 1, y: 1, piece: "lock" as const, rot: 1, wait: 2 }, { x: 2, y: 1, piece: "straight" as const, rot: 1 }];
    const slow = [{ ...fast[0], wait: 3 }, fast[1]];
    expect(stars(m, fast, simulate(m, fast), 0)).toBe(3);
    expect(stars(m, fast, simulate(m, fast), 1)).toBe(2);
    expect(stars(m, slow, simulate(m, slow), 0)).toBe(2);
    expect(stars(m, [], simulate(m, []), 0)).toBe(0);
  });
});
