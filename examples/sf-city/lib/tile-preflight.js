// Experimental immutable-snapshot preflight. Not included in the demo export.
// Serve these bytes from a frozen snapshot: hashes verified here do not prevent a
// mutable server changing an asset between verification and importer download.
export async function createStaticTilePreflight(manifest, base, importer, fetchFile = fetch) {
  const origin = new URL(base), documents = new Map(), checks = new Map()
  const dependencyUses = new Map(), verifiedShared = new Map()
  let disposed = false
  for (const asset of Object.values(manifest.assets)) for (const path of new Set(asset.dependencies)) {
    dependencyUses.set(path, (dependencyUses.get(path) ?? 0) + 1)
  }
  const urlFor = path => {
    if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Invalid project path: ${path}`)
    const url = new URL(path, origin)
    if (!url.href.startsWith(origin.href)) throw new Error(`Asset outside snapshot: ${path}`)
    return url.href
  }
  async function checked(path, expected) {
    if (disposed) throw new Error('Snapshot preflight disposed')
    if (!expected) throw new Error(`Missing snapshot hash: ${path}`)
    // A frozen snapshot may share the same texture across hundreds of asset
    // closures. Coalesce only those dependencies, never unique geometry buffers
    // or source documents. Different expected hashes cannot reuse verification.
    if ((dependencyUses.get(path) ?? 0) > 1) {
      const key = JSON.stringify([path, expected])
      if (!verifiedShared.has(key)) {
        const pending = fetchChecked(path, expected).catch(error => {
          if (verifiedShared.get(key) === pending) verifiedShared.delete(key)
          throw error
        })
        verifiedShared.set(key, pending)
      }
      return verifiedShared.get(key)
    }
    return fetchChecked(path, expected)
  }
  async function fetchChecked(path, expected) {
    const response = await fetchFile(urlFor(path))
    if (!response.ok) throw new Error(`Snapshot fetch failed: ${path} (${response.status})`)
    const bytes = await response.arrayBuffer()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
    if (hash !== expected) throw new Error(`Snapshot changed: ${path}`)
    if (disposed) throw new Error('Snapshot preflight disposed')
    return bytes
  }
  for (const path of ['assets.json', 'assets/main.scene.gltf', 'scene/generated.json', 'scene/overrides.json']) {
    documents.set(path, JSON.parse(new TextDecoder().decode(await checked(path, manifest.sourceHashes[path]))))
  }
  const registry = documents.get('assets.json'), scene = documents.get('assets/main.scene.gltf')
  const generated = new Map(documents.get('scene/generated.json').placements.map(p => [p.id, p]))
  const parents = new Map()
  for (const [index, node] of scene.nodes.entries()) for (const child of node.children ?? []) {
    if (parents.has(child)) throw new Error('Scene has multiple parents')
    parents.set(child, index)
  }
  const extras = new Set(['city', 'cityGenerated', 'cityId', 'gltfUUID', 'rootPath', 'rootPathOptions', 'sProperties', 'visible'])
  const assetExtras = new Set(['name', 'detail', 'cityId', 'heightSource', 'cityBakedAsset', 'cityBakedPart', 'elevationSource',
    'photoFacade', 'provenance', 'sourceObjectID', 'author', 'license', 'source', 'title', 'attribution'])
  function staticNode(node, reference = false) {
    if (!node || node.skin !== undefined || node.weights || Object.keys(node.extensions ?? {}).length) return false
    if (node.extras?.visible === false || node.extras?.EntityComponentPlugin || node.extras?.rootPathOptions && Object.keys(node.extras.rootPathOptions).length) return false
    if (reference && (node.children?.length || Object.keys(node.extras ?? {}).some(k => !extras.has(k)))) return false
    if (!reference && node.extras?.rootPath) return false
    return true
  }
  function resolveURL(url) {
    if (!url.startsWith('/kite3d/')) return url
    const match = /^\/kite3d\/@([^/]+)\/(.+)$/.exec(url)
    if (!match) {
      // Baked glTF also uses project-absolute texture/buffer URIs. Permit only
      // dependencies in the hashed snapshot, not arbitrary project files.
      const path = url.slice('/kite3d/'.length)
      if (!manifest.dependencies[path]) throw new Error(`Unregistered virtual URL: ${url}`)
      return urlFor(path)
    }
    const path = registry.files[match[1]]?.files?.[match[2]]
    if (!path) throw new Error(`Missing public registry mapping: ${url}`)
    return urlFor(path)
  }
  async function validate(feature, ownershipMode) {
    if (disposed) throw new Error('Snapshot preflight disposed')
    const placement = generated.get(feature.id), node = scene.nodes[feature.nodeIndex], asset = manifest.assets[feature.asset]
    if (!placement || ownershipMode === 'generated' && !placement.baked
      || !placement.tile || placement.tile !== feature.ownerTile || placement.asset !== asset?.path
      || node?.extras?.cityId !== feature.id || node.extras.rootPath !== feature.rootPath
      || node.extras.cityGenerated?.rootPath !== feature.rootPath || !staticNode(node, true)) return false
    if (scene.animations?.length || scene.skins?.length || node.mesh !== undefined) return false
    const visited = new Set([feature.nodeIndex])
    for (let parent = parents.get(feature.nodeIndex); parent !== undefined; parent = parents.get(parent)) {
      if (visited.has(parent) || !staticNode(scene.nodes[parent])) return false
      visited.add(parent)
    }
    if (resolveURL(feature.rootPath) !== urlFor(asset.path)) return false
    return validateAsset(feature.asset)
  }
  async function validateAsset(key) {
    const asset = manifest.assets[key]
    if (!asset) return false
    if (!checks.has(key)) checks.set(key, (async () => {
      let gltf
      for (const path of asset.dependencies) {
        const bytes = await checked(path, manifest.dependencies[path]?.sha256)
        if (path === asset.path) gltf = JSON.parse(new TextDecoder().decode(bytes))
      }
      // Generated static kit only. Unknown extensions fail closed, including plugin
      // extras that could execute during import. Do not sanitize authored content.
      if (!gltf || gltf.animations?.length || gltf.skins?.length || gltf.extensionsUsed?.length) return false
      if (!gltf.nodes?.some(n => n.extras?.cityBakedAsset === asset.path)
        || gltf.nodes.some(n => n.mesh !== undefined && n.extras?.cityBakedPart !== true)) return false
      const unsafe = value => {
        if (!value || typeof value !== 'object') return false
        if (value.EntityComponentPlugin || value.rootPath || value.skin !== undefined || value.weights || value.targets
          || value.extensions && Object.keys(value.extensions).length
          || Object.keys(value.extras ?? {}).some(k => !assetExtras.has(k))) return true
        return Object.values(value).some(unsafe)
      }
      return !unsafe(gltf)
    })().catch(error => { checks.delete(key); throw error }))
    return checks.get(key)
  }
  const lodSelections = new WeakSet()
  let lodDocument, buildingDocument
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const matchesDependencies = (asset, hashes) => asset.dependencies.length === Object.keys(hashes ?? {}).length
    && asset.dependencies.every(path => hashes[path] === manifest.dependencies[path]?.sha256)
  async function buildingLodDocument() {
    if (buildingDocument) return buildingDocument
    const config = manifest.buildingLod
    if (config?.mode !== 'trim-only' || !config.path) throw new Error('Unsupported building LOD mode')
    const document = JSON.parse(new TextDecoder().decode(await checked(config.path, manifest.sourceHashes[config.path])))
    if (document.preparationMode !== 'trim-only') throw new Error('Building LOD is not trim-only')
    const required = ['assets.json', 'assets/main.scene.gltf', 'scene/generated.json', 'scene/overrides.json', 'scene/coverage/runtime-candidate.json']
    for (const path of required) {
      const expected = document.sourceContext?.[path]
      if (!expected || expected !== manifest.originalSourceHashes?.[path]) throw new Error(`Building source context differs: ${path}`)
      if (path === 'assets.json') {
        const original = JSON.parse(new TextDecoder().decode(await checked(manifest.originalRegistryPath, expected)))
        // Current registry may add variants, but cannot redirect or remove any
        // original reference, including authored assets excluded from streaming.
        const retained = {...registry, files: Object.fromEntries(Object.keys(original.files).map(key => [key, registry.files[key]]))}
        if (!same(retained, original)) throw new Error('Original registry references changed')
      } else {
        if (manifest.sourceHashes[path] !== expected) throw new Error(`Rewritten building source: ${path}`)
        await checked(path, expected)
      }
    }
    buildingDocument = document
    return document
  }
  async function selectBuilding(feature) {
    const document = await buildingLodDocument(), near = manifest.assets[feature.asset]
    const entry = document.entries.find(entry => entry.id === feature.id)
    if (!entry) return feature // Deliberate source exclusions retain their near asset.
    if (entry.preparationMode !== 'trim-only' || entry.detail !== 'far' || entry.nearAsset !== near.path
      || entry.ownerTile !== feature.ownerTile || !same(entry.worldMatrix, feature.worldMatrix)
      || !matchesDependencies(near, entry.nearDependencies)) throw new Error(`Building near attestation differs: ${feature.id}`)
    const key = Object.keys(manifest.assets).find(key => manifest.assets[key].path === entry.path)
    if (!key || !matchesDependencies(manifest.assets[key], entry.farDependencies) || !await validateAsset(key)) {
      throw new Error(`Unverified building variant: ${feature.id}`)
    }
    const selected = {...feature, asset: key, rootPath: `/kite3d/@${key}/f.gltf`}
    if (resolveURL(selected.rootPath) !== urlFor(entry.path)) throw new Error('Building LOD registry mismatch')
    lodSelections.add(selected)
    return selected
  }
  async function selectFeature(feature, detail) {
    if (disposed) throw new Error('Snapshot preflight disposed')
    if (!detail || detail === 'near') return feature
    if (!['mid', 'far'].includes(detail) || !await validate(feature, 'generated')) throw new Error('LOD requires an eligible generated placement')
    // Mixed groups retain their original assets unless an attested generated
    // broadleaf or explicitly opted-in trim building variant applies.
    const near = manifest.assets[feature.asset]
    if (detail === 'far' && manifest.buildingLod && near.path.startsWith('assets/models/city/buildings/')) return selectBuilding(feature)
    if (!/^assets\/models\/city\/trees\/broadleaf(?:-[12])?\/f\.gltf$/.test(near.path)) return feature
    const path = 'assets/models/city/trees/lod-manifest.json'
    lodDocument ??= JSON.parse(new TextDecoder().decode(await checked(path, manifest.sourceHashes[path])))
    const entry = lodDocument.entries.find(e => e.nearAsset === near.path && e.detail === detail)
    if (!entry || near.dependencies.length !== Object.keys(entry.nearDependencies ?? {}).length
      || !near.dependencies.every(p => entry.nearDependencies[p] === manifest.dependencies[p]?.sha256)) {
      throw new Error(`LOD near dependencies differ: ${feature.id}`)
    }
    const key = Object.keys(manifest.assets).find(k => manifest.assets[k].path === entry.path)
    if (!key || !await validateAsset(key)) throw new Error(`Unverified LOD asset: ${feature.id}`)
    const selected = {...feature, asset: key, rootPath: `/kite3d/@${key}/f.gltf`}
    if (resolveURL(selected.rootPath) !== urlFor(entry.path)) throw new Error('LOD registry mismatch')
    lodSelections.add(selected)
    return selected
  }
  importer.addURLModifier(resolveURL)
  return {validateFeature: feature => !disposed && lodSelections.has(feature) || validate(feature, 'generated'), selectFeature,
    // Exact authored placement of a static kit asset, kept separately resident.
    // This is not permission to regenerate, batch, or replace it with an LOD.
    validatePinnedFeature: feature => validate(feature, 'pinned-authored-static'),
    resolveAsset: feature => { resolveURL(feature.rootPath); return feature.rootPath },
    dispose() {
      disposed = true
      verifiedShared.clear(); checks.clear(); documents.clear()
      importer.removeURLModifier(resolveURL)
    }}
}
