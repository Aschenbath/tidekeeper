import {
  createSystem, Entity, Object3D, Mesh, MeshStandardMaterial, ShaderMaterial,
  Grabbed, GrabSystem, OneHandGrabbable, RayInteractable, PokeInteractable,
  Pressed, Vector3, UIKitMLAsset, UIKit, VisibilityState, SessionMode,
} from '@iwsdk/core';
import assets from '../assets';
import { BoardItem, GameDebug, PokeCommit } from '../tidekeeper-components';
import { Session } from '../game/session';
import { Campaign, browserStorage, missionUnlocked } from '../game/campaign';
import { MISSIONS } from '../game/missions';
import { villagesLit } from '../game/progress';
import { masteryText } from '../game/score';
import { tideLevel } from '../game/sim';
import { dialTick, startDialTurn } from '../game/dial';
import { CELL, createBoard } from '../scene-assets/tidekeeper.scene-asset';
import type { PieceType, Placement } from '../game/types';
import { Sound, type Cue } from './audio';

const PIECES: readonly PieceType[] = ['straight', 'bend', 'lock'];
const HANDS = ['left', 'right'] as const;
const TOUCHES = ['left', 'right', 'mouse'] as const;
const TRAY_Z = 0.19, DIAL_X = 0.19, HANDLE_X = -0.19, HANDLE_Z = 0;
const PANEL_X = Math.max(...MISSIONS.map(m => m.width)) * CELL / 2 + 0.043 + 0.25;

