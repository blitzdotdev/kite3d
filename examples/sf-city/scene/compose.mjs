// Compose stable asset references. Keep editor changes to placed nodes when regenerating.
import {existsSync} from 'node:fs'
import {read, write, uuid, hash, root} from './data.mjs'
import {resolve} from 'node:path'
import {THREE} from '../assets/models/city/mesh.mjs'

const generated = read('scene/generated.json')
const scenePath = 'assets/main.scene.gltf'
const doc = existsSync(resolve(root, scenePath)) ? read(scenePath) : {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: []}], nodes: []}
doc.nodes ||= []
const byId = new Map(doc.nodes.map((node, index) => [node.extras?.cityId, index]).filter(([id]) => id))
function upsert(id, values) {
  const index = byId.has(id) ? byId.get(id) : doc.nodes.length
  const old = {...doc.nodes[index]}
  if (old.matrix && (values.translation || values.rotation || values.scale)) {
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
    new THREE.Matrix4().fromArray(old.matrix).decompose(position, rotation, scale)
    old.translation = position.toArray(); old.rotation = rotation.toArray(); old.scale = scale.toArray()
    delete old.matrix
  }
  const baseline = old.extras?.cityGenerated || {}
  const next = {...old, ...values}
  if (values.extensions) {
    next.extensions = {...old.extensions}
    for (const [key, value] of Object.entries(values.extensions)) {
      next.extensions[key] = {...old.extensions?.[key], ...value}
    }
  }
  // An editor change wins until removed or explicitly reconciled. Updating a mesh does not move a placed asset.
  for (const key of ['name', 'translation', 'rotation', 'scale']) {
    const actual = old[key] ?? (key === 'translation' ? [0, 0, 0] : key === 'rotation' ? [0, 0, 0, 1] : key === 'scale' ? [1, 1, 1] : undefined)
    const equal = Array.isArray(actual) && Array.isArray(baseline[key])
      ? actual.length === baseline[key].length && actual.every((v, i) => Math.abs(v - baseline[key][i]) < 1e-5)
      : actual === baseline[key]
    if (baseline[key] !== undefined && !equal) next[key] = actual
  }
  if (values.rotation || values.translation || values.scale) delete next.matrix
  const rootPath = baseline.rootPath && old.extras?.rootPath !== baseline.rootPath ? old.extras.rootPath : values.extras?.rootPath
  next.extras = {...old.extras, ...values.extras, gltfUUID: old.extras?.gltfUUID || uuid(id), cityId: id,
    cityGenerated: {...values, extras: undefined, rootPath: values.extras?.rootPath}}
  if (rootPath) next.extras.rootPath = rootPath
  doc.nodes[index] = next; byId.set(id, index)
  return index
}
// Registrations are editor-owned too: preserved references and user-added nodes need them on reload.
const assets = existsSync(resolve(root, 'assets.json')) ? read('assets.json') : {version: 1, files: {}}
assets.files ||= {}
const groups = {}
for (const p of generated.placements) {
  // Many placed trees share a source file. One asset identity keeps their geometry shared in Play.
  const assetId = `sf-model-${hash(p.asset).slice(0, 16)}`
  if (p.asset.startsWith('/') || p.asset.includes('..') || !/\.gltf$/i.test(p.asset)) throw new Error(`Expected a project-relative .gltf asset for ${p.id}`)
  if (!existsSync(resolve(root, p.asset))) throw new Error(`Missing asset: ${p.asset}`)
  const files = {'f.gltf': p.asset}
  const assetDoc = read(p.asset)
  for (const resource of [...(assetDoc.buffers || []), ...(assetDoc.images || [])]) {
    if (!resource.uri || resource.uri.startsWith('data:') || /^https?:/.test(resource.uri)) continue
    const resolved = resolve(root, p.asset, '..', resource.uri)
    if (!resolved.startsWith(root + '/')) throw new Error(`Asset resource escapes the project: ${resource.uri}`)
    files[resource.uri] = resolved.slice(root.length + 1)
  }
  const registered = assets.files[assetId]
  // A replacement can keep the same asset ID and change its registered file.
  if (!registered || registered.path === p.asset) {
    assets.files[assetId] = {...registered, path: p.asset, files: {...registered?.files, ...files}}
  }
  const half = (p.yaw || 0) / 2
  const index = upsert(p.id, {name: p.name, translation: p.position, rotation: [0, Math.sin(half), 0, Math.cos(half)],
    scale: p.scale || [1, 1, 1], extras: {rootPath: `/kite3d/@${assetId}/f.gltf`,
      sProperties: ['name', 'position', 'quaternion', 'scale', 'visible'],
      city: {kind: p.kind, sourceId: p.sourceId, sourceDataset: p.sourceDataset, heightSource: p.heightSource,
        widthSource: p.widthSource, species: p.species, sourceHash: p.sourceHash}}})
  ;(groups[p.tile] ||= []).push(index)
}
const groupIndices = Object.keys(groups).sort().map((tile) => upsert(`sf-tile:${tile}`, {name: `Tile ${tile}`, children: groups[tile]}))
const cityRoot = upsert('sf-city:root', {name: 'San Francisco / North Beach', children: groupIndices,
  extras: {city: {bounds: generated.area.bounds, horizontalOrigin: generated.area.origin, verticalOriginM: generated.area.verticalOriginM}}})
const scene = doc.scenes[doc.scene || 0]
scene.name = 'North Beach test slice'
scene.nodes = [cityRoot, ...(scene.nodes || []).filter((index) => index !== cityRoot)]
doc.extensions ||= {}
const lightExtension = doc.extensions.KHR_lights_punctual ||= {lights: []}
for (const [id, direction, color, intensity] of [
  ['sun', [-1, -2, -1], [1, 0.94, 0.84], 2.5],
  ['sky', [1, -1, 1], [0.72, 0.83, 1], 1.2],
  ['fill', [-1, -1, 1], [0.86, 0.90, 1], 0.5],
]) {
  const name = `City ${id}`
  let light = lightExtension.lights.findIndex((entry) => entry.name === name)
  if (light < 0) light = lightExtension.lights.length
  lightExtension.lights[light] = {...lightExtension.lights[light], name, type: 'directional', color, intensity}
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...direction).normalize())
  const index = upsert(`sf-light:${id}`, {name, rotation: q.toArray(), extensions: {KHR_lights_punctual: {light}}})
  if (!scene.nodes.includes(index)) scene.nodes.push(index)
}
doc.extensionsUsed = [...new Set([...(doc.extensionsUsed || []), 'KHR_lights_punctual'])]
doc.asset.generator = 'Kite3D SF city composer v1'
write(scenePath, doc); write('assets.json', assets)
console.log(`Placed ${generated.placements.length} editable objects in ${groupIndices.length} groups`)
