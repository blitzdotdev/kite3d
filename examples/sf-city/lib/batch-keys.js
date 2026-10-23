// Runtime-only equivalence. Never rewrite authored assets or trust a hash alone.
export function createGeometryKey() {
  const cached = new WeakMap(), buckets = new Map()
  let next = 0
  return geometry => {
    if (cached.has(geometry)) return cached.get(geometry)
    const unique = () => { const key = `unique-${next++}`; cached.set(geometry, key); return key }
    if (!geometry?.isBufferGeometry || geometry.isInstancedBufferGeometry || Object.keys(geometry.morphAttributes || {}).length) return unique()
    const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
    if (geometry.index) attributes.push(['index', geometry.index])
    if (attributes.some(([, a]) => a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute || a.usage !== 35044 || !ArrayBuffer.isView(a.array))) return unique()
    const metadata = JSON.stringify({groups: geometry.groups, drawRange: geometry.drawRange, userData: geometry.userData,
      attributes: attributes.map(([name, a]) => [name, a.array.constructor.name, a.itemSize, a.normalized, a.gpuType, a.count])})
    const arrays = attributes.map(([, a]) => new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength))
    let hash = 2166136261
    for (const array of arrays) for (const byte of array) hash = Math.imul(hash ^ byte, 16777619) >>> 0
    const bucketKey = `${metadata}:${hash}`
    const candidates = buckets.get(bucketKey) || []
    for (const candidate of candidates) {
      if (arrays.every((array, i) => array.length === candidate.arrays[i].length && array.every((byte, j) => byte === candidate.arrays[i][j]))) {
        cached.set(geometry, candidate.key); return candidate.key
      }
    }
    const key = `geometry-${next++}`
    candidates.push({arrays, key}); buckets.set(bucketKey, candidates); cached.set(geometry, key)
    return key
  }
}

export function createMaterialKey(imageKey = texture => texture.source?.data?.src) {
  const cached = new WeakMap(), prototypes = new WeakMap()
  let next = 0
  return material => {
    if (cached.has(material)) return cached.get(material)
    const unique = () => { const key = `unique-${next++}`; cached.set(material, key); return key }
    // Functions and shader extensions cannot be represented faithfully by JSON.
    // Leave customized materials independent rather than merging owner edits.
    if (material.isShaderMaterial || Object.hasOwn(material, 'onBeforeRender') || Object.hasOwn(material, 'onBeforeCompile') || Object.hasOwn(material, 'customProgramCacheKey') || material.materialExtensions?.length) return unique()
    const meta = {textures: {}, images: {}}
    for (const texture of Object.values(material)) {
      if (!texture?.isTexture) continue
      const sourceKey = imageKey(texture)
      if (!sourceKey || texture.isVideoTexture || texture.isRenderTargetTexture || texture.onUpdate) return unique()
      meta.images[texture.source.uuid] = {uuid: texture.source.uuid, url: sourceKey}
    }
    const data = material.toJSON(meta, true)
    const prototype = Object.getPrototypeOf(material)
    if (!prototypes.has(prototype)) prototypes.set(prototype, next++)
    data.runtimePrototype = prototypes.get(prototype)
    // Three material JSON omits some runtime-only render state, notably clipping.
    data.runtimeState = Object.fromEntries(Object.entries(material).filter(([key, value]) =>
      !['id', 'uuid', 'name', 'version'].includes(key) &&
      (value === null || ['string', 'number', 'boolean'].includes(typeof value))))
    data.runtimeClipping = material.clippingPlanes?.map(plane => [...plane.normal.toArray(), plane.constant]) || null
    delete data.uuid; delete data.name; delete data.metadata
    if (data.userData) { data.userData = {...data.userData}; delete data.userData.uuid }
    for (const [property, texture] of Object.entries(material)) {
      if (!texture?.isTexture) continue
      const value = texture.toJSON(meta)
      delete value.uuid; delete value.name; value.image = imageKey(texture)
      if (value.userData) { value.userData = {...value.userData}; delete value.userData.uuid }
      value.runtimeMatrixAutoUpdate = texture.matrixAutoUpdate
      if (!texture.matrixAutoUpdate) value.runtimeMatrix = texture.matrix.toArray()
      data[property] = value
    }
    const key = JSON.stringify(data)
    cached.set(material, key)
    return key
  }
}