export class TidekeeperSystem extends createSystem({
  items: { required: [BoardItem] },
  held: { required: [BoardItem, Grabbed] },
  pressed: { required: [BoardItem, Pressed] },
  pokeCommits: { required: [BoardItem, PokeCommit] },
}) {
  private campaign!: Campaign;
  private get game(): Session { return this.campaign.session; }
  private root!: Entity;
  private terrain!: Object3D;
  private water!: Mesh;
  private panel!: UIKitMLAsset;
  private panelEntity!: Entity;
  private coach!: UIKitMLAsset;
  private grab!: GrabSystem;
  private sound = new Sound();
  private temp = new Vector3();
  private temp2 = new Vector3();
  private head = new Vector3();
  private direction = new Vector3();
  private selected: PieceType | null = null;
  private lockCell: Placement | null = null;
  private far = false;
  private panelLeft = false;
  private moveControls = false;
  private ready = false;
  private xrPlaced = false;
  private launching = false;
  private dialTurn = startDialTurn();
  private shownTick = -1;
  private shownPhase = '';
  private message = '';
  private statusText = ''; 
  private uiQueued = false;
  private debugEntity?: Entity;
  private touchQuiet = { left: 1, right: 1, mouse: 1 };
  private now = 0;
  private view: 'game' | 'map' | 'settings' = 'game';
  private previousView: 'game' | 'map' = 'game';
  private resetConfirm = false;
  private resultTimer?: ReturnType<typeof setTimeout>;
  private autoAdvance = true;
  private missionStarted = 0;
  private missionOneMs: number | null = null;
  private docked = 0;
  private pulseUntil = 0;
  private lastCue = '';
  private mapUnlocked = false;
  private fade = 1;
  private fadeMaterials: MeshStandardMaterial[] = [];
  private pressStart = new WeakMap<Entity, number>();
  // Every edit respawns the pieces under the fingertip that made it; the finger leaving must not edit the new piece.
  private lastEditAt = -1;
  private settling() { return this.now - this.lastEditAt < 0.25; }
  // Re-placing the board moves the panel onto the finger that pressed (far to near is 15 cm closer); ignore that re-press.
  private panelMovedAt = -1;

  init() {
    this.campaign = new Campaign(browserStorage());
    this.far = this.campaign.progress.settings.reach === 'far';
    this.panelLeft = this.campaign.progress.settings.panel === 'left';
    this.sound.muted = !this.campaign.progress.settings.sound;
    this.mapUnlocked = !!this.campaign.progress.missions.m05;
    if (Object.keys(this.campaign.progress.missions).length) this.view = 'map';
    this.root = this.world.requireSceneEntity('board-root');
    this.panel = this.world.requireSceneObject<UIKitMLAsset>('game-panel');
    this.panelEntity = this.world.requireSceneEntity('game-panel');
    this.coach = this.world.requireSceneObject<UIKitMLAsset>('coach-panel');
    this.terrain = this.world.requireSceneObject('archipelago');
    this.grab = this.world.getSystem(GrabSystem)!;
    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', e => this.beginGrab(e)),
      this.queries.held.subscribe('disqualify', e => this.endGrab(e)),
      this.queries.pressed.subscribe('qualify', e => {
        e.setValue(BoardItem, 'pressSeconds', 0); this.pressStart.set(e, performance.now());
        const hand = e.getValue(BoardItem, 'hand');
        e.setValue(BoardItem, 'pinchContact', (hand === 'left' || hand === 'right') && this.input.xr.getSelectState(hand).active);
        e.setValue(BoardItem, 'pokeAllowed', this.touchQuiet[this.touchSlot(e)] >= 0.15);
      }),
      this.queries.pressed.subscribe('disqualify', e => {
        if (!this.ready || !e.hasComponent(BoardItem) || !e.getValue(BoardItem, 'pokeAllowed') || e.getValue(BoardItem, 'pinchContact') || (e.getValue(BoardItem, 'kind') === 'placed' && e.getValue(BoardItem, 'pressSeconds')! >= 0.6)) return;
        this.touchQuiet[this.touchSlot(e)] = 0;
        if (!e.hasComponent(PokeCommit)) e.addComponent(PokeCommit);
      }),
      () => this.sound.dispose(),
      () => clearTimeout(this.resultTimer),
    );
    this.bindPanel();
    this.createMission();
    this.installEntry();
    this.ready = true;
    this.refresh();
    if (import.meta.env.DEV) {
      this.debugEntity = this.world.createTransformEntity();
      this.debugEntity.object3D!.name = 'TidekeeperDebug';
      this.debugEntity.addComponent(GameDebug);
      // Dev-only setup helpers prepare boards; acceptance still launches with hands.
      Object.defineProperty(window, '__tidekeeper', { configurable: true, get: () => this.snapshot() });
      this.cleanupFuncs.push(() => { delete (window as Window & { __tidekeeper?: unknown }).__tidekeeper; });
      this.refresh();
    }
  }
  private touchSlot(e: Entity) {
    const hand = e.getValue(BoardItem, 'hand');
    return hand === 'left' || hand === 'right' ? hand : 'mouse';
  }
  private clone(id: string): Object3D {
    const source = (assets as unknown as Record<string, unknown>)[id];
    if (!(source instanceof Object3D)) throw new Error(`Missing procedural asset ${id}`);
    const object = source.clone(true);
    object.traverse(child => {
      if (child instanceof Mesh) {
        child.material = Array.isArray(child.material) ? child.material.map(m => m.clone()) : child.material.clone();
        child.userData.ownedMaterial = true;
      }
    });
    return object;
  }
  private spawn(id: string, name: string, kind: string, x = -1, y = -1, piece = '') {
    const object = this.clone(id); object.name = name;
    const e = this.world.createTransformEntity(object, this.root);
    e.addComponent(BoardItem, { kind, x, y, piece });
    return e;
  }
  private interact(e: Entity, grabbable = false) {
    e.addComponent(RayInteractable).addComponent(PokeInteractable);
    if (grabbable) e.addComponent(OneHandGrabbable, { rotate: false, translate: true });
    e.object3D!.addEventListener('pointerdown', event => {
      for (const side of HANDS) {
        const pointers = this.input.xr.multiPointers[side];
        if (event.pointerId === pointers.getPointer('touch').id || event.pointerId === pointers.getPointer('grab').id || event.pointerId === pointers.getPointer('ray').id) e.setValue(BoardItem, 'hand', side);
      }
    });
    // Pokes commit once when actual contact ends; this survives the SDK handle
    // cancelling a non-pinch touch and also supports browser mouse presses.
  }
  private positionCell(e: Entity, x: number, y: number, height = 0.009) {
    e.object3D!.position.set((x - (this.game.mission.width - 1) / 2) * CELL, height, (y - (this.game.mission.height - 1) / 2) * CELL);
  }
  private setOrigin(e: Entity) {
    const p = e.object3D!.position, v = e.getVectorView(BoardItem, 'origin');
    v[0] = p.x; v[1] = p.y; v[2] = p.z;
  }
  private resetOrigin(e: Entity) {
    const v = e.getVectorView(BoardItem, 'origin'); e.object3D!.position.set(v[0], v[1], v[2]);
  }
  private createMission() {
    clearTimeout(this.resultTimer); this.shownPhase = ''; this.docked = 0;
    this.missionStarted = performance.now(); this.message = '';
    for (const e of this.queries.items.entities) {
      this.grab.forceRelease(e); e.setValue(BoardItem, 'cancelled', true); e.dispose();
    }
    // Dispose only runtime-owned materials; geometry in manifest clones is shared.
    this.terrain.traverse(o => { if (o instanceof Mesh && o.userData.ownedMaterial) { const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } });
    this.terrain.clear();
    this.terrain.add(this.campaign.dailyDate ? createBoard(this.game.mission) : this.clone(`board-${this.game.mission.id}`));
    this.water = this.terrain.getObjectByName('Water') as Mesh;
    this.terrain.traverse(o => { if (o instanceof Mesh && !o.userData.ownedMaterial) {
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); o.userData.ownedMaterial = true;
    } });
    this.game.mission.grid.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '.') return;
      const e = this.spawn('cell', `Cell_${x}_${y}`, 'cell', x, y);
      this.positionCell(e, x, y, 0.006); this.interact(e);
    }));
    for (const piece of PIECES) {
      const e = this.spawn(`piece-${piece}`, `Tray_${piece}`, 'tray', -1, -1, piece);
      e.object3D!.position.set((PIECES.indexOf(piece) - 1) * 0.08, 0.01, this.trayZ());
      this.setOrigin(e); this.interact(e, true);
    }
    const dial = this.spawn('dial', 'TideDial', 'dial'); dial.object3D!.position.set(this.dialX(), 0.01, 0); this.setOrigin(dial); this.interact(dial, true);
    const handle = this.spawn('handle', 'MoveBoardHandle', 'handle'); handle.object3D!.position.set(-this.dialX(), 0.01, HANDLE_Z); this.setOrigin(handle); this.interact(handle, true);
    this.game.mission.boats.forEach(boat => this.spawn(`boat-${boat.shape}`, `Boat_${boat.id}`, 'boat'));
    this.game.mission.boats.forEach((_, i) => this.spawn('failure', `Failure_${i}`, 'failure', i));
    this.game.mission.boats.forEach(boat => { const e = this.spawn(`boat-${boat.shape}`, `Ghost_${boat.id}`, 'ghost'); e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) { o.material.transparent = true; o.material.opacity = 0.3; o.material.depthWrite = false; } }); });
    for (let i = 0; i < 3; i++) { const e = this.spawn('star', `Star_${i}`, 'star', i); e.object3D!.position.set((i - 1) * 0.042, 0.025, this.trayZ()); }
    const ripple = this.spawn('ripple', 'FeedbackRipple', 'ripple'); ripple.object3D!.visible = false;
    MISSIONS.forEach((_, i) => {
      const e = this.spawn('map-village', `Village_${i + 1}`, 'village', i);
      e.object3D!.position.set((i % 3 - 1) * 0.12, 0.012, (Math.floor(i / 3) - 1) * 0.095);
      this.interact(e);
    });
    const beacon = this.spawn('lighthouse', 'MapLighthouse', 'mapBeacon'); beacon.object3D!.position.set(0.18, 0, -0.15);
    this.selected = null; this.lockCell = null;
    this.fadeMaterials.length = 0;
    this.terrain.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) this.fadeMaterials.push(o.material); });
  }
  private trayZ() { return Math.max(TRAY_Z, this.game.mission.height * CELL / 2 + 0.052); }
  private dialX() { return Math.max(DIAL_X, this.game.mission.width * CELL / 2 + 0.043); }
  private synchronizePieces() {
    for (const e of this.queries.items.entities) if (e.getValue(BoardItem, 'kind')! === 'placed') { e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e); e.dispose(); }
    for (const p of this.game.editor.placements) {
      const e = this.spawn(`piece-${p.piece}`, `Piece_${p.x}_${p.y}`, 'placed', p.x, p.y, p.piece);
      this.positionCell(e, p.x, p.y); e.object3D!.rotation.y = -p.rot * Math.PI / 2; this.setOrigin(e); this.interact(e, true);
      if (p.piece === 'lock') for (let i = 1; i <= 3; i++) {
        const dot = e.object3D!.getObjectByName(`Wait ${i}`) as Mesh;
        (dot.material as MeshStandardMaterial).color.setHex(i <= (p.wait ?? 1) ? 0xc7863f : 0x26484e);
      }
    }
    for (const e of this.queries.items.entities) if (e.getValue(BoardItem, 'kind')! === 'cell') {
      const occupied = this.game.editor.pieceAt(e.getValue(BoardItem, 'x')!, e.getValue(BoardItem, 'y')!);
      e.object3D!.visible = !occupied;
      e.object3D!.pointerEvents = occupied ? 'none' : 'auto';
    }
  }
  private changed(ok: boolean, cue: Cue = 'snap') {
    if (ok) { this.lastEditAt = this.now; this.synchronizePieces(); this.message = ''; this.feedback(cue); }
    this.refresh();
  }
  private poke(e: Entity) {
    if (e.getValue(BoardItem, 'kind') === 'village') { this.selectMission(e.getValue(BoardItem, 'x')!); return; }
    if (this.view !== 'game') return;
    if (!this.game.editable || this.hasCarry()) return;
    this.sound.unlock();
    const kind = e.getValue(BoardItem, 'kind')!, x = e.getValue(BoardItem, 'x')!, y = e.getValue(BoardItem, 'y')!;
    if (kind === 'tray') {
      const piece = e.getValue(BoardItem, 'piece')! as PieceType;
      if (this.game.editor.remaining(piece) > 0) this.selected = this.selected === piece ? null : piece;
      this.refresh();
    } else if (kind === 'cell' && this.selected) {
      const piece = this.selected; this.selected = null; this.changed(this.game.place(x, y, piece));
    } else if (kind === 'placed' && !this.settling()) {
      const p = this.game.editor.pieceAt(x, y)!; this.lockCell = p.piece === 'lock' ? p : null;
      this.changed(this.game.edit(editor => p.piece === 'lock' ? editor.cycleWait(x, y) : editor.rotate(x, y)), p.piece === 'lock' ? 'wait' : 'rotate');
    }
  }
  /** A headset can end the pinch when it loses the hand while keeping the source. Dropping then would place the piece
   * wherever the hand was last seen, so a release in a frame with no wrist pose counts as tracking loss. */
  private handUntracked(hand: 'left' | 'right') {
    const frame = this.world.renderer.xr.getFrame(), reference = this.world.renderer.xr.getReferenceSpace();
    const wrist = this.input.xr.getPrimaryInputSource(hand)?.hand?.get('wrist');
    return !!(frame && reference && wrist && frame.getJointPose && !frame.getJointPose(wrist, reference));
  }
  private hasCarry() {
    for (const e of this.queries.held.entities) if (e.getValue(BoardItem, 'kind')! === 'tray' || e.getValue(BoardItem, 'kind')! === 'placed') return true;
    return false;
  }
  private beginGrab(e: Entity) {
    if (!this.ready) return;
    const kind = e.getValue(BoardItem, 'kind')!;
    for (const held of this.queries.held.entities) {
      if (held !== e && !held.getValue(BoardItem, 'cancelled')) {
        e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e); return;
      }
    }
    if (this.view !== 'game' || !this.game.editable || (kind === 'tray' && this.game.editor.remaining(e.getValue(BoardItem, 'piece')! as PieceType) <= 0)) {
      e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e); return;
    }
    e.setValue(BoardItem, 'heldSeconds', 0); e.setValue(BoardItem, 'lostSeconds', 0);
    if (kind === 'dial') this.dialTurn = startDialTurn();
    const pointerHand = e.getValue(BoardItem, 'hand');
    let hand = pointerHand === 'left' || pointerHand === 'right' ? pointerHand : this.grab.getHolderHand(e);
    // RC.2's holder helper omits the touch sub-pointer, which can own a near
    // pinch. Recover that hand from active pinch intent and its tracked pose.
    if (!hand) {
      e.object3D!.getWorldPosition(this.temp);
      let nearest = Infinity;
      for (const side of HANDS) {
        if (!this.input.xr.getPrimaryInputSource(side)?.hand) continue;
        this.player.gripSpaces[side].getWorldPosition(this.temp2);
        const distance = this.temp.distanceToSquared(this.temp2);
        if (distance < nearest) { nearest = distance; hand = side; }
      }
    }
    e.setValue(BoardItem, 'hand', hand ?? 'unknown');
    // RC.2's generic handle also captures a fingertip poke. A poke must edit
    // the piece in place; only a native hand pinch may start a carry.
    if (!this.world.session || (hand && this.input.xr.isPrimary('hand', hand) && !this.input.xr.getSelectState(hand).active)) {
      e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e); return;
    }
    // Only a real pinch carry clears a poke selection; the fingertip leaving a poked tray piece also lands here.
    this.selected = null;
    e.setValue(BoardItem, 'pinchContact', true);
    this.sound.unlock();
    e.setValue(BoardItem, 'moved', false); e.setValue(BoardItem, 'cancelled', false);
    this.queueUI();
  }
  private endGrab(e: Entity) {
    if (!this.ready || !e.object3D! || !e.hasComponent(BoardItem)) return;
    const kind = e.getValue(BoardItem, 'kind')!;
    const holder = e.getValue(BoardItem, 'hand');
    if ((holder === 'left' || holder === 'right') && (!this.input.xr.getPrimaryInputSource(holder) || this.handUntracked(holder))) e.setValue(BoardItem, 'cancelled', true);
    if (e.getValue(BoardItem, 'cancelled')! || !this.game.editable) { this.resetOrigin(e); this.queueUI(); return; }
    if (kind === 'dial' || kind === 'handle') { this.resetOrigin(e); this.queueUI(); return; }
    const x = e.getValue(BoardItem, 'x')!, y = e.getValue(BoardItem, 'y')!;
    const elapsed = e.getValue(BoardItem, 'heldSeconds')!;
    if (kind === 'placed' && !e.getValue(BoardItem, 'moved')!) {
      if (this.settling()) { this.resetOrigin(e); this.queueUI(); return; }
      const p = this.game.editor.pieceAt(x, y);
      this.lockCell = p?.piece === 'lock' ? p : null;
      this.changed(this.game.edit(editor => elapsed >= 0.6 ? editor.remove(x, y) : p?.piece === 'lock' ? editor.cycleWait(x, y) : editor.rotate(x, y)), elapsed >= 0.6 ? 'snap' : p?.piece === 'lock' ? 'wait' : 'rotate'); return;
    }
    e.object3D!.getWorldPosition(this.temp); this.root.object3D!.worldToLocal(this.temp);
    let closest: Entity | null = null, distance = CELL;
    if (Math.abs(this.temp.y) < CELL * 2) for (const cell of this.queries.items.entities) {
      if (cell.getValue(BoardItem, 'kind')! !== 'cell') continue;
      const cx = cell.getValue(BoardItem, 'x')!, cy = cell.getValue(BoardItem, 'y')!;
      if (this.game.editor.pieceAt(cx, cy)) continue;
      const d = Math.hypot(this.temp.x - cell.object3D!.position.x, this.temp.z - cell.object3D!.position.z);
      if (d <= distance) { distance = d; closest = cell; }
    }
    this.resetOrigin(e);
    if (closest) {
      const cx = closest.getValue(BoardItem, 'x')!, cy = closest.getValue(BoardItem, 'y')!;
      this.changed(kind === 'tray' ? this.game.place(cx, cy, e.getValue(BoardItem, 'piece')! as PieceType) : this.game.edit(editor => editor.move(x, y, cx, cy)));
    } else { this.message = 'Drop closer to an empty build square.'; this.refresh(); }
  }
  private bindPanel() {
    const actions: Record<string, () => void> = {
      Undo: () => this.changed(this.game.undo()), FailureUndo: () => this.changed(this.game.undo()),
      Redo: () => this.changed(this.game.edit(e => e.redo())), Hint: () => this.changed(this.game.hint()), Restart: () => this.changed(this.game.edit(e => e.restart())),
      Launch: () => { if (this.hasCarry()) return; this.game.launch(); this.selected = null; this.feedback('launch'); this.refresh(); },
      Pause: () => { this.game.pause(); this.refresh(); }, Stop: () => { this.game.stop(); this.refresh(); }, Back: () => { this.game.stop(); this.refresh(); },
      Next: () => this.nextMission(),
      TideBack: () => this.scrub(this.game.tick - 1), TideForward: () => this.scrub(this.game.tick + 1),
      Reach: () => { if (this.hasCarry()) return; this.far = !this.far; this.campaign.settings({reach:this.far ? 'far' : 'near'}); this.placeBoard(); this.refresh(); },
      Move: () => { this.moveControls = !this.moveControls; this.refresh(); },
      MoveLeft: () => this.nudge(-0.04, 0), MoveRight: () => this.nudge(0.04, 0), MoveUp: () => this.nudge(0, 0.04), MoveDown: () => this.nudge(0, -0.04),
      PanelSide: () => { if (this.hasCarry()) return; this.panelLeft = !this.panelLeft; this.campaign.settings({panel:this.panelLeft ? 'left' : 'right'}); this.layoutPanel(); this.refresh(); },
      Sound: () => { this.sound.muted = !this.sound.muted; this.campaign.settings({sound:!this.sound.muted}); this.sound.unlock(); this.refresh(); },
      RotateLock: () => { if (this.lockCell) this.changed(this.game.edit(e => e.rotate(this.lockCell!.x, this.lockCell!.y)), 'rotate'); },
      Map: () => this.openView('map'),
      Settings: () => { this.previousView = this.view === 'map' ? 'map' : 'game'; this.resetConfirm = false; this.openView('settings'); },
      CloseSettings: () => this.openView(this.previousView),
      ResumeMission: () => this.openView('game'),
      Daily: () => { if (this.hasCarry()) return; this.campaign.daily(); this.view = 'game'; this.createMission(); this.refresh(); },
      ResetProgress: () => { this.resetConfirm = true; this.refresh(); },
      CancelReset: () => { this.resetConfirm = false; this.refresh(); },
      ConfirmReset: () => {
        if (!this.resetConfirm || this.hasCarry()) return;
        this.campaign.reset(); this.far = false; this.panelLeft = false; this.sound.muted = false; this.resetConfirm = false;
        this.mapUnlocked = false; this.view = 'game'; this.createMission(); this.placeBoard(); this.refresh();
      },
    };
    MISSIONS.forEach((_, i) => { actions[`Mission${i + 1}`] = () => this.selectMission(i); });
    for (const [id, action] of Object.entries(actions)) {
      const b = this.panel.requireElementById(id); b.name = id;
      let pressedPointer: number | null = null;
      const onDown = (event: { pointerId: number; stopPropagation(): void }) => {
        event.stopPropagation();
        for (const side of HANDS) {
          if (!this.input.xr.isPrimary('hand', side)) continue;
          const pointers = this.input.xr.multiPointers[side];
          const isTouch = event.pointerId === pointers.getPointer('touch').id;
          const isOther = event.pointerId === pointers.getPointer('ray').id || event.pointerId === pointers.getPointer('grab').id;
          if (isOther || (isTouch && this.input.xr.getSelectState(side).active)) return;
        }
        if (pressedPointer !== null || this.now - this.panelMovedAt < 0.5) return;
        pressedPointer = event.pointerId;
        // Sink the visible label while the button's contact surface stays put.
        for (const child of b.children) child.position.z -= 0.004;
        this.sound.unlock(); action(); this.refresh();
        if (id !== 'Launch') this.sound.play('snap');
      };
      const onUp = () => {
        if (pressedPointer === null) return;
        pressedPointer = null;
        for (const child of b.children) child.position.z += 0.004;
      };
      b.addEventListener('pointerdown', onDown); b.addEventListener('pointerup', onUp); b.addEventListener('pointerleave', onUp);
      this.cleanupFuncs.push(() => { b.removeEventListener('pointerdown', onDown); b.removeEventListener('pointerup', onUp); b.removeEventListener('pointerleave', onUp); });
    }
  }
  private openView(view: 'game' | 'map' | 'settings') {
    if (this.hasCarry()) return;
    clearTimeout(this.resultTimer);
    if (this.game.phase === 'running') this.game.pause();
    this.view = view; this.refresh();
  }
  private selectMission(index: number) {
    if (this.view !== 'map' || this.hasCarry()) return;
    if (!this.campaign.select(index)) { this.message = 'Deliver the previous village first.'; this.refresh(); return; }
    this.view = 'game'; this.createMission(); this.refresh();
  }
  private nextMission() {
    if (this.campaign.next()) { this.view = 'game'; this.createMission(); this.refresh(); }
  }
  private feedback(cue: Cue) {
    this.lastCue = cue; this.sound.play(cue); this.pulseUntil = this.now + 0.8;
    for (const e of this.queries.items.entities) if (e.getValue(BoardItem, 'kind') === 'ripple') {
      e.object3D!.position.set(0, 0.026, 0); e.object3D!.visible = this.view === 'game';
    }
  }
  private installEntry() {
    const play = document.getElementById('play') as HTMLButtonElement;
    const mode = document.getElementById('ar') as HTMLInputElement;
    const status = document.getElementById('entry-status')!;
    let supportsAR = false, supportsVR = false;
    void Promise.all([navigator.xr?.isSessionSupported('immersive-ar'), navigator.xr?.isSessionSupported('immersive-vr')]).then(([ar, vr]) => {
      supportsAR = !!ar; supportsVR = !!vr; mode.disabled = !supportsAR; mode.checked = supportsAR;
      play.textContent = ar || vr ? 'Play' : 'Play in browser'; play.disabled = false;
    });
    const start = () => {
      this.sound.unlock();
      this.missionStarted = performance.now(); this.root.object3D!.scale.setScalar(0.94); this.fade = 0;
      for (const material of this.fadeMaterials) { material.transparent = true; material.opacity = 0; }
      if (!supportsAR && !supportsVR) { document.getElementById('entry')!.hidden = true; return; }
      status.textContent = ''; this.launching = true;
      this.world.launchXR({ sessionMode: mode.checked && supportsAR ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR });
    };
    play.addEventListener('click', start); this.cleanupFuncs.push(() => play.removeEventListener('click', start));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      const immersive = state !== VisibilityState.NonImmersive;
      document.getElementById('entry')!.hidden = immersive;
      if (!immersive) this.xrPlaced = false;
      // A run keeps going only while the player can see it: system menu, headset off or leaving the session all pause it.
      if (state !== VisibilityState.Visible && this.game.phase === 'running') { this.game.pause(); this.queueUI(); }
    }));
  }
  private placeBoard() {
    this.player.head.getWorldPosition(this.head); this.player.head.getWorldDirection(this.direction);
    this.direction.y = 0; this.direction.normalize();
    this.root.object3D!.position.copy(this.head).addScaledVector(this.direction, this.far ? -0.6 : -0.45);
    this.root.object3D!.position.y = this.head.y - 0.35;
    this.root.object3D!.rotation.set(Math.PI / 12, Math.atan2(this.direction.x, this.direction.z), 0);
    this.layoutPanel();
  }
  /** The mission card stands beside the board, clear of the tide dial (or the move handle) on the widest board, turned
   * toward that shoulder and only slightly tilted back, so a seated fingertip meets each button head-on instead of
   * dragging across its neighbours. It stays put between missions, so a finger on Next never lands on another button. */
  private layoutPanel() {
    const side = this.panelLeft ? -1 : 1;
    this.panel.position.set(side * PANEL_X, 0.14, 0);
    this.panel.rotation.set(-25 * Math.PI / 180, -side * 35 * Math.PI / 180, 0, 'YXZ');
    this.panel.scale.setScalar(0.8);
    this.panelMovedAt = this.now;
  }
  /** The card moves with the board, so the finger still on the arrow must not press again or press a neighbour. */
  private nudge(x: number, y: number) { this.root.object3D!.position.x += x; this.root.object3D!.position.y += y; this.panelMovedAt = this.now; }
  private scrub(tick: number) { const before = this.game.tick; this.game.scrub(tick); if (before !== this.game.tick) this.feedback('dial'); this.refresh(); }
  private queueUI() {
    if (this.uiQueued) return; this.uiQueued = true;
    queueMicrotask(() => { this.uiQueued = false; if (this.ready) this.refresh(); });
  }
  update(delta: number, time: number) {
    if (!this.ready) return;
    this.now = time;
    if (import.meta.env.DEV && this.debugEntity) {
      const command = this.debugEntity.getValue(GameDebug, 'command');
      if (command) { this.debugEntity.setValue(GameDebug, 'command', ''); queueMicrotask(() => this.setupTest(command)); }
    }
    if (this.root.object3D!.scale.x < 1) this.root.object3D!.scale.setScalar(Math.min(1, this.root.object3D!.scale.x + delta * 0.12));
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + delta * 2);
      for (const material of this.fadeMaterials) { material.opacity = this.fade; if (this.fade === 1) material.transparent = false; }
    }
    // The SDK only logs a refused session request, so say so on the entry card and leave Play available.
    if (this.launching && !this.world.sessionRequestPending) {
      this.launching = false;
      if (!this.world.session) document.getElementById('entry-status')!.textContent = (document.getElementById('ar') as HTMLInputElement).checked
        ? 'The headset did not start the session. Accept the permission prompt and press Play again, or untick "Show my room" to play in VR.'
        : 'The headset did not start the session. Accept the permission prompt and press Play again.';
    }
    if (this.world.session && !this.xrPlaced) { this.placeBoard(); this.xrPlaced = true; this.queueUI(); }
    (this.water.material as ShaderMaterial).uniforms.time.value = time;
    if (this.game.advance(delta)) this.queueUI();
    for (const slot of TOUCHES) this.touchQuiet[slot] = Math.min(1, this.touchQuiet[slot] + delta);
    // A hand turning the dial sweeps toward the card beside it. If the card stays touchable, the SDK hands that hand's near
    // pointer to the card and drops the grab mid-turn, so the card stops taking input while anything is held.
    const holding = this.queries.held.entities.size > 0;
    if (holding === this.panelEntity.hasComponent(PokeInteractable)) {
      if (holding) this.panelEntity.removeComponent(PokeInteractable).removeComponent(RayInteractable);
      else this.panelEntity.addComponent(RayInteractable).addComponent(PokeInteractable);
    }
    for (const e of this.queries.pokeCommits.entities) {
      if (e.hasComponent(Grabbed)) continue;
      e.removeComponent(PokeCommit); this.poke(e);
    }
    for (const e of this.queries.held.entities) {
      e.setValue(BoardItem, 'heldSeconds', e.getValue(BoardItem, 'heldSeconds')! + delta);
      const holder = e.getValue(BoardItem, 'hand');
      const hand = holder === 'left' || holder === 'right' ? holder : this.grab.getHolderHand(e);
      // Near touch can own the SDK handle in RC.2. End it on the hand's native
      // selectend too, so release works whichever near sub-pointer captured it.
      const source = hand ? this.input.xr.getPrimaryInputSource(hand) : undefined;
      const xrFrame = this.world.renderer.xr.getFrame();
      const reference = this.world.renderer.xr.getReferenceSpace();
      const wrist = source?.hand?.get('wrist');
      const tracked = !!(wrist && reference && xrFrame?.getJointPose?.(wrist, reference));
      if (tracked && hand && !this.input.xr.getSelectState(hand).active) { this.grab.forceRelease(e); continue; }
      const lost = tracked ? 0 : e.getValue(BoardItem, 'lostSeconds')! + delta; e.setValue(BoardItem, 'lostSeconds', lost);
      if (lost >= 0.5) { e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e); this.resetOrigin(e); this.queueUI(); continue; }
      e.object3D!.getWorldPosition(this.temp); this.root.object3D!.worldToLocal(this.temp);
      const v = e.getVectorView(BoardItem, 'origin'), kind = e.getValue(BoardItem, 'kind')!;
      const moved = Math.hypot(this.temp.x - v[0], this.temp.z - v[2]) > CELL * 0.45;
      if (moved) e.setValue(BoardItem, 'moved', true);
      if (kind === 'dial') {
        const angle = Math.atan2(this.temp.x - this.dialX(), -(this.temp.z));
        const tick = dialTick(this.dialTurn, angle, this.game.mission.tickLimit);
        if (this.game.tick !== tick) { this.game.scrub(tick); this.feedback('dial'); this.queueUI(); }
      } else if (kind === 'handle') {
        this.temp2.set(this.temp.x - v[0], this.temp.y - v[1], this.temp.z - v[2]);
        this.temp2.applyQuaternion(this.root.object3D!.quaternion); this.root.object3D!.position.add(this.temp2); this.resetOrigin(e);
      } else if (kind === 'placed' && !e.getValue(BoardItem, 'moved')! && e.getValue(BoardItem, 'heldSeconds')! >= 0.6) {
        const x = e.getValue(BoardItem, 'x')!, y = e.getValue(BoardItem, 'y')!;
        e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e);
        queueMicrotask(() => this.changed(this.game.edit(editor => editor.remove(x, y))));
      }
    }
    for (const e of this.queries.pressed.entities) {
      this.touchQuiet[this.touchSlot(e)] = 0;
      // Wall-clock contact time: summing frame deltas also counts the frame before contact, so one slow frame
      // (headless shader compile) could turn a tap into a hold-to-remove.
      const previous = e.getValue(BoardItem, 'pressSeconds')!;
      const elapsed = (performance.now() - (this.pressStart.get(e) ?? performance.now())) / 1000; e.setValue(BoardItem, 'pressSeconds', elapsed);
      if (elapsed >= 0.6 && previous < 0.6 && e.getValue(BoardItem, 'kind')! === 'placed' && e.getValue(BoardItem, 'pokeAllowed') && !e.hasComponent(Grabbed) && this.game.editable) {
        const x = e.getValue(BoardItem, 'x')!, y = e.getValue(BoardItem, 'y')!;
        queueMicrotask(() => this.changed(this.game.edit(editor => editor.remove(x, y))));
      }
    }
    for (const e of this.queries.items.entities) if (e.getValue(BoardItem, 'kind') === 'ripple') {
      const remaining = this.pulseUntil - time;
      e.object3D!.visible = remaining > 0 && this.view === 'game';
      if (remaining > 0) e.object3D!.scale.setScalar(1 + (0.8 - remaining) * 2.5);
    }
  }
  private text(id: string, text: string) { if (id === 'Status') this.statusText = text; this.panel.requireElementById<UIKit.Text>(id).setProperties({ text }); }
  private show(id: string, visible: boolean) { this.panel.requireElementById(id).setProperties({ display: visible ? 'flex' : 'none' }); }
  private refresh() {
    const s = this.game, phase = s.phase, failure = s.simulation.outcome.kind === 'failure' && s.tick >= s.simulation.outcome.tick;
    const newResult = this.campaign.result();
    if (newResult && phase === 'success') {
      this.mapUnlocked ||= s.mission.id === 'm05';
      if (s.mission.id === 'm01' && this.missionOneMs === null) this.missionOneMs = performance.now() - this.missionStarted;
      if (this.autoAdvance && s.mission.id === 'm01') this.resultTimer = setTimeout(() => { if (this.game === s && s.phase === 'success' && this.view === 'game') this.nextMission(); }, 2400);
    }
    // Both boats in a collision report the same reason; say it once.
    const reason = failure && s.simulation.outcome.kind === 'failure' ? [...new Set(s.simulation.outcome.failures.map(f => f.reason))].join('; ') : '';
    this.text('MissionTitle', this.campaign.dailyDate ? `Daily tide / ${this.campaign.dailyDate}` : `${s.missionIndex + 1} / ${s.missions.length}   ${s.mission.title}`);
    this.text('Status', reason || (phase === 'success' ? s.mission.id === 'm09' ? 'The lighthouse shines. Every village is alight!' : 'All letters delivered!' : this.message || (phase === 'running' ? 'Sailing the plan you previewed.' : phase === 'paused' ? 'Paused' : 'Poke to select / pinch to carry. Hold to remove.')));
    this.text('Goal', `Optional star: ${masteryText(s.mission).toLowerCase()}`); this.text('Tick', `Tick ${s.tick} / ${s.mission.tickLimit}`);
    this.panel.requireElementById('Card').setProperties({ backgroundColor: phase === 'success' ? '#c9e1b1' : failure ? '#f4c0ae' : '#f3e8ce' });
    this.show('EditControls', s.editable); this.show('Launch', s.editable); this.show('Pause', phase === 'running' || phase === 'paused'); this.text('Pause', phase === 'paused' ? 'Resume' : 'Pause');
    this.show('Stop', phase === 'running' || phase === 'paused'); this.show('Next', phase === 'success' && !this.campaign.dailyDate && s.missionIndex < s.missions.length - 1); this.show('FailureControls', phase === 'failure');
    this.show('MoveControls', this.moveControls); this.show('RotateLock', !!this.lockCell && s.editable);
    this.text('Reach', `Reach: ${this.far ? 'far' : 'near'}`); this.text('Sound', `Sound: ${this.sound.muted ? 'off' : 'on'}`); this.text('PanelSide', `Panel: ${this.panelLeft ? 'left' : 'right'} hand`);
    const coachLines = ['Pinch the bend and drop it in the glowing square.', 'Match each boat to its dock shape.', 'Turn the tide dial to see what the sea will do.', 'Tap the lock to set a two-tick wait.'];
    // Coach the next step from the board's state: a working first board needs Launch; a failed preview needs a new route, not a later start.
    const coachLine = s.missionIndex === 0 && s.simulation.outcome.kind === 'success' ? 'Now press Launch on the card beside the board.'
      : failure && s.missionIndex < 4 ? 'Boats always leave at tick 0. Change the channels, then check the tide again.' : coachLines[s.missionIndex];
    this.coach.requireElementById<UIKit.Text>('CoachText').setProperties({ text: !this.campaign.dailyDate && s.missionIndex < 4 && s.editable ? coachLine : '' });
    this.coach.position.set(0, 0.009, this.trayZ() + 0.047);
    this.coach.scale.setScalar(1);
    this.refreshNavigation();
    this.coach.requireElementById<UIKit.Text>('TrayCounts').setProperties({ text: PIECES.map(p => `${p} ${s.editor.remaining(p)}`).join(' / ') });
    const f = s.frame;
    this.water.position.y = -0.005 + tideLevel(s.mission, s.tick) * 0.003;
    s.mission.bars.forEach((bar, i) => {
      const sandbar = this.terrain.getObjectByName(`Bar ${i}`);
      if (sandbar) sandbar.position.y = f.barsWet[i] ? -0.007 : 0.017;
    });
    for (const e of this.queries.items.entities) {
      const kind = e.getValue(BoardItem, 'kind')!;
      const mapItem = kind === 'village' || kind === 'mapBeacon';
      if (this.view !== 'game' || mapItem) {
        e.object3D!.visible = this.view === 'map' && mapItem;
        e.object3D!.pointerEvents = this.view === 'map' && kind === 'village' ? 'auto' : 'none';
        if (kind === 'village') {
          const index = e.getValue(BoardItem, 'x')!, lit = !!this.campaign.progress.missions[MISSIONS[index].id]?.stars;
          const unlocked = missionUnlocked(this.campaign.progress, MISSIONS, index);
          e.object3D!.scale.setScalar(unlocked ? 1 : 0.8);
          e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) {
            o.material.emissive.setHex(lit ? 0x67461b : 0); o.material.emissiveIntensity = lit ? 0.5 : 0;
            if (o.name === 'Window') { o.material.color.setHex(lit ? 0xffda73 : 0x26484e); o.material.emissive.setHex(lit ? 0xffb82e : 0); }
          } });
        } else if (kind === 'mapBeacon') this.lightBeacon(e.object3D!, !!this.campaign.progress.missions.m09);
        continue;
      }
      e.object3D!.visible = true;
      e.object3D!.pointerEvents = s.editable ? 'auto' : 'none';
      if (kind === 'tray' && !e.hasComponent(Grabbed)) {
        const piece = e.getValue(BoardItem, 'piece')! as PieceType, available = s.editor.remaining(piece) > 0;
        e.object3D!.visible = available; e.object3D!.pointerEvents = available && s.editable ? 'auto' : 'none';
        this.resetOrigin(e); if (this.selected === piece) e.object3D!.position.y += 0.016;
        const coached = !this.campaign.dailyDate && s.missionIndex < 4 && s.editable && !s.editor.placements.length && piece === (s.missionIndex === 3 ? 'lock' : 'bend') && s.missionIndex !== 2;
        e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) { o.material.emissive.setHex(this.selected === piece || coached ? 0x276e54 : 0); o.material.emissiveIntensity = 0.45; } });
      } else if (kind === 'boat') {
        const boat = f.boats.find(b => e.object3D!.name === `Boat_${b.id}`)!;
        this.positionCell(e, boat.x, boat.y, 0.019); e.object3D!.rotation.y = -boat.heading * Math.PI / 2;
        e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) { o.material.transparent = s.editable; o.material.opacity = s.editable ? 0.45 : 1; } });
      } else if (kind === 'failure') {
        const index = e.getValue(BoardItem, 'x')!;
        const fail = s.simulation.outcome.kind === 'failure' ? s.simulation.outcome.failures[index] : undefined;
        e.object3D!.visible = !!fail && failure;
        if (fail) this.positionCell(e, fail.x, fail.y, 0.045);
      } else if (kind === 'ghost') {
        const id = e.object3D!.name.slice(6);
        const fail = failure && s.simulation.outcome.kind === 'failure' ? s.simulation.outcome.failures.find(f => f.boat === id) : undefined;
        const previous = s.simulation.frames[Math.max(0, Math.min(s.tick - 1, s.simulation.frames.length - 1))].boats.find(b => b.id === id)!;
        e.object3D!.visible = !!fail || (s.editable && s.tick > 0 && previous.status !== 'docked');
        this.positionCell(e, fail?.x ?? previous.x, fail?.y ?? previous.y, 0.035);
        e.object3D!.rotation.y = -previous.heading * Math.PI / 2;
        // Both silhouettes remain readable when boats meet in the same cell.
        if (fail?.kind === 'collision') e.object3D!.position.x += (s.mission.boats.findIndex(b => b.id === id) % 2 ? 1 : -1) * 0.007;
      } else if (kind === 'star') {
        e.object3D!.visible = phase === 'success' && e.getValue(BoardItem, 'x')! < s.rating;
      } else if (kind === 'cell') {
        e.object3D!.visible = !s.editor.pieceAt(e.getValue(BoardItem, 'x')!, e.getValue(BoardItem, 'y')!);
        const coached = s.mission.id === 'm01' && s.editable;
        e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material.emissive.setHex(coached ? 0x306c48 : 0); });
        e.object3D!.pointerEvents = e.object3D!.visible && s.editable ? 'auto' : 'none';
      } else if (kind === 'ripple') {
        e.object3D!.visible = this.pulseUntil > this.now;
      } else if (kind === 'dial' && !e.hasComponent(Grabbed)) {
        e.object3D!.rotation.y = -s.tick / s.mission.tickLimit * Math.PI * 2;
        e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material.emissive.setHex(!this.campaign.dailyDate && s.missionIndex === 2 && s.editable ? 0x634000 : 0); });
      }
    }
    s.mission.docks.forEach((d, i) => {
      const delivered = f.boats.some(b => b.status === 'docked' && b.x === d.x && b.y === d.y);
      const windows = this.terrain.getObjectByName(`Village ${i}`)?.getObjectByName('Windows') as Mesh;
      if (windows) { const mat = windows.material as MeshStandardMaterial; mat.color.setHex(delivered ? 0xffda73 : 0x26484e); mat.emissive.setHex(delivered ? 0xffb82e : 0); mat.emissiveIntensity = delivered ? 1.5 : 0; }
    });
    const deliveredCount = f.boats.filter(b => b.status === 'docked').length;
    if ((phase === 'running' || phase === 'success') && deliveredCount > this.docked) this.feedback('dock');
    this.docked = deliveredCount;
    if (phase === 'success' && this.shownPhase !== 'success') this.feedback('success');
    if (phase === 'failure' && this.shownPhase !== 'failure') this.feedback('error');
    const lighthouse = this.terrain.getObjectByName('Lighthouse');
    if (lighthouse) this.lightBeacon(lighthouse, !!this.campaign.progress.missions.m09);
    this.shownTick = s.tick; this.shownPhase = phase;
    this.debugEntity?.setValue(GameDebug, 'state', JSON.stringify(this.snapshot()));
  }
  private lightBeacon(object: Object3D, lit: boolean) {
    const beacon = object.getObjectByName('Beacon') as Mesh;
    if (!beacon) return;
    const material = beacon.material as MeshStandardMaterial;
    material.color.setHex(lit ? 0xffda73 : 0x26484e); material.emissive.setHex(lit ? 0xffc244 : 0); material.emissiveIntensity = lit ? 2 : 0;
  }
  private setupTest(json: string) {
    if (!import.meta.env.DEV) return;
    try {
      const command = JSON.parse(json) as { reset?: boolean; autoAdvance?: boolean; solution?: boolean; board?: Placement[] };
      if (command.reset) {
        this.campaign.reset(); this.view = 'game'; this.far = false; this.panelLeft = false; this.sound.muted = false; this.mapUnlocked = false;
        this.autoAdvance = false; this.missionOneMs = null; this.createMission(); this.placeBoard();
      }
      if (command.autoAdvance !== undefined) this.autoAdvance = command.autoAdvance;
      if (command.solution || command.board) {
        const placements = command.solution ? this.game.mission.solution : command.board!;
        this.game.stop(); this.game.edit(e => {
          e.restart();
          for (const p of placements) {
            const result = e.place(p.x, p.y, p.piece, p.rot); if (!result.ok) throw new Error(result.reason);
            for (let i = 1; i < (p.wait ?? 1); i++) e.cycleWait(p.x, p.y);
          }
          return true;
        }); this.synchronizePieces();
      }
    } catch (error) { this.message = `Test setup failed: ${String(error)}`; }
    this.refresh();
  }
  private refreshNavigation() {
    const daily = this.campaign.dailySummary(), p = this.campaign.progress;
    this.terrain.visible = this.view === 'game'; this.coach.visible = this.view === 'game';
    this.show('GameView', this.view === 'game'); this.show('MapView', this.view === 'map'); this.show('SettingsView', this.view === 'settings');
    this.show('Map', this.view === 'game' && (this.mapUnlocked || !!this.campaign.dailyDate));
    this.show('Settings', this.view !== 'settings');
    this.show('DailySummary', !!this.campaign.dailyDate);
    const best = daily.best ? `${daily.best.pieces} pieces / tick ${daily.best.tick}` : 'No delivery yet';
    this.text('DailySummary', `Streak ${daily.streak} / Best: ${best}`);
    this.text('DailyInfo', `${daily.date} / Streak ${daily.streak}\nToday's best: ${best}`);
    this.text('MapStatus', p.missions.m09 ? 'The lighthouse lights the whole archipelago.' : `${villagesLit(p, MISSIONS).length} / 9 villages lit. Deliver to open the next.`);
    for (let i = 0; i < MISSIONS.length; i++) {
      const unlocked = missionUnlocked(p, MISSIONS, i), lit = !!p.missions[MISSIONS[i].id]?.stars;
      this.text(`Mission${i + 1}`, `${i + 1}. ${MISSIONS[i].title}\n${lit ? 'Delivered' : unlocked ? 'Open' : 'Locked'}`);
      this.panel.requireElementById(`Mission${i + 1}`).setProperties({backgroundColor:lit ? '#c9e1b1' : unlocked ? '#f3e8ce' : '#b4b8af', color:'#26484e'});
    }
    this.show('ResetConfirm', this.resetConfirm); this.show('ResetProgress', !this.resetConfirm);
    this.text('StorageNote', this.campaign.saved ? 'Progress saved on this device.' : 'Storage unavailable. Progress stays until this page closes.');
  }
  private snapshot() {
    const s = this.game;
    this.root.object3D!.getWorldPosition(this.temp);
    return {
      mission: s.mission.id, phase: s.phase, tick: s.tick, frame: s.frame,
      frames: s.simulation.frames, outcome: s.simulation.outcome, placements: s.editor.placements,
      remaining: s.editor.remainingAll(), selected: this.selected, stars: s.rating, hintsUsed: s.hintsUsed,
      board: { position: this.temp.toArray(), rotation: this.root.object3D!.rotation.toArray(), reach: this.far ? 'far' : 'near' },
      carried: [...this.queries.held.entities].filter(e => ['tray', 'placed'].includes(e.getValue(BoardItem, 'kind')!)).map(e => ({ name: e.object3D!.name, hand: e.getValue(BoardItem, 'hand'), lost: e.getValue(BoardItem, 'lostSeconds')! })),
      status: this.statusText,
      view: this.view, progress: this.campaign.progress, dailyDate: this.campaign.dailyDate,
      daily: this.campaign.dailySummary(), missionOneMs: this.missionOneMs, cue: this.lastCue,
      missionSize: [s.mission.width, s.mission.height], trayZ: this.trayZ(),
      lighthouse: !!this.campaign.progress.missions.m09,
      renderer: { ...this.world.renderer.info.render, memory: { ...this.world.renderer.info.memory } },
      renderedGhosts: [...this.queries.items.entities].filter(e => e.getValue(BoardItem, 'kind') === 'ghost' && e.object3D!.visible).map(e => ({name:e.object3D!.name, position:e.object3D!.position.toArray()})),
      renderedBoats: [...this.queries.items.entities].filter(e => e.getValue(BoardItem, 'kind')! === 'boat').map(e => ({ name: e.object3D!.name, position: e.object3D!.position.toArray() })),
    };
  }
}
