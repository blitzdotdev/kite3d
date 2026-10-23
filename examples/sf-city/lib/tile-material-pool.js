import {Source} from 'three'
import {createMaterialKey} from './batch-keys.js'

// Experimental streaming-only ownership. Never install these materials on editor
// objects. Unsupported materials stay source-owned and require the caller's asset
// lease to remain alive. No source material, texture or image is disposed here.
export function createTileMaterialPool() {
  const images = new Map(), textures = new Map(), materials = new Map(), leases = new Set(), prototypes = new WeakMap()
  let serial = 0, stopped = false
  const stats = {blobReads: 0, decodedImages: 0, sourceCacheHits: 0}
  const plain = (value, seen = new Set()) => {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'object' || seen.has(value)) return false
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false
    seen.add(value)
    const valid = Object.values(value).every(item => plain(item, seen))
    seen.delete(value)
    return valid
  }
  const metadata = value => {
    // GLTFLoader2 restores this optional slot even when no extension exists
    // (GLTFLoader2.ts:473-479). It is loader absence, not custom owner state.
    if (value && Object.getPrototypeOf(value) === Object.prototype && Object.hasOwn(value, 'gltfExtensions') && value.gltfExtensions === undefined) {
      const copy = {...value}; delete copy.gltfExtensions
      return plain(copy)
    }
    return plain(value)
  }
  const slots = material => Object.entries(material).filter(([, value]) => value?.isTexture)
  function eligible(material) {
    if (!material?.isMaterial || material.isShaderMaterial || material.materialExtensions?.length || !metadata(material.userData)
      || (material.defines !== undefined && !plain(material.defines)) || Object.keys(material.extraUniformsToUpload || {}).length
      || ['onBeforeRender', 'onBeforeCompile', 'customProgramCacheKey'].some(key => Object.hasOwn(material, key))) return false
    return slots(material).every(([, texture]) => {
      const image = texture.source?.data
      return !texture.isVideoTexture && !texture.isRenderTargetTexture && !texture.onUpdate && !texture.mipmaps?.length
        && metadata(texture.userData) && typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement
        && image.complete && image.naturalWidth > 0 && image.src.startsWith('blob:')
    })
  }
  const equal = (a, b) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  function releaseEntry(entry, collection) {
    if (--entry.refs) return
    collection.delete(entry.key)
    if (entry.value?.isMaterial || entry.value?.isTexture) entry.value.dispose()
    if (entry.url) URL.revokeObjectURL(entry.url)
    entry.bytes = null
    entry.value = null
  }
  return {
    async acquire(input) {
      if (stopped) throw new Error('Tile material pool is stopped')
      const imageCache = new WeakMap()
      const heldImages = new Set(), heldTextures = new Set(), heldMaterials = new Set(), mapped = new Map()
      let released = false
      const retain = (entry, held) => { if (!held.has(entry)) { held.add(entry); entry.refs++ } return entry }
      const lease = {
        materialFor(source) {
          if (released || !mapped.has(source)) throw new Error('Material is outside the active tile lease')
          return mapped.get(source)
        },
        release() {
          if (released) return
          released = true; leases.delete(lease)
          for (const entry of heldMaterials) releaseEntry(entry, materials)
          for (const entry of heldTextures) releaseEntry(entry, textures)
          for (const entry of heldImages) releaseEntry(entry, images)
          heldMaterials.clear(); heldTextures.clear(); heldImages.clear(); mapped.clear()
        },
      }
      leases.add(lease)
      const alive = () => { if (released || stopped) throw new Error('Tile material acquisition cancelled') }
      async function loadImage(texture) {
        const source = texture.source, image = source.data, src = image.src, version = texture.version
        const response = await fetch(src)
        if (!response.ok) throw new Error('Tile image blob is unavailable')
        const bytes = new Uint8Array(await response.arrayBuffer())
        stats.blobReads++
        alive()
        if (texture.source !== source || source.data !== image || image.src !== src || texture.version !== version) throw new Error('Tile image changed during acquisition')
        let hash = 2166136261
        for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0
        const content = `${response.headers.get('content-type') || ''}:${image.naturalWidth}:${image.naturalHeight}:${bytes.length}:${hash}`
        let entry = [...images.values()].find(candidate => candidate.content === content && equal(candidate.bytes, bytes))
        if (!entry) {
          entry = {key: `image-${serial++}`, content, bytes, refs: 0, value: null, url: null}
          images.set(entry.key, entry)
          entry.url = URL.createObjectURL(new Blob([bytes], {type: response.headers.get('content-type') || 'application/octet-stream'}))
          stats.decodedImages++
          const owned = new Image()
          owned.src = entry.url
          entry.ready = owned.decode().then(() => { entry.value = owned; return owned })
        }
        retain(entry, heldImages)
        await entry.ready
        alive()
        if (texture.source !== source || source.data !== image || image.src !== src || texture.version !== version) throw new Error('Tile image changed during decode')
        return entry
      }
      async function ownImage(texture) {
        const image = texture.source.data, source = texture.source, src = image.src, version = texture.version
        let cached = imageCache.get(image)
        if (!cached || cached.src !== src) {
          cached = {image, source, src, version, promise: loadImage(texture)}
          imageCache.set(image, cached)
        } else stats.sourceCacheHits++
        const result = await cached.promise
        alive()
        if (texture.source !== source || source.data !== image || image.src !== src || texture.version !== version) throw new Error('Cached tile image changed during acquisition')
        return result
      }
      try {
        for (const source of new Set(input)) {
          alive()
          if (!eligible(source)) { mapped.set(source, source); continue }
          const sourceSlots = slots(source), identities = new Map()
          for (const [, texture] of sourceSlots) identities.set(texture, await ownImage(texture))
          const prototype = Object.getPrototypeOf(source)
          if (!prototypes.has(prototype)) prototypes.set(prototype, serial++)
          const key = `${prototypes.get(prototype)}:${JSON.stringify(source.defines ?? null)}:${createMaterialKey(texture => identities.get(texture)?.key)(source)}`
          let material = materials.get(key)
          if (material) {
            // Retain the resources actually referenced by the reused material,
            // not newly computed equivalents that may have different lifetimes.
            for (const entry of material.textures) {
              retain(entry, heldTextures); retain(entry.image, heldImages)
            }
            retain(material, heldMaterials); mapped.set(source, material.value)
            continue
          }
          // Keep each lease's dependencies alive even when the material itself
          // was first created by another tile.
          const replacements = new Map(), dependencies = new Set()
          for (const [slot, texture] of sourceSlots) {
            const image = identities.get(texture)
            const meta = {textures: {}, images: {[texture.source.uuid]: {uuid: texture.source.uuid, url: image.key}}}
            const state = texture.toJSON(meta)
            delete state.uuid; delete state.name; delete state.metadata
            if (state.userData) { state.userData = {...state.userData}; delete state.userData.uuid }
            state.image = image.key; state.matrixAutoUpdate = texture.matrixAutoUpdate
            if (!texture.matrixAutoUpdate) state.matrix = texture.matrix.toArray()
            const textureKey = JSON.stringify(state)
            let entry = textures.get(textureKey)
            if (!entry) {
              const value = texture.clone()
              value.source = new Source(image.value)
              value.needsUpdate = true
              entry = {key: textureKey, value, image, refs: 0}; textures.set(textureKey, entry)
            }
            retain(entry, heldTextures); dependencies.add(entry); replacements.set(slot, entry.value)
          }
          if (!material) {
            const value = source.clone()
            if (Object.hasOwn(source, 'defines')) value.defines = source.defines === undefined ? undefined : structuredClone(source.defines)
            for (const [slot, texture] of replacements) value[slot] = texture
            material = {key, value, textures: dependencies, refs: 0}; materials.set(key, material)
          }
          retain(material, heldMaterials); mapped.set(source, material.value)
        }
        return lease
      } catch (error) { lease.release(); throw error }
    },
    stats,
    dispose() { stopped = true; for (const lease of [...leases]) lease.release() },
    get state() { return {leases: leases.size, images: images.size, textures: textures.size, materials: materials.size} },
  }
}
