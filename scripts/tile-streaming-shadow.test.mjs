// Observed r163 regression: a missing map leaves the shared shadow sampler
// referencing a disposed texture. Actual GPU reproduction uses alternating chunks.
import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class ImageData {}
const {Group, Mesh, BoxGeometry, MeshBasicMaterial, Matrix4} = await import('three')
const {createKiteTileAdapter} = await import('../examples/sf-city/lib/tile-streaming.js')
test('shadow cleanup preserves callbacks, cutouts and custom depth paths', async () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), source = new Group(), calls = []
  source.add(new Mesh(geometry, material))
  source.clone = () => {
    const result = new Group()
    for (const custom of [false, true]) {
      const mesh = new Mesh(geometry, material)
      mesh.onBeforeShadow = function(...args) { calls.push({receiver: this, args}) }
      if (custom) mesh.customDepthMaterial = {isMaterial: true}
      result.add(mesh)
    }
    return result
  }
  const feature = {id: 'test', asset: 'test', visible: true, worldMatrix: new Matrix4().toArray()}
  const adapter = createKiteTileAdapter({assetManager: {importer: {importSingle: async () => source}}, setDirty() {}},
    {features: [feature]}, new Group(), {resolveAsset: () => 'test', validateFeature: () => true})
  const handle = await adapter.load('test', {featureIds: ['test']}, new AbortController().signal)
  const [mesh, custom] = handle.root.children[0].children[0].children
  const stale = {disposed: true}, live = {}, alpha = {}, displacement = {}
  const uniforms = {map: {value: stale}, alphaMap: {value: alpha}, displacementMap: {value: displacement}}
  const renderer = {properties: {get: () => ({uniforms})}}, depth = {isMeshDepthMaterial: true, map: null}
  const invoke = (node, mat) => node.onBeforeShadow(renderer, node, {}, {}, geometry, mat, null)
  invoke(mesh, depth)
  assert.equal(uniforms.map.value, null)
  assert.equal(uniforms.alphaMap.value, alpha)
  assert.equal(uniforms.displacementMap.value, displacement)
  assert.equal(calls[0].receiver, mesh)
  assert.equal(calls[0].args[5], depth)
  uniforms.map.value = live; depth.map = live; depth.alphaTest = .5
  invoke(mesh, depth)
  assert.equal(uniforms.map.value, live)
  uniforms.map.value = stale; depth.map = null
  invoke(custom, depth)
  assert.equal(uniforms.map.value, stale)
  invoke(mesh, {isShaderMaterial: true, map: null})
  assert.equal(uniforms.map.value, stale)
  adapter.release(handle)
  assert.equal(adapter.state.resources, 0)
})
