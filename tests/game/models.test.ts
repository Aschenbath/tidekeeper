import { describe, expect, it } from 'vitest';
import { Mesh } from '@iwsdk/core';
import { createBoard, createBoat, createPiece, createCell, createDial, createHandle, createHandJoints } from '../../src/scene-assets/tidekeeper.scene-asset';
import { MISSIONS } from '../../src/game/missions';

describe('complete campaign models', () => {
  it('batches the finale terrain and preserves animated surfaces', () => {
    const board = createBoard(MISSIONS[8]);
    let calls = 0;
    board.traverse(o => { if (o instanceof Mesh) { calls++; expect(o.geometry.getAttribute('position').count).toBeGreaterThan(0); } });
    expect(calls).toBeLessThanOrEqual(14);
    expect(board.getObjectByName('Water')).toBeDefined();
    expect(board.getObjectByName('Beacon')).toBeDefined();
    MISSIONS[8].bars.forEach((_, i) => expect(board.getObjectByName(`Bar ${i}`)).toBeDefined());
  });
  it('supports every boat emblem, the fixed crossing, and mutable wait pips', () => {
    for (const shape of ['circle','triangle','square','diamond'] as const) expect(createBoat(shape).children.some(o => o.userData.parts?.includes(`${shape} emblem`))).toBe(true);
    const cross = createPiece('cross');
    expect(cross.children.some(o => o.userData.parts?.includes('Crossing pier'))).toBe(true);
    expect(createPiece('lock').getObjectByName('Wait 3')).toBeDefined();
  });
  it('leaves headroom below 100 mono draw calls for finale controls and effects', () => {
    const m = MISSIONS[8];
    const meshes = (object: ReturnType<typeof createBoard>) => { let count = 0; object.traverse(o => { if (o instanceof Mesh) count++; }); return count; };
    const terrain = meshes(createBoard(m));
    const pieces = m.solution.reduce((sum, p) => sum + meshes(createPiece(p.piece)), 0);
    const boats = m.boats.reduce((sum, b) => sum + meshes(createBoat(b.shape)), 0);
    const emptyCells = (m.grid.join('').match(/\./g)?.length ?? 0) - m.solution.length;
    const tray = (['straight','bend','lock'] as const).reduce((sum, p) => sum + (m.solution.filter(s => s.piece === p).length < m.budget[p] ? meshes(createPiece(p)) : 0), 0);
    const budget = terrain + pieces + boats * 2 + emptyCells * meshes(createCell()) + tray + meshes(createDial()) + meshes(createHandle()) + meshes(createHandJoints()) * 2;
    // Include 20 draws for UIKit, markers and pulse. Live renderer.info remains the acceptance gate.
    expect(budget + 20).toBeLessThanOrEqual(100);
    expect(meshes(createCell())).toBeLessThanOrEqual(2);
  });
});
