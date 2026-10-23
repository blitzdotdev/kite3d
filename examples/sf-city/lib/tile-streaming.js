import {Group} from 'three'

// Metre thresholds for the isolated LOD prototype. The caller retains the last
// level; a camera moving inside the deadband must not enqueue another import.
export function treeDetailAtDistance(distance, previous = null, near = 100, far = 220, hysteresis = 12) {
  if (![distance, near, far, hysteresis].every(Number.isFinite) || distance < 0 || hysteresis < 0
    || near <= hysteresis || far - near <= 2 * hysteresis) throw new Error('Invalid tree LOD distance/thresholds')
  if (previous === 'near' && distance <= near + hysteresis) return 'near'
  if (previous === 'far' && distance >= far - hysteresis) return 'far'
  if (previous === 'mid' && distance >= near - hysteresis && distance <= far + hysteresis) return 'mid'
  return distance < near - (previous ? hysteresis : 0) ? 'near' : distance > far + (previous ? hysteresis : 0) ? 'far' : 'mid'
}

// EXPERIMENTAL, not integrated or included by scene/export.mjs.
// Runtime only: authored objects and unassigned features stay owned by the caller.
// Costs are conservative stored bytes/triangles, not decoded GPU-memory estimates.
export function createTileStreaming(manifest, adapter, options = {}) {
  const {pinnedCost = {triangles: 0, bytes: 0, drawCalls: 0}, detailForTile, activeBudget = {}, ...budgetOptions} = options
  if (detailForTile !== undefined && typeof detailForTile !== 'function') throw new Error('Invalid detail selector')
  const limits = {nearRadius: 220, retainRadius: 350, maxNearTiles: 9,
    maxResidentTiles: 12, maxTriangles: 1500000, maxBytes: 128 * 1024 * 1024,
    maxDrawCalls: Number.MAX_SAFE_INTEGER, ...budgetOptions}
  for (const key of Object.keys(limits)) {
    if (!Number.isFinite(limits[key]) || limits[key] < 0) throw new Error(`Invalid tile limit: ${key}`)
  }
  const activeLimits = {...limits, ...activeBudget}
  for (const [key, value] of Object.entries(activeBudget)) {
    if (!['maxResidentTiles', 'maxTriangles', 'maxBytes', 'maxDrawCalls'].includes(key)
      || !Number.isFinite(value) || value < 0 || value > limits[key]) throw new Error(`Invalid active budget: ${key}`)
  }
  for (const [key, limit] of [['triangles', 'maxTriangles'], ['bytes', 'maxBytes'], ['drawCalls', 'maxDrawCalls']]) {
    if (!Number.isFinite(pinnedCost[key]) || pinnedCost[key] < 0) throw new Error(`Invalid pinned cost: ${key}`)
    if (pinnedCost[key] > activeLimits[limit]) throw new Error(`Pinned ${key} exceeds ${limit}`)
  }
  const drawCost = tile => tile.conservativeDrawCalls ?? (limits.maxDrawCalls === Number.MAX_SAFE_INTEGER ? 0 : NaN)
  const tiles = Object.entries(manifest.tiles).filter(([id, tile]) => id !== 'unassigned' && tile.geometryBounds)
  function validateCost(id, tile) {
    if (![drawCost(tile), tile.triangles, tile.coldDependencyBytes].every(Number.isFinite)
      || drawCost(tile) < 0 || tile.triangles < 0 || tile.coldDependencyBytes < 0) throw new Error(`Invalid tile cost: ${id}`)
  }
  for (const [id, tile] of tiles) {
    if (![...tile.geometryBounds.min, ...tile.geometryBounds.max].every(Number.isFinite)) throw new Error(`Invalid tile bounds: ${id}`)
    validateCost(id, tile)
    for (const [detail, cost] of Object.entries(tile.details ?? {})) validateCost(`${id}/${detail}`, cost)
  }
  // Reservations include detached incoming LODs and cancelled imports until
  // cleanup finishes. Estimates bound source costs/pass submissions, not VRAM.
  const reservations = new Map(), active = new Map(), pending = new Map(), failed = new Map()
  let desired = new Map(), blocked = {}, waiting = {}, running = 0, stopped = false
  const usage = () => {
    const result = {...pinnedCost, tiles: reservations.size}
    for (const tile of reservations.values()) {
      result.triangles += tile.triangles; result.bytes += tile.coldDependencyBytes; result.drawCalls += drawCost(tile)
    }
    return result
  }
  const activeUsage = (exceptId) => {
    const result = {...pinnedCost, tiles: 0}
    for (const [id, entry] of active) if (id !== exceptId) {
      const tile = reservations.get(entry)
      result.tiles++; result.triangles += tile.triangles; result.bytes += tile.coldDependencyBytes; result.drawCalls += drawCost(tile)
    }
    return result
  }
  const reasonsFor = (used, tile, ceiling = limits) => {
    const reasons = []
    if (used.tiles >= ceiling.maxResidentTiles) reasons.push('resident-count')
    if (used.triangles + tile.triangles > ceiling.maxTriangles) reasons.push('stored-triangles')
    if (used.bytes + tile.coldDependencyBytes > ceiling.maxBytes) reasons.push('stored-bytes')
    if (used.drawCalls + drawCost(tile) > ceiling.maxDrawCalls) reasons.push('draw-pass-estimate')
    return reasons
  }
  const distance = (tile, p) => {
    const {min, max} = tile.geometryBounds
    return Math.hypot(Math.max(min[0] - p.x, 0, p.x - max[0]), Math.max(min[2] - p.z, 0, p.z - max[2]))
  }
  function release(entry) {
    entry.abort.abort()
    if (entry.handle) {
      adapter.detach(entry.handle); adapter.release(entry.handle); entry.handle = null
      reservations.delete(entry)
    }
  }
  function pump() {
    if (stopped) return
    waiting = {}
    for (const [id, tile] of desired) {
      if (pending.has(id) || failed.has(id) || active.get(id)?.detail === tile.detail) continue
      if (active.has(id) && [...pending.keys()].some(key => active.has(key))) {
        waiting[id] = ['replacement-concurrency']; continue
      }
      const reasons = reasonsFor(usage(), tile)
      if (reasons.length) { waiting[id] = reasons; continue }
      if (running >= 2) { waiting[id] = ['load-concurrency']; continue }
      const entry = {abort: new AbortController(), detail: tile.detail, handle: null}
      pending.set(id, entry); reservations.set(entry, tile); running++
      Promise.resolve().then(() => adapter.load(id, tile, entry.abort.signal)).then(handle => {
        if (stopped || pending.get(id) !== entry || desired.get(id)?.detail !== entry.detail) {
          adapter.release(handle); return
        }
        entry.handle = handle
        const activeReasons = reasonsFor(activeUsage(id), tile, activeLimits)
        if (activeReasons.length) throw new Error(`Active tile admission failed: ${activeReasons.join(', ')}`)
        adapter.attach(handle)
        // No frame is rendered between attach and old removal. Keep the old LOD
        // on a failed/cancelled load; never dispose it just to make a gap.
        const old = active.get(id)
        if (old) release(old)
        active.set(id, entry)
      }).catch(error => {
        if (pending.get(id) === entry) {
          release(entry)
          failed.set(id, error)
        }
      }).finally(() => {
        if (pending.get(id) === entry) pending.delete(id)
        if (!entry.handle) reservations.delete(entry)
        running--; pump()
      })
    }
  }
  return {
    update(position) {
      if (stopped) return
      if (![position.x, position.z].every(Number.isFinite)) throw new Error('Tile camera must use finite world coordinates')
      const ranked = tiles.map(([id, tile]) => ({id, tile, distance: distance(tile, position)}))
        .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      const near = ranked.filter(t => t.distance <= limits.nearRadius).slice(0, limits.maxNearTiles)
      const keep = ranked.filter(t => (active.has(t.id) || pending.has(t.id)) && t.distance <= limits.retainRadius && !near.includes(t))
      const next = new Map(); blocked = {}
      const used = {...pinnedCost, tiles: 0}
      for (const {id, tile, distance: d} of [...near, ...keep]) {
        const previous = pending.get(id)?.detail ?? active.get(id)?.detail
        const detail = detailForTile?.(id, tile, d, previous) ?? 'near'
        if (!['near', 'mid', 'far'].includes(detail)) throw new Error(`Unsupported tile detail: ${detail}`)
        let selected
        if (detail !== 'near' && !tile.details?.[detail]) {
          blocked[id] = ['unmeasured-detail']
          const old = active.get(id)
          if (!old) continue
          selected = reservations.get(old) // Keep the attested visible LOD.
        } else selected = {...tile, ...(tile.details?.[detail] ?? {}), detail, featureIds: tile.featureIds}
        const reasons = reasonsFor(used, selected, activeLimits)
        if (reasons.length) { blocked[id] = reasons; continue }
        next.set(id, selected); used.tiles++; used.triangles += selected.triangles
        used.bytes += selected.coldDependencyBytes; used.drawCalls += drawCost(selected)
      }
      for (const [id, tile] of next) if (desired.get(id)?.detail !== tile.detail) failed.delete(id)
      desired = next
      for (const [id, entry] of pending) if (desired.get(id)?.detail !== entry.detail) {
        pending.delete(id); release(entry)
      }
      for (const [id, entry] of active) if (!desired.has(id)) { active.delete(id); release(entry) }
      pump()
    },
    retry(id) { failed.delete(id); pump() },
    stop() {
      stopped = true; desired.clear(); blocked = {}; waiting = {}
      for (const entry of pending.values()) release(entry)
      for (const entry of active.values()) release(entry)
      pending.clear(); active.clear(); failed.clear()
    },
    get state() {
      return {running, blocked: {...blocked}, waiting: Object.keys(waiting), waitingReasons: {...waiting}, reserved: usage(), activeCost: activeUsage(),
        resident: [...active.keys()], details: Object.fromEntries([...active].map(([id, e]) => [id, e.detail])),
        desired: [...desired.keys()], errors: Object.fromEntries([...failed].map(([id, error]) => [id, String(error)]))}
    },
  }
}

