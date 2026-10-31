import { InstancedMesh, Matrix4, Object3D, Scene, PerspectiveCamera } from '@iwsdk/core';
import { BaseControllerVisual, XRHandVisualAdapter, type VisualImplementation } from '@iwsdk/xr-input';
import assets from '../assets';

/** SDK tracking and pointers, rendered with two local instanced primitive hands. */
export class LocalHandVisual implements VisualImplementation {
  static assetPath = `${import.meta.env.BASE_URL}models/hand-rig.gltf`;
  static assetProfileId = 'local-hand';
  static assetKeyPrefix = 'tidekeeper-hand';
  private dots!: InstancedMesh;
  private jointMatrix = new Matrix4();
  private enabled = true;
  public xrInput?: XRHandVisualAdapter;
  constructor(_scene: Scene, _camera: PerspectiveCamera, public model: Object3D) {}
  connect(_source: XRInputSource, enabled: boolean) { this.toggle(enabled); }
  disconnect() { this.model.visible = false; }
  toggle(enabled: boolean) { this.enabled = enabled; this.model.visible = enabled; }
  init() {
    const prototype = assets['hand-joints'];
    if (!(prototype instanceof Object3D)) throw new Error('Missing local hand model');
    const model = prototype.clone(true); this.model.add(model);
    this.dots = model.getObjectByName('Tracked joints') as InstancedMesh;
    this.dots.frustumCulled = false;
  }
  update() {
    const transforms = this.xrInput?.jointTransforms;
    if (!this.enabled || !transforms) return;
    for (let i=0; i<25; i++) { this.jointMatrix.fromArray(transforms,i*16); this.dots.setMatrixAt(i,this.jointMatrix); }
    this.dots.instanceMatrix.needsUpdate = true;
  }
}

export class LocalControllerVisual extends BaseControllerVisual {
  static assetPath = `${import.meta.env.BASE_URL}models/hand-rig.gltf`;
  static assetProfileId = 'local-controller';
  static assetKeyPrefix = 'tidekeeper-controller';
  init() { const grip = assets.handle.clone(); grip.scale.setScalar(0.5); this.model.add(grip); }
}
