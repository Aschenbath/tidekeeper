/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';
import { MISSIONS } from './game/missions';
import { createBoard, createBoat, createCell, createPiece, createDial, createHandle, createFailureMarker, createHandJoints } from './scene-assets/tidekeeper.scene-asset';

export default defineAssets({
  ...Object.fromEntries(MISSIONS.map(m => [`board-${m.id}`, createBoard(m)])),
  'piece-straight': createPiece('straight'),
  'piece-bend': createPiece('bend'),
  'piece-lock': createPiece('lock'),
  'boat-circle': createBoat('circle'),
  'boat-triangle': createBoat('triangle'),
  cell: createCell(), dial: createDial(), handle: createHandle(), failure: createFailureMarker(),
  'hand-joints': createHandJoints(),
  'hand-rig': { url: `${import.meta.env.BASE_URL}models/hand-rig.gltf`, type: AssetType.GLTF },
  'game-panel': { url: `${import.meta.env.BASE_URL}ui/game.uikitml`, type: AssetType.UIKitML },
  'coach-panel': { url: `${import.meta.env.BASE_URL}ui/coach.uikitml`, type: AssetType.UIKitML },
});