// Kite's nestedAssets loader uses importer.importSingle and awaits _loadingPromise.
// Use that import-only API, never viewer.load (which attaches while loading).
// createGame installs createProjectAssetURLModifier(base, publicAssetsJSON), which
// resolves /kite3d/@id/file including nested buffers/textures. A plain viewer does
// not install that modifier. resolveAsset must verify its complete URL mapping;
// resolving only the top-level glTF to a physical URL is not sufficient.
// validateFeature must inspect current source glTF AND authored ancestor/child
// overrides before import: reject components, animations, skins, morph targets,
// nested references and overrides absent from the candidate manifest. Post-import
// rejection alone is unsafe because importer plugins can instantiate components.
// Return exactly true only for verified static features; the inspection-only
// manifest does not establish eligibility. This module never strips user edits.
// One adapter per Play session. Sources are private uncached imports; do not pass
// editor-owned models to this pool or dispose resources through cloned objects.
export function createKiteTileAdapter(viewer, manifest, runtimeRoot, {resolveAsset, validateFeature, selectFeature, materialPool, batch = false, batchCellSize = 64} = {}) {
  if (typeof resolveAsset !== 'function' || typeof validateFeature !== 'function') {
    throw new Error('Experimental tile adapter requires an asset URL resolver and static-feature preflight')
  }
  function identityRoot() {
    runtimeRoot.updateWorldMatrix(true, false)
    if (runtimeRoot.matrixWorld.elements.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-10)) {
      throw new Error('Tile runtime root must retain identity world transform')
    }
  }
  identityRoot()
  if (!Number.isFinite(batchCellSize) || batchCellSize < 0) throw new Error('Invalid batch cell size')
  const sources = new Map(), resources = new Map()
  const features = new Map(manifest.features.map(feature => [feature.id, feature]))
  function resourceSet(object) {
    const set = new Set()
    object.traverse(node => {
      if (node.geometry) set.add(node.geometry)
      for (const material of [node.material].flat().filter(Boolean)) {
        set.add(material)
        for (const value of Object.values(material)) if (value?.isTexture) set.add(value)
      }
    })
    return set
  }
  async function acquire(key, path) {
    let entry = sources.get(key)
    if (!entry) {
      entry = {refs: 0, object: null, resources: null}
      entry.promise = viewer.assetManager.importer.importSingle(path, {cacheAsset: false, forceImport: true}).then(async object => {
        if (!object?.isObject3D) throw new Error(`Tile asset is not a model: ${key}`)
        entry.object = object
        if (object._loadingPromise) await object._loadingPromise
        object.traverse(node => {
          if (node.isSkinnedMesh || node.animations?.length || node.morphTargetInfluences?.length
            || Object.keys(node.userData?.EntityComponentPlugin ?? {}).length) {
            throw new Error(`Unsupported dynamic tile asset: ${key}`)
          }
        })
        return object
      }).finally(() => {
        if (entry.object) {
          entry.resources = resourceSet(entry.object)
          for (const resource of entry.resources) resources.set(resource, (resources.get(resource) ?? 0) + 1)
        }
      })
      sources.set(key, entry)
    }
    entry.refs++
    try { return await entry.promise } catch (error) { relinquish(key); throw error }
  }
  function relinquish(key) {
    const entry = sources.get(key)
    if (!entry || --entry.refs > 0) return
    sources.delete(key)
    for (const resource of entry.resources ?? []) {
      const refs = resources.get(resource) - 1
      if (refs) resources.set(resource, refs)
      else { resources.delete(resource); resource.dispose() }
    }
    entry.object = null
  }
  function release(handle) {
    if (handle.released) return
    handle.released = true
    handle.root.removeFromParent()
    // Upgraded Mesh2 dispose listeners can cascade into material/geometry disposal.
    // Detach runtime references first; source leases and the pool own resources.
    handle.root.traverse(node => {
      if (node.isMesh) { node.material = undefined; node.geometry = undefined }
    })
    for (const instance of handle.instances ?? []) instance.dispose()
    for (const geometry of handle.ownedGeometry ?? []) geometry.dispose()
    handle.root.clear()
    handle.materialLease?.release()
    for (const key of handle.keys) relinquish(key)
    handle.keys.clear()
  }
  return {
    async load(id, tile, signal) {
      const handle = {root: new Group(), keys: new Set(), released: false, instances: [], ownedGeometry: []}
      handle.root.name = `Runtime tile ${id}`
      handle.root.userData.excludeFromExport = true
      const templates = new Map()
      try {
        const approved = []
        for (const featureId of tile.featureIds) {
          if (signal.aborted) throw new Error('Tile load cancelled')
          let feature = features.get(featureId)
          if (!feature) throw new Error(`Missing tile feature: ${featureId}`)
          if (!feature.visible) continue
          if (tile.detail) {
            if (!selectFeature) throw new Error('Tile LOD selection requires verified candidate metadata')
            feature = await selectFeature(feature, tile.detail)
          }
          if (feature.worldMatrix?.length !== 16 || !feature.worldMatrix.every(Number.isFinite)) throw new Error(`Invalid feature transform: ${featureId}`)
          if (await validateFeature(feature, manifest) !== true) throw new Error(`Tile feature is not verified static: ${featureId}`)
          const path = await resolveAsset(feature, manifest)
          if (typeof path !== 'string' || !path) throw new Error(`Unresolved tile asset: ${featureId}`)
          approved.push({feature, path})
        }
        for (const {feature, path} of approved) {
          if (signal.aborted) throw new Error('Tile load cancelled')
          if (!templates.has(feature.asset)) {
            const object = await acquire(feature.asset, path)
            handle.keys.add(feature.asset); templates.set(feature.asset, object)
          }
          if (signal.aborted) throw new Error('Tile load cancelled')
          const placement = new Group()
          placement.name = feature.name || feature.id
          placement.userData.cityId = feature.id
          placement.matrixAutoUpdate = false
          placement.matrix.fromArray(feature.worldMatrix)
          placement.add(templates.get(feature.asset).clone(true))
          handle.root.add(placement)
        }
        if (materialPool) {
          const materials = new Set()
          handle.root.traverse(node => [node.material].flat().filter(Boolean).forEach(m => materials.add(m)))
          handle.materialLease = await materialPool.acquire(materials)
          handle.root.traverse(node => {
            if (node.material) node.material = Array.isArray(node.material)
              ? node.material.map(m => handle.materialLease.materialFor(m)) : handle.materialLease.materialFor(node.material)
          })
        }
        if (signal.aborted) throw new Error('Tile load cancelled')
        if (batch) {
          const toolkit = await import('threepipe')
          if (signal.aborted) throw new Error('Tile load cancelled')
          batchTile(handle, toolkit, batchCellSize)
        }
        // Pinned r163 shared shadow-depth uniforms retain an old color sampler
        // when the next opaque caster has no map. After a tile unload that stale
        // sampler can re-upload a disposed texture. Clear only absent built-in
        // sampler values at the supported shadow callback, not global resources.
        handle.root.traverse(node => {
          if (!node.isMesh || node.customDepthMaterial || node.customDistanceMaterial) return
          const previous = node.onBeforeShadow
          node.onBeforeShadow = function(...args) {
            previous?.apply(this, args)
            const [renderer, , , , , depth] = args
            if (this.customDepthMaterial || this.customDistanceMaterial
              || !(depth?.isMeshDepthMaterial || depth?.isMeshDistanceMaterial)) return
            const uniforms = renderer.properties?.get(depth)?.uniforms
            if (!depth.map && uniforms?.map) uniforms.map.value = null
          }
        })
        return handle
      } catch (error) { release(handle); throw error }
    },
    attach(handle) { identityRoot(); runtimeRoot.add(handle.root); viewer.setDirty() },
    detach(handle) { handle.root.removeFromParent(); viewer.setDirty() },
    release,
    get state() { return {sources: sources.size, resources: resources.size} },
  }
}

