import {
  createSystem, Entity, Object3D, Mesh, MeshStandardMaterial, ShaderMaterial,
  Grabbed, GrabSystem, OneHandGrabbable, RayInteractable, PokeInteractable,
  Pressed, Vector3, UIKitMLAsset, UIKit, VisibilityState, SessionMode,
} from '@iwsdk/core';
import assets from '../assets';
import { BoardItem, GameDebug, PokeCommit } from '../tidekeeper-components';
import { Session } from '../game/session';
import { masteryText } from '../game/score';
import { tideLevel } from '../game/sim';
import { CELL } from '../scene-assets/tidekeeper.scene-asset';
import type { PieceType, Placement } from '../game/types';
import { Sound } from './audio';

const PIECES: readonly PieceType[] = ['straight', 'bend', 'lock'];
const HANDS = ['left', 'right'] as const;
const TOUCHES = ['left', 'right', 'mouse'] as const;
const TRAY_Z = 0.19, DIAL_X = 0.19, HANDLE_X = -0.19, HANDLE_Z = 0;

export class TidekeeperSystem extends createSystem({
  items: { required: [BoardItem] },
  held: { required: [BoardItem, Grabbed] },
  pressed: { required: [BoardItem, Pressed] },
  pokeCommits: { required: [BoardItem, PokeCommit] },
}) {
  private game = new Session();
  private root!: Entity;
  private terrain!: Object3D;
  private water!: Mesh;
  private panel!: UIKitMLAsset;
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
  private moveControls = false;
  private ready = false;
  private xrPlaced = false;
  private shownTick = -1;
  private shownPhase = '';
  private message = '';
  private statusText = ''; 
  private uiQueued = false;
  private debugEntity?: Entity;
  private touchQuiet = { left: 1, right: 1, mouse: 1 };
  private now = 0;
  private pressStart = new WeakMap<Entity, number>();
  // Every edit respawns the pieces under the fingertip that made it; the finger leaving must not edit the new piece.
  private lastEditAt = -1;
  private settling() { return this.now - this.lastEditAt < 0.25; }

  init() {
    this.root = this.world.requireSceneEntity('board-root');
    this.panel = this.world.requireSceneObject<UIKitMLAsset>('game-panel');
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
      // A fresh JSON snapshot, with no mutators, is the only debug surface.
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
    for (const e of this.queries.items.entities) {
      this.grab.forceRelease(e); e.setValue(BoardItem, 'cancelled', true); e.dispose();
    }
    if (this.game.missionIndex > 0) {
      this.terrain.clear(); this.terrain.add(this.clone(`board-${this.game.mission.id}`));
    }
    this.water = this.terrain.getObjectByName('Water') as Mesh;
    this.terrain.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material = o.material.clone(); });
    this.water.material = (this.water.material as ShaderMaterial).clone();
    this.game.mission.grid.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '.') return;
      const e = this.spawn('cell', `Cell_${x}_${y}`, 'cell', x, y);
      this.positionCell(e, x, y, 0.006); this.interact(e);
    }));
    for (const piece of PIECES) {
      const e = this.spawn(`piece-${piece}`, `Tray_${piece}`, 'tray', -1, -1, piece);
      e.object3D!.position.set((PIECES.indexOf(piece) - 1) * 0.08, 0.01, TRAY_Z);
      this.setOrigin(e); this.interact(e, true);
    }
    const dial = this.spawn('dial', 'TideDial', 'dial'); dial.object3D!.position.set(DIAL_X, 0.01, 0); this.setOrigin(dial); this.interact(dial, true);
    const handle = this.spawn('handle', 'MoveBoardHandle', 'handle'); handle.object3D!.position.set(HANDLE_X, 0.01, HANDLE_Z); this.setOrigin(handle); this.interact(handle, true);
    this.game.mission.boats.forEach(boat => this.spawn(`boat-${boat.shape}`, `Boat_${boat.id}`, 'boat'));
    this.game.mission.boats.forEach((_, i) => this.spawn('failure', `Failure_${i}`, 'failure', i));
    this.selected = null; this.lockCell = null;
  }
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
  private changed(ok: boolean) {
    if (ok) { this.lastEditAt = this.now; this.synchronizePieces(); this.message = ''; this.sound.play('snap'); }
    this.refresh();
  }
  private poke(e: Entity) {
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
      this.changed(this.game.edit(editor => p.piece === 'lock' ? editor.cycleWait(x, y) : editor.rotate(x, y)));
    }
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
    if (!this.game.editable || (kind === 'tray' && this.game.editor.remaining(e.getValue(BoardItem, 'piece')! as PieceType) <= 0)) {
      e.setValue(BoardItem, 'cancelled', true); this.grab.forceRelease(e); return;
    }
    e.setValue(BoardItem, 'heldSeconds', 0); e.setValue(BoardItem, 'lostSeconds', 0);
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
    e.setValue(BoardItem, 'moved', false); e.setValue(BoardItem, 'cancelled', false);
    this.queueUI();
  }
  private endGrab(e: Entity) {
    if (!this.ready || !e.object3D! || !e.hasComponent(BoardItem)) return;
    const kind = e.getValue(BoardItem, 'kind')!;
    const holder = e.getValue(BoardItem, 'hand');
    if ((holder === 'left' || holder === 'right') && !this.input.xr.getPrimaryInputSource(holder)) e.setValue(BoardItem, 'cancelled', true);
    if (e.getValue(BoardItem, 'cancelled')! || !this.game.editable) { this.resetOrigin(e); this.queueUI(); return; }
    if (kind === 'dial' || kind === 'handle') { this.resetOrigin(e); this.queueUI(); return; }
    const x = e.getValue(BoardItem, 'x')!, y = e.getValue(BoardItem, 'y')!;
    const elapsed = e.getValue(BoardItem, 'heldSeconds')!;
    if (kind === 'placed' && !e.getValue(BoardItem, 'moved')!) {
      if (this.settling()) { this.resetOrigin(e); this.queueUI(); return; }
      const p = this.game.editor.pieceAt(x, y);
      this.lockCell = p?.piece === 'lock' ? p : null;
      this.changed(this.game.edit(editor => elapsed >= 0.6 ? editor.remove(x, y) : p?.piece === 'lock' ? editor.cycleWait(x, y) : editor.rotate(x, y))); return;
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
      Launch: () => { if (this.hasCarry()) return; this.game.launch(); this.selected = null; this.sound.play('launch'); this.refresh(); },
      Pause: () => { this.game.pause(); this.refresh(); }, Stop: () => { this.game.stop(); this.refresh(); }, Back: () => { this.game.stop(); this.refresh(); },
      Next: () => { if (this.game.next()) { this.createMission(); this.refresh(); } },
      TideBack: () => this.scrub(this.game.tick - 1), TideForward: () => this.scrub(this.game.tick + 1),
      Reach: () => { if (this.hasCarry()) return; this.far = !this.far; this.placeBoard(); this.refresh(); },
      Move: () => { this.moveControls = !this.moveControls; this.refresh(); },
      MoveLeft: () => { this.root.object3D!.position.x -= 0.04; }, MoveRight: () => { this.root.object3D!.position.x += 0.04; },
      MoveUp: () => { this.root.object3D!.position.y += 0.04; }, MoveDown: () => { this.root.object3D!.position.y -= 0.04; },
      Sound: () => { this.sound.muted = !this.sound.muted; this.refresh(); },
      RotateLock: () => { if (this.lockCell) this.changed(this.game.edit(e => e.rotate(this.lockCell!.x, this.lockCell!.y))); },
    };
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
        if (pressedPointer !== null) return;
        pressedPointer = event.pointerId;
        // Sink the visible label while the button's contact surface stays put.
        for (const child of b.children) child.position.z -= 0.004;
        this.sound.unlock(); action(); this.refresh(); this.sound.play('snap');
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
  private installEntry() {
    const play = document.getElementById('play') as HTMLButtonElement;
    const mode = document.getElementById('ar') as HTMLInputElement;
    let supportsAR = false, supportsVR = false;
    void Promise.all([navigator.xr?.isSessionSupported('immersive-ar'), navigator.xr?.isSessionSupported('immersive-vr')]).then(([ar, vr]) => {
      supportsAR = !!ar; supportsVR = !!vr; mode.disabled = !supportsAR; mode.checked = supportsAR;
      play.textContent = ar || vr ? 'Play' : 'Play in browser'; play.disabled = false;
    });
    const start = () => {
      this.sound.unlock();
      if (!supportsAR && !supportsVR) { document.getElementById('entry')!.hidden = true; return; }
      this.world.launchXR({ sessionMode: mode.checked && supportsAR ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR });
    };
    play.addEventListener('click', start); this.cleanupFuncs.push(() => play.removeEventListener('click', start));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      const immersive = state !== VisibilityState.NonImmersive;
      document.getElementById('entry')!.hidden = immersive;
      if (!immersive) this.xrPlaced = false;
      if (state === VisibilityState.VisibleBlurred && this.game.phase === 'running') this.game.pause();
    }));
  }
  private placeBoard() {
    this.player.head.getWorldPosition(this.head); this.player.head.getWorldDirection(this.direction);
    this.direction.y = 0; this.direction.normalize();
    this.root.object3D!.position.copy(this.head).addScaledVector(this.direction, this.far ? -0.6 : -0.45);
    this.root.object3D!.position.y = this.head.y - 0.35;
    this.root.object3D!.rotation.set(Math.PI / 12, Math.atan2(this.direction.x, this.direction.z), 0);
  }
  private scrub(tick: number) { const before = this.game.tick; this.game.scrub(tick); if (before !== this.game.tick) this.sound.play('dial'); this.refresh(); }
  private queueUI() {
    if (this.uiQueued) return; this.uiQueued = true;
    queueMicrotask(() => { this.uiQueued = false; if (this.ready) this.refresh(); });
  }
  update(delta: number, time: number) {
    if (!this.ready) return;
    this.now = time;
    if (this.world.session && !this.xrPlaced) { this.placeBoard(); this.xrPlaced = true; this.queueUI(); }
    (this.water.material as ShaderMaterial).uniforms.time.value = time;
    if (this.game.advance(delta)) this.queueUI();
    for (const slot of TOUCHES) this.touchQuiet[slot] = Math.min(1, this.touchQuiet[slot] + delta);
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
        const angle = Math.atan2(this.temp.x - DIAL_X, -(this.temp.z));
        const tick = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * this.game.mission.tickLimit);
        if (this.game.tick !== tick) { this.game.scrub(tick); this.queueUI(); }
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
  }
  private text(id: string, text: string) { if (id === 'Status') this.statusText = text; this.panel.requireElementById<UIKit.Text>(id).setProperties({ text }); }
  private show(id: string, visible: boolean) { this.panel.requireElementById(id).setProperties({ display: visible ? 'flex' : 'none' }); }
  private refresh() {
    const s = this.game, phase = s.phase, failure = s.simulation.outcome.kind === 'failure' && s.tick >= s.simulation.outcome.tick;
    const reason = failure && s.simulation.outcome.kind === 'failure' ? s.simulation.outcome.failures.map(f => f.reason).join('; ') : '';
    this.text('MissionTitle', `${s.missionIndex + 1} / ${s.missions.length}   ${s.mission.title}`);
    this.text('Status', reason || (phase === 'success' ? `${'*'.repeat(s.rating)}  All letters delivered!` : this.message || (phase === 'running' ? 'Sailing the plan you previewed.' : phase === 'paused' ? 'Paused' : 'Poke to select / pinch to carry. Hold to remove.')));
    this.text('Goal', masteryText(s.mission)); this.text('Tick', `Tick ${s.tick} / ${s.mission.tickLimit}`);
    this.panel.requireElementById('Card').setProperties({ backgroundColor: phase === 'success' ? '#c9e1b1' : failure ? '#f4c0ae' : '#f3e8ce' });
    this.show('EditControls', s.editable); this.show('Launch', s.editable); this.show('Pause', phase === 'running' || phase === 'paused'); this.text('Pause', phase === 'paused' ? 'Resume' : 'Pause');
    this.show('Stop', phase === 'running' || phase === 'paused'); this.show('Next', phase === 'success' && s.missionIndex < s.missions.length - 1); this.show('FailureControls', phase === 'failure');
    this.show('MoveControls', this.moveControls); this.show('RotateLock', !!this.lockCell && s.editable);
    this.text('Reach', `Reach: ${this.far ? 'far' : 'near'}`); this.text('Sound', `Sound: ${this.sound.muted ? 'off' : 'on'}`);
    const coachLines = ['Pinch the bend. Drop it in the glowing square.', 'Match each boat to its dock shape.', 'Turn the tide dial. Watch the sandbar.', 'Tap the lock to set a two-tick wait.'];
    this.coach.requireElementById<UIKit.Text>('CoachText').setProperties({ text: coachLines[s.missionIndex] });
    this.coach.position.set(s.missionIndex === 2 ? 0.16 : 0, 0.008, s.missionIndex === 2 ? 0.075 : 0.125);
    this.coach.scale.setScalar(s.missionIndex === 2 ? 0.55 : 1);
    this.coach.requireElementById<UIKit.Text>('TrayCounts').setProperties({ text: PIECES.map(p => `${p} ${s.editor.remaining(p)}`).join(' / ') });
    const f = s.frame;
    this.water.position.y = -0.005 + tideLevel(s.mission, s.tick) * 0.003;
    s.mission.bars.forEach((bar, i) => {
      const sandbar = this.terrain.getObjectByName(`Bar ${i}`);
      if (sandbar) sandbar.position.y = f.barsWet[i] ? -0.007 : 0.017;
    });
    for (const e of this.queries.items.entities) {
      const kind = e.getValue(BoardItem, 'kind')!;
      if (kind === 'tray' && !e.hasComponent(Grabbed)) {
        const piece = e.getValue(BoardItem, 'piece')! as PieceType, available = s.editor.remaining(piece) > 0;
        e.object3D!.visible = available; e.object3D!.pointerEvents = available && s.editable ? 'auto' : 'none';
        this.resetOrigin(e); if (this.selected === piece) e.object3D!.position.y += 0.016;
        const coached = s.editable && !s.editor.placements.length && piece === (s.missionIndex === 3 ? 'lock' : 'bend') && s.missionIndex !== 2;
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
      } else if (kind === 'dial' && !e.hasComponent(Grabbed)) {
        e.object3D!.rotation.y = -s.tick / s.mission.tickLimit * Math.PI * 2;
        e.object3D!.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material.emissive.setHex(s.missionIndex === 2 && s.editable ? 0x634000 : 0); });
      }
    }
    s.mission.docks.forEach((d, i) => {
      const delivered = f.boats.some(b => b.status === 'docked' && b.x === d.x && b.y === d.y);
      const windows = this.terrain.getObjectByName(`Village ${i}`)?.getObjectByName('Windows') as Mesh;
      if (windows) { const mat = windows.material as MeshStandardMaterial; mat.color.setHex(delivered ? 0xffda73 : 0x26484e); mat.emissive.setHex(delivered ? 0xffb82e : 0); mat.emissiveIntensity = delivered ? 1.5 : 0; }
    });
    if (phase === 'success' && this.shownPhase !== 'success') this.sound.play('dock');
    if (phase === 'failure' && this.shownPhase !== 'failure') this.sound.play('error');
    this.shownTick = s.tick; this.shownPhase = phase;
    this.debugEntity?.setValue(GameDebug, 'state', JSON.stringify(this.snapshot()));
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
      renderedBoats: [...this.queries.items.entities].filter(e => e.getValue(BoardItem, 'kind')! === 'boat').map(e => ({ name: e.object3D!.name, position: e.object3D!.position.toArray() })),
    };
  }
}
