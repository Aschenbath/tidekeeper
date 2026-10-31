import { InstancedMesh, Matrix4, Object3D, Scene, PerspectiveCamera, Vector3 } from '@iwsdk/core';
import { BaseControllerVisual, XRHandVisualAdapter, type VisualImplementation } from '@iwsdk/xr-input';
import assets from '../assets';

/** SDK tracking and pointers, rendered with two local instanced primitive hands. */
export class LocalHandVisual implements VisualImplementation {
  static assetPath = `${import.meta.env.BASE_URL}models/hand-rig.gltf`;
  static assetProfileId = 'local-hand';
  static assetKeyPrefix = 'tidekeeper-hand';
  private dots!: InstancedMesh;
  private bones!: InstancedMesh;
  private palm!: Object3D;
  private jointMatrix = new Matrix4();
  private from = new Vector3();
  private to = new Vector3();
  private axis = new Vector3(0, 1, 0);
  private segment = new Object3D();
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
    this.bones = model.getObjectByName('Finger bones') as InstancedMesh;
    this.palm = model.getObjectByName('Palm')!;
    this.dots.frustumCulled = false;
    this.bones.frustumCulled = false;
  }
  update() {
    const transforms = this.xrInput?.jointTransforms;
    if (!this.enabled || !transforms) return;
    for (let i=0; i<25; i++) { this.jointMatrix.fromArray(transforms,i*16); this.dots.setMatrixAt(i,this.jointMatrix); }
    this.dots.instanceMatrix.needsUpdate = true;
    for (let i = 1; i < 25; i++) {
      // WebXR joint order: wrist, thumb(4), then four fingers(5 each).
      const previous = i === 1 || i === 5 || i === 10 || i === 15 || i === 20 ? 0 : i - 1;
      this.from.setFromMatrixPosition(this.jointMatrix.fromArray(transforms, previous * 16));
      this.to.setFromMatrixPosition(this.jointMatrix.fromArray(transforms, i * 16));
      this.segment.position.copy(this.from).add(this.to).multiplyScalar(0.5);
      this.to.sub(this.from); this.segment.scale.set(1, this.to.length(), 1);
      this.segment.quaternion.setFromUnitVectors(this.axis, this.to.normalize());
      this.segment.updateMatrix(); this.bones.setMatrixAt(i - 1, this.segment.matrix);
    }
    this.bones.instanceMatrix.needsUpdate = true;
    this.jointMatrix.fromArray(transforms, 0);
    this.palm.position.setFromMatrixPosition(this.jointMatrix);
    this.palm.quaternion.setFromRotationMatrix(this.jointMatrix);
    this.palm.translateZ(-0.023); this.palm.scale.set(0.025, 0.009, 0.031);
  }
}

export class LocalControllerVisual extends BaseControllerVisual {
  static assetPath = `${import.meta.env.BASE_URL}models/hand-rig.gltf`;
  static assetProfileId = 'local-controller';
  static assetKeyPrefix = 'tidekeeper-controller';
  init() { const grip = assets.handle.clone(); grip.scale.setScalar(0.5); this.model.add(grip); }
}
