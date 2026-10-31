import { createComponent, Types } from '@iwsdk/core';

export const BoardItem = createComponent('BoardItem', {
  kind: { type: Types.String, default: 'cell' },
  x: { type: Types.Int8, default: -1 },
  y: { type: Types.Int8, default: -1 },
  piece: { type: Types.String, default: '' },
  heldSeconds: { type: Types.Float32, default: 0 },
  lostSeconds: { type: Types.Float32, default: 0 },
  moved: { type: Types.Boolean, default: false },
  cancelled: { type: Types.Boolean, default: false },
  pressSeconds: { type: Types.Float32, default: 0 },
  pinchContact: { type: Types.Boolean, default: false },
  pokeAllowed: { type: Types.Boolean, default: true },
  origin: { type: Types.Vec3, default: [0, 0, 0] },
  hand: { type: Types.String, default: '' },
});

/** Dev-only observation and scenario setup. Commands cannot launch boats. */
export const GameDebug = createComponent('GameDebug', {
  state: { type: Types.String, default: '{}' },
  command: { type: Types.String, default: '' },
});
export const PokeCommit = createComponent('PokeCommit', {});
