import { BufferGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D } from '@iwsdk/core';

/** Bake static surfaces by material. Keep moving/named feedback surfaces separate. */
export function batchStatic(root: Object3D, keep: (mesh: Mesh) => boolean = () => false) {
  root.updateMatrixWorld(true);
  const combined = new MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:0.82});
  const groups = new Map<MeshStandardMaterial, { positions: number[]; normals: number[]; uv: number[]; colors: number[]; names: string[] }>();
  const remove: Mesh[] = [], matrix = new Matrix4(), instance = new Matrix4();
  const inverse = root.matrixWorld.clone().invert();
  root.traverse(object => {
    if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial) || keep(object)) return;
    let group = groups.get(combined);
    if (!group) { group = { positions: [], normals: [], uv: [], colors: [], names: [] }; groups.set(combined, group); }
    group.names.push(...(object.userData.parts ?? [object.name]));
    if (object.material.side === DoubleSide) combined.side = DoubleSide;
    const count = object instanceof InstancedMesh ? object.count : 1;
    for (let i = 0; i < count; i++) {
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      if (object instanceof InstancedMesh) { object.getMatrixAt(i, instance); matrix.multiply(instance); }
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(matrix);
      group.positions.push(...geometry.getAttribute('position').array);
      group.normals.push(...geometry.getAttribute('normal').array);
      const uv = geometry.getAttribute('uv');
      if (uv) group.uv.push(...uv.array); else group.uv.push(...new Array(geometry.getAttribute('position').count * 2).fill(0));
      const color = geometry.getAttribute('color'), tint = object.material.color;
      for (let vertex = 0; vertex < geometry.getAttribute('position').count; vertex++) {
        group.colors.push(tint.r * (color?.getX(vertex) ?? 1), tint.g * (color?.getY(vertex) ?? 1), tint.b * (color?.getZ(vertex) ?? 1));
      }
      geometry.dispose();
    }
    remove.push(object);
  });
  for (const object of remove) object.removeFromParent();
  for (const [material, data] of groups) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(data.uv, 2));
    geometry.setAttribute('color', new Float32BufferAttribute(data.colors, 3));
    const mesh = new Mesh(geometry, material); mesh.name = `Batched ${material.color.getHexString()}`;
    mesh.userData.parts = data.names; root.add(mesh);
  }
  return root;
}
