import assert from 'node:assert/strict'
import {test} from 'node:test'
globalThis.ImageData ??= class {}
const {MeshStandardMaterial, Texture} = await import('three')
const {createTileMaterialPool} = await import('../examples/sf-city/lib/tile-material-pool.js')

// Guards the manually profiled tile prototype's duplicated textures and the
// observed ownership hazard when the first source tile unloads before a peer.
test('tile resource leases retain owned images until the last tile releases', async () => {
  const saved = {Image: globalThis.Image, HTMLImageElement: globalThis.HTMLImageElement, fetch: globalThis.fetch}
  class Image {
    constructor() { this.complete = true; this.naturalWidth = 1; this.naturalHeight = 1; this.src = '' }
    async decode() {}
  }
  globalThis.Image = Image; globalThis.HTMLImageElement = Image
  globalThis.fetch = async src => ({ok: true, headers: new Headers({'content-type': 'image/png'}),
    arrayBuffer: async () => new Uint8Array(src === 'blob:changed' ? [9, 2, 3] : [1, 2, 3]).buffer})
  const make = src => {
    const image = new Image(); image.src = src
    const material = new MeshStandardMaterial({roughness: .8})
    material.map = new Texture(image); material.map.userData.rootPath = '/shared.png'
    return material
  }
  const pool = createTileMaterialPool()
  try {
    const a = make('blob:first'), b = make('blob:second')
    a.userData.gltfExtensions = undefined; b.userData.gltfExtensions = undefined
    const leaseA = await pool.acquire([a]), leaseB = await pool.acquire([b])
    const runtime = leaseA.materialFor(a), texture = runtime.map
    assert.equal(runtime, leaseB.materialFor(b))
    assert.notEqual(runtime, a); assert.notEqual(texture, a.map)
    assert.notEqual(texture.source, a.map.source); assert.notEqual(texture.image, a.map.image)
    let runtimeDisposals = 0, textureDisposals = 0, sourceDisposals = 0
    runtime.addEventListener('dispose', () => runtimeDisposals++)
    texture.addEventListener('dispose', () => textureDisposals++)
    b.map.addEventListener('dispose', () => sourceDisposals++)
    leaseA.release(); a.map.dispose(); a.dispose()
    assert.equal(leaseB.materialFor(b).map, texture)
    assert.equal(texture.image.complete, true)
    assert.equal(runtimeDisposals, 0); assert.equal(textureDisposals, 0)
    const changed = make('blob:changed'), sampler = make('blob:third'), owner = make('blob:fourth')
    sampler.map.repeat.x = 2; owner.map.userData.ownerNote = 'separate'
    const variants = await pool.acquire([changed, sampler, owner])
    assert.notEqual(variants.materialFor(changed).map, texture)
    assert.notEqual(variants.materialFor(sampler).map, texture)
    assert.notEqual(variants.materialFor(owner).map, texture)
    variants.release(); leaseB.release(); leaseB.release()
    assert.equal(runtimeDisposals, 1); assert.equal(textureDisposals, 1); assert.equal(sourceDisposals, 0)
    assert.deepEqual(pool.state, {leases: 0, images: 0, textures: 0, materials: 0})
    const customMetadata = make('blob:custom-metadata')
    customMetadata.userData = new (class OwnerState { constructor() { this.gltfExtensions = undefined; this.value = 1 } })()
    const metadataLease = await pool.acquire([customMetadata]); assert.equal(metadataLease.materialFor(customMetadata), customMetadata); metadataLease.release()
    const unknown = make('blob:unknown'); unknown.userData.ownerField = undefined
    const unknownLease = await pool.acquire([unknown]); assert.equal(unknownLease.materialFor(unknown), unknown); unknownLease.release()
    const extension = make('blob:extension'); extension.userData.gltfExtensions = {OWNER_extension: {value: 1}}
    const extensionLease = await pool.acquire([extension]); assert.deepEqual(extensionLease.materialFor(extension).userData.gltfExtensions, extension.userData.gltfExtensions); extensionLease.release()
    const defineA = make('blob:define-a'), defineB = make('blob:define-b'); defineA.defines = {OWNER_VARIANT: 1}; defineB.defines = {OWNER_VARIANT: 2}
    const defineLease = await pool.acquire([defineA, defineB]); assert.notEqual(defineLease.materialFor(defineA), defineLease.materialFor(defineB)); assert.deepEqual(defineLease.materialFor(defineA).defines, defineA.defines); defineLease.release()
    const uniforms = make('blob:uniforms'); uniforms.extraUniformsToUpload = {owner: {value: 1}}
    const uniformLease = await pool.acquire([uniforms]); assert.equal(uniformLease.materialFor(uniforms), uniforms); uniformLease.release()
    const custom = make('blob:custom'); custom.onBeforeCompile = () => {}
    const customLease = await pool.acquire([custom])
    assert.equal(customLease.materialFor(custom), custom)
    // Actual pinned-Three inspection found stale automatic matrices could split
    // texture keys while material keys matched, invalidating a peer on unload.
    const matrixPool = createTileMaterialPool(), stale = make('blob:stale'), updated = make('blob:updated')
    stale.map.repeat.x = 2; updated.map.repeat.x = 2; updated.map.updateMatrix()
    const staleLease = await matrixPool.acquire([stale]), updatedLease = await matrixPool.acquire([updated])
    const sharedMap = updatedLease.materialFor(updated).map
    assert.equal(staleLease.materialFor(stale).map, sharedMap)
    let sharedDisposals = 0; sharedMap.addEventListener('dispose', () => sharedDisposals++)
    staleLease.release(); assert.equal(sharedDisposals, 0)
    assert.equal(updatedLease.materialFor(updated).map, sharedMap)
    updatedLease.release(); assert.equal(sharedDisposals, 1); matrixPool.dispose()
    const pendingPool = createTileMaterialPool()
    let finishDecode, createdUrl, revokedUrl
    const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL
    try {
      URL.createObjectURL = blob => (createdUrl = oldCreate(blob))
      URL.revokeObjectURL = url => { revokedUrl = url; oldRevoke(url) }
      globalThis.Image = class extends Image { decode() { return new Promise(resolve => { finishDecode = resolve }) } }
      const pending = pendingPool.acquire([b])
      for (let i = 0; i < 10 && !finishDecode; i++) await new Promise(resolve => setImmediate(resolve))
      assert.equal(typeof finishDecode, 'function')
      pendingPool.dispose(); finishDecode()
      await assert.rejects(pending, /cancelled/)
      assert.equal(revokedUrl, createdUrl)
      assert.deepEqual(pendingPool.state, {leases: 0, images: 0, textures: 0, materials: 0})
    } finally { pendingPool.dispose(); globalThis.Image = Image; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke }
    const cachedPool = createTileMaterialPool(), repeated = make('blob:repeat')
    repeated.roughnessMap = repeated.map; repeated.normalMap = repeated.map.clone()
    const repeatLease = await cachedPool.acquire([repeated])
    assert.equal(cachedPool.stats.blobReads, 1); assert.equal(cachedPool.stats.sourceCacheHits, 2)
    repeatLease.release(); cachedPool.dispose()
    pool.dispose(); assert.throws(() => customLease.materialFor(custom))
    await assert.rejects(pool.acquire([b]), /stopped/)
  } finally { pool.dispose(); Object.assign(globalThis, saved) }
})