// Tile-owned batches retain their source leases and individual semantic wrappers.
// Only opaque static leaf meshes are batched. Mirrored transforms, transparency,
// geometry groups and partial draw ranges retain their original rendering path.
function batchTile(handle, {Mesh2, InstancedMesh2, mergeGeometries}, cellSize) {
  handle.root.updateMatrixWorld(true)
  const instances = new Map(), surfaces = new Map()
  for (const placement of handle.root.children) placement.traverseVisible(mesh => {
    if (!mesh.isMesh || mesh.children.length || mesh.isInstancedMesh || Array.isArray(mesh.material)
      || mesh.material.transparent || mesh.material.transmission > 0 || mesh.matrixWorld.determinant() <= 0
      || mesh.geometry.groups.length || mesh.geometry.drawRange.start !== 0 || mesh.geometry.drawRange.count !== Infinity) return
    // Bound grouping by world-space centroid cells as well as tile ownership.
    // A single source mesh crossing cells remains intact; this is not clipping.
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const center = mesh.geometry.boundingBox.getCenter(mesh.position.clone()).applyMatrix4(mesh.matrixWorld)
    const cell = cellSize ? `${Math.floor(center.x / cellSize)},${Math.floor(center.z / cellSize)}` : 'tile'
    const state = `${cell}:${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.renderOrder}:${mesh.layers.mask}`
    const key = `${state}:${mesh.geometry.uuid}`
    if (!instances.has(key)) instances.set(key, [])
    instances.get(key).push({mesh, id: placement.userData.cityId, state})
  })
  const flags = (target, source) => {
    target.castShadow = source.castShadow; target.receiveShadow = source.receiveShadow
    target.renderOrder = source.renderOrder; target.layers.mask = source.layers.mask
  }
  const orthogonal = matrix => {
    const e = matrix.elements
    for (const [a, b] of [[0, 4], [0, 8], [4, 8]]) {
      const dot = e[a] * e[b] + e[a + 1] * e[b + 1] + e[a + 2] * e[b + 2]
      const lengths = Math.hypot(e[a], e[a + 1], e[a + 2]) * Math.hypot(e[b], e[b + 1], e[b + 2])
      if (lengths === 0 || Math.abs(dot) > lengths * 1e-7) return false
    }
    return true
  }
  for (const entries of instances.values()) {
    const first = entries[0].mesh
    // Pinned r163 instance-normal transformation supports orthogonal TRS, not
    // shear from nonuniform parent scale followed by a rotated child.
    if (entries.length > 1 && entries.every(e => orthogonal(e.mesh.matrixWorld))) {
      const mesh = new InstancedMesh2(first.geometry, first.material, entries.length)
      handle.instances.push(mesh)
      entries.forEach(({mesh: source}, i) => mesh.setMatrixAt(i, source.matrixWorld))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); flags(mesh, first)
      mesh.userData.cityInstances = entries.map(e => e.id)
      handle.root.add(mesh)
      entries.forEach(e => { e.mesh.visible = false })
    } else {
      for (const entry of entries) {
        const signature = Object.entries(entry.mesh.geometry.attributes).map(([name, attribute]) =>
          `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).sort().join('|')
        const key = `${entry.state}:${signature}`
        if (!surfaces.has(key)) surfaces.set(key, [])
        surfaces.get(key).push(entry)
      }
    }
  }
  for (const entries of surfaces.values()) {
    if (entries.length < 2) continue
    const temporary = [], ranges = []
    let offset = 0
    try {
      for (const {mesh, id} of entries) {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
        temporary.push(geometry); geometry.applyMatrix4(mesh.matrixWorld)
        ranges.push({id, start: offset, count: geometry.attributes.position.count / 3})
        offset += geometry.attributes.position.count / 3
      }
      const geometry = mergeGeometries(temporary, false)
      if (!geometry) throw new Error('Incompatible static tile geometry')
      handle.ownedGeometry.push(geometry)
      const mesh = new Mesh2(geometry, entries[0].mesh.material)
      flags(mesh, entries[0].mesh); mesh.userData.cityRanges = ranges
      handle.root.add(mesh)
      entries.forEach(e => { e.mesh.visible = false })
    } finally { temporary.forEach(g => g.dispose()) }
  }
}
