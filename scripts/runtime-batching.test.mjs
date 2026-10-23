import assert from 'node:assert/strict'
import {test} from 'node:test'
globalThis.ImageData ??= class {}
const {BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Texture, DynamicDrawUsage, Plane, Vector3} = await import('three')
import {createGeometryKey, createMaterialKey, createRuntimeMaterialPool} from '../examples/sf-city/lib/batch-keys.js'

// Guards the measured standalone viewer's 1,569 visible meshes: separately loaded
// identical tree parts had different UUIDs and never shared an instance batch.
test('runtime batch keys combine identical copies but preserve geometry and material edits', async () => {
    const geometryKey = createGeometryKey(), materialKey = createMaterialKey()
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    const copy = geometry.clone()
    assert.notEqual(geometry.uuid, copy.uuid)
    assert.equal(geometryKey(geometry), geometryKey(copy))
    const edited = geometry.clone(); edited.attributes.position.setX(0, .01)
    assert.notEqual(geometryKey(geometry), geometryKey(edited))
    const clipped = geometry.clone(); clipped.setDrawRange(0, 2)
    assert.notEqual(geometryKey(geometry), geometryKey(clipped))
    const dynamic = geometry.clone(); dynamic.attributes.position.setUsage(DynamicDrawUsage)
    assert.notEqual(geometryKey(dynamic), geometryKey(dynamic.clone()))
    const material = new MeshStandardMaterial({roughness: .8, color: '#557733'})
    const image = {src: 'https://example.invalid/leaves.png'}
    material.map = new Texture(image)
    const duplicate = material.clone(); duplicate.map = material.map.clone()
    assert.equal(materialKey(material), materialKey(duplicate))
    const rough = material.clone(); rough.roughness = .2
    assert.notEqual(materialKey(material), materialKey(rough))
    const sampler = material.clone(); sampler.map = material.map.clone(); sampler.map.repeat.x = 2
    assert.notEqual(materialKey(material), materialKey(sampler))
    const replaced = material.clone(); replaced.map = new Texture({src: 'https://example.invalid/owner.png'})
    assert.notEqual(materialKey(material), materialKey(replaced))
    const clippedMaterial = material.clone(); clippedMaterial.clippingPlanes = [new Plane(new Vector3(0, 1, 0), 2)]
    assert.notEqual(materialKey(material), materialKey(clippedMaterial))
    const manualUv = material.clone(); manualUv.map = material.map.clone(); manualUv.map.matrixAutoUpdate = false; manualUv.map.matrix.elements[6] = .25
    assert.notEqual(materialKey(material), materialKey(manualUv))
    const custom = material.clone(); custom.onBeforeCompile = () => {}
    assert.notEqual(materialKey(material), materialKey(custom))
    const pool = createRuntimeMaterialPool()
    const otherTint = duplicate.clone(); otherTint.color.set('#bb8822')
    const firstRuntime = pool.get(material), secondRuntime = pool.get(otherTint)
    assert.notEqual(firstRuntime, material)
    assert.notEqual(secondRuntime, otherTint)
    assert.equal(firstRuntime.map, secondRuntime.map)
    assert.notEqual(material.map, otherTint.map)
    assert.notEqual(firstRuntime.color.getHex(), secondRuntime.color.getHex())
    assert.notEqual(pool.get(manualUv).map, firstRuntime.map)
    let textureDisposals = 0
    material.map.addEventListener('dispose', () => textureDisposals++)
    pool.dispose(); assert.equal(textureDisposals, 0)
    assert.equal(material.map, firstRuntime.map)
    const previousBitmap = globalThis.ImageBitmap, previousDocument = globalThis.document, previousHtml = globalThis.HTMLImageElement
    class Bitmap {
        constructor(pixels) { this.width = 1; this.height = 1; this.pixels = new Uint8ClampedArray(pixels) }
    }
    globalThis.ImageBitmap = Bitmap
    globalThis.document = {createElement() {
        let image
        return {getContext: () => ({drawImage: value => { image = value }, getImageData: () => ({data: image.pixels})})}
    }}
    try {
        const bitmaps = createRuntimeMaterialPool()
        const make = (rgba, path = '/shared.png') => {
            const m = new MeshStandardMaterial()
            m.map = new Texture(new Bitmap(rgba)); m.map.userData.rootPath = path
            return m
        }
        const a = make([10, 20, 30, 255]), same = make([10, 20, 30, 255])
        const editedBitmap = make([90, 20, 30, 255])
        assert.equal(bitmaps.get(a).map, bitmaps.get(same).map)
        assert.notEqual(bitmaps.get(a).map, bitmaps.get(editedBitmap).map)
        assert.notEqual(bitmaps.get(a).map, bitmaps.get(make([10, 20, 30, 255], '/different.png')).map)
        const translucent = make([10, 20, 30, 120]), translucentCopy = make([10, 20, 30, 120])
        assert.notEqual(bitmaps.get(translucent).map, bitmaps.get(translucentCopy).map)
        assert.equal(bitmaps.keyForMaterial(a), bitmaps.keyForMaterial(same))
        // Manual browser profiling found per-import blob URLs for identical PNGs.
        class HtmlImage extends Bitmap {
            constructor(pixels, src) { super(pixels); this.src = src; this.complete = true; this.naturalWidth = 1 }
        }
        globalThis.HTMLImageElement = HtmlImage
        const htmlMaterial = (pixels, src) => {
            const m = new MeshStandardMaterial()
            m.map = new Texture(new HtmlImage(pixels, src)); m.map.userData.rootPath = '/shared.png'
            return m
        }
        const htmlA = htmlMaterial([10, 20, 30, 255], 'blob:one')
        const htmlB = htmlMaterial([10, 20, 30, 255], 'blob:two')
        assert.equal(bitmaps.keyForMaterial(htmlA), bitmaps.keyForMaterial(htmlB))
        assert.equal(bitmaps.get(htmlA), bitmaps.get(htmlB))
        const htmlEdit = htmlMaterial([99, 20, 30, 255], 'blob:three')
        assert.notEqual(bitmaps.keyForMaterial(htmlA), bitmaps.keyForMaterial(htmlEdit))
        const htmlOwner = htmlMaterial([10, 20, 30, 255], 'blob:four')
        htmlOwner.map.userData.ownerNote = 'Keep separate'
        assert.notEqual(bitmaps.keyForMaterial(htmlA), bitmaps.keyForMaterial(htmlOwner))
        const originalFetch = globalThis.fetch
        const encodedPool = createRuntimeMaterialPool()
        try {
            globalThis.fetch = async src => ({ok: src !== 'blob:revoked', arrayBuffer: async () => new Uint8Array(src === 'blob:three' ? [9, 2, 3] : [1, 2, 3]).buffer})
            const revoked = htmlMaterial([10, 20, 30, 255], 'blob:revoked')
            await encodedPool.prepare([htmlA, htmlB, htmlEdit, htmlOwner, revoked])
            assert.equal(encodedPool.keyForMaterial(htmlA), encodedPool.keyForMaterial(htmlB))
            assert.notEqual(encodedPool.keyForMaterial(htmlA), encodedPool.keyForMaterial(htmlEdit))
            assert.notEqual(encodedPool.keyForMaterial(htmlA), encodedPool.keyForMaterial(htmlOwner))
            assert.notEqual(encodedPool.keyForMaterial(htmlA), encodedPool.keyForMaterial(revoked))
            assert.equal(encodedPool.stats.encodedReads, 4)
            assert.equal(encodedPool.stats.encodedFailures, 1)
            assert.equal(encodedPool.stats.bitmapReads, 0)
            const changedAfterPrepare = htmlA.clone()
            changedAfterPrepare.map = htmlA.map.clone()
            changedAfterPrepare.map.source.data.src = 'blob:owner-replacement'
            assert.notEqual(encodedPool.keyForMaterial(htmlB), encodedPool.keyForMaterial(changedAfterPrepare))
        } finally { globalThis.fetch = originalFetch; encodedPool.dispose() }
        bitmaps.dispose()
    } finally {
        globalThis.ImageBitmap = previousBitmap; globalThis.document = previousDocument; globalThis.HTMLImageElement = previousHtml
    }
    const owner = material.clone(); owner.userData.ownerNote = 'Preserve this variant'
    assert.notEqual(materialKey(material), materialKey(owner))
})
