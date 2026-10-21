// Offline glTF writer. Each feature remains a selectable asset with its own named meshes.
import {write} from '../../../scene/data.mjs'
globalThis.ImageData ??= class {}
export const THREE = await import('three')

export function material(name, color, roughness = 0.85, metallic = 0) {
  const c = new THREE.Color(color)
  return {name, pbrMetallicRoughness: {baseColorFactor: [c.r, c.g, c.b, 1], roughnessFactor: roughness, metallicFactor: metallic}, doubleSided: true}
}

export function surface(points, indices) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
  geometry.setIndex(indices.flat())
  geometry.computeVertexNormals()
  return geometry
}

export function box(width, height, depth, position, yaw = 0) {
  const g = new THREE.BoxGeometry(width, height, depth)
  g.rotateY(yaw); g.translate(...position)
  return g
}

export function asset(path, parts, materials, extras = {}) {
  const doc = {asset: {version: '2.0', generator: 'Kite3D SF city baker v1'}, scene: 0,
    scenes: [{nodes: [0]}], nodes: [{name: extras.name || 'Asset', children: [], extras}], meshes: [],
    materials, accessors: [], bufferViews: [], buffers: []}
  const buffers = []
  let byteLength = 0, triangleCount = 0
  function accessor(array, components, componentType, type, position = false) {
    const padding = (4 - byteLength % 4) % 4
    if (padding) { buffers.push(Buffer.alloc(padding)); byteLength += padding }
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
    const index = doc.accessors.length
    const view = doc.bufferViews.push({buffer: 0, byteOffset: byteLength, byteLength: bytes.length}) - 1
    const entry = {bufferView: view, componentType, count: array.length / components, type}
    if (position) {
      entry.min = [Infinity, Infinity, Infinity]; entry.max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < array.length; i++) {
        entry.min[i % 3] = Math.min(entry.min[i % 3], array[i]); entry.max[i % 3] = Math.max(entry.max[i % 3], array[i])
      }
    }
    doc.accessors.push(entry); buffers.push(bytes); byteLength += bytes.length
    return index
  }
  for (const {name, geometry, mat = 0} of parts) {
    if (!geometry?.attributes.position.count) continue
    const position = geometry.getAttribute('position')
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    const normal = geometry.getAttribute('normal')
    const attributes = {
      POSITION: accessor(new Float32Array(position.array), 3, 5126, 'VEC3', true),
      NORMAL: accessor(new Float32Array(normal.array), 3, 5126, 'VEC3'),
    }
    const indices = geometry.index?.array || Uint32Array.from({length: position.count}, (_, i) => i)
    const groups = geometry.groups.length ? geometry.groups : [{start: 0, count: indices.length, materialIndex: 0}]
    const primitives = groups.map((group) => {
      const list = new Uint32Array(indices.slice(group.start, group.start + group.count))
      triangleCount += list.length / 3
      return {attributes, indices: accessor(list, 1, 5125, 'SCALAR'), material: Array.isArray(mat) ? mat[group.materialIndex] : mat}
    })
    const mesh = doc.meshes.push({name, primitives}) - 1
    doc.nodes[0].children.push(doc.nodes.push({name, mesh}) - 1)
    geometry.dispose()
  }
  const bytes = Buffer.concat(buffers)
  doc.buffers = [{uri: 'geometry.bin', byteLength: bytes.length}]
  write(`${path}/geometry.bin`, bytes); write(`${path}/f.gltf`, doc)
  return {path: `${path}/f.gltf`, triangles: triangleCount, bytes: bytes.length}
}