// Texture identity is independent of material tint. Share only immutable image
// sources with identical sampling/UV state, leaving authored materials untouched.
export function createRuntimeMaterialPool() {
  const materials = new Map(), textures = new Map(), owned = []
  const bitmapKeys = new WeakMap(), checkedSources = new WeakMap(), bitmapBuckets = new Map(), encodedBuckets = new Map()
  const stats = {bitmapReads: 0, bitmapReadMs: 0, bitmapSkipped: 0, textureSlots: 0, sharedTextureSlots: 0, encodedReads: 0, encodedFailures: 0, prepareMs: 0}
  let canvas = null, nextBitmap = 0
  function bitmapKey(image, rootPath) {
    if (bitmapKeys.has(image)) return bitmapKeys.get(image)
    const bitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
    const html = typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    if ((!bitmap && !html) || typeof rootPath !== 'string' || image.width * image.height > 4194304) return null
    const begin = performance.now()
    let key = null
    try {
      canvas ??= document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d', {willReadFrequently: true})
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, image.width, image.height).data
      stats.bitmapReads++
      // Canvas premultiplication can discard hidden RGB in transparent pixels.
      // Restrict content sharing to opaque bitmaps where comparison is exact.
      let hash = 2166136261
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) return null
        hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0
        hash = Math.imul(hash ^ pixels[i + 1], 16777619) >>> 0
        hash = Math.imul(hash ^ pixels[i + 2], 16777619) >>> 0
      }
      const bucketKey = `${rootPath}:${image.width}:${image.height}:${hash}`
      const candidates = bitmapBuckets.get(bucketKey) || []
      const match = candidates.find(candidate => pixels.every((value, i) => value === candidate.pixels[i]))
      key = match?.key || `bitmap-${nextBitmap++}`
      if (!match) { candidates.push({key, pixels}); bitmapBuckets.set(bucketKey, candidates) }
      return key
    } catch { return null } finally {
      stats.bitmapReadMs += performance.now() - begin
      if (!key) stats.bitmapSkipped++
      bitmapKeys.set(image, key)
    }
  }
  function imageKey(texture) {
    const image = texture.source?.data
    if (typeof image?.src === 'string' && (!image.src.startsWith('blob:') || (checkedSources.has(image) && checkedSources.get(image) !== image.src))) return image.src
    // Kite's asset resolver gives each import a different blob URL. Verify the
    // actual opaque pixels before sharing copies of the same registered asset.
    const key = bitmapKey(image, texture.userData?.rootPath)
    if (typeof image?.src === 'string' && !checkedSources.has(image)) checkedSources.set(image, image.src)
    return key || image?.src || null
  }
  const keyForMaterial = createMaterialKey(imageKey)
  function textureKey(texture) {
    if (texture.isVideoTexture || texture.isRenderTargetTexture || texture.onUpdate) return null
    const sourceKey = imageKey(texture)
    if (!sourceKey) return null
    const meta = {textures: {}, images: {[texture.source.uuid]: {uuid: texture.source.uuid, url: sourceKey}}}
    const data = texture.toJSON(meta)
    delete data.uuid; delete data.name; delete data.metadata
    data.image = sourceKey
    if (data.userData) { data.userData = {...data.userData}; delete data.userData.uuid }
    data.matrixAutoUpdate = texture.matrixAutoUpdate
    if (!texture.matrixAutoUpdate) data.matrix = texture.matrix.toArray()
    return JSON.stringify(data)
  }
  return {
    stats,
    keyForMaterial,
    async prepare(materialsToPrepare) {
      const images = new Map()
      for (const material of materialsToPrepare) for (const texture of Object.values(material)) {
        if (!texture?.isTexture || texture.isVideoTexture || texture.isRenderTargetTexture || texture.onUpdate) continue
        const image = texture.source?.data, rootPath = texture.userData?.rootPath
        if (typeof image?.src === 'string' && image.src.startsWith('blob:') && typeof rootPath === 'string' && !bitmapKeys.has(image)) images.set(image, rootPath)
      }
      const queue = [...images], begin = performance.now()
      let cursor = 0
      await Promise.all(Array.from({length: Math.min(8, queue.length)}, async () => {
        while (cursor < queue.length) {
          const [image, rootPath] = queue[cursor++]
          const src = image.src
          checkedSources.set(image, src)
          try {
            // These are already loaded local blob URLs, not new network sources.
            // Exact encoded bytes also preserve alpha and hidden RGB without a
            // costly canvas readback or trusting stale loader provenance.
            const response = await fetch(src)
            if (!response.ok) throw new Error('Unavailable image blob')
            const bytes = new Uint8Array(await response.arrayBuffer())
            if (image.src !== src) throw new Error('Image changed during preparation')
            stats.encodedReads++
            let hash = 2166136261
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0
            const bucketKey = `${rootPath}:${bytes.length}:${hash}`
            const candidates = encodedBuckets.get(bucketKey) || []
            const match = candidates.find(candidate => bytes.every((value, i) => value === candidate.bytes[i]))
            const key = match?.key || `encoded-${nextBitmap++}`
            if (!match) { candidates.push({key, bytes}); encodedBuckets.set(bucketKey, candidates) }
            bitmapKeys.set(image, key)
          } catch {
            stats.encodedFailures++
            // A revoked or changed blob remains independent; do not stall load
            // with canvas fallback or merge from rootPath alone.
            bitmapKeys.set(image, null)
          }
        }
      }))
      stats.prepareMs += performance.now() - begin
    },
    get(material) {
      if (material.isShaderMaterial || Object.hasOwn(material, 'onBeforeRender') || Object.hasOwn(material, 'onBeforeCompile') || Object.hasOwn(material, 'customProgramCacheKey') || material.materialExtensions?.length) return material
      const key = keyForMaterial(material)
      if (materials.has(key)) return materials.get(key)
      const clone = material.clone()
      for (const [property, texture] of Object.entries(material)) {
        if (!texture?.isTexture) continue
        stats.textureSlots++
        const textureState = textureKey(texture)
        if (!textureState) continue
        if (!textures.has(textureState)) textures.set(textureState, texture)
        else stats.sharedTextureSlots++
        clone[property] = textures.get(textureState)
      }
      materials.set(key, clone); owned.push(clone)
      return clone
    },
    dispose() {
      // Material.dispose releases programs only. Source textures belong to the
      // editable scene and must survive Stop and subsequent Play sessions.
      for (const material of owned) material.dispose()
      owned.length = 0; materials.clear(); textures.clear(); bitmapBuckets.clear(); encodedBuckets.clear(); canvas = null
    },
  }
}
