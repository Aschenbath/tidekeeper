/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { TidekeeperSystem } from './systems/tidekeeper';
import { LocalHandVisual, LocalControllerVisual } from './systems/local-hands';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.input.xr.visualAdapters.hand.left.updateVisualImplementation(LocalHandVisual);
  world.input.xr.visualAdapters.hand.right.updateVisualImplementation(LocalHandVisual);
  world.input.xr.visualAdapters.controller.left.updateVisualImplementation(LocalControllerVisual);
  world.input.xr.visualAdapters.controller.right.updateVisualImplementation(LocalControllerVisual);
  world.registerSystem(TidekeeperSystem);
});
