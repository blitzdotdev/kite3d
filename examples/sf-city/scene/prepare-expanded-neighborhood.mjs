// Offline export planning only. No viewer/index.html, active expansion or publication.
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {createHash} from 'node:crypto'
const [snapshotArg, chunksArg, farArg, treesArg, outputArg] = process.argv.slice(2)
if (!outputArg) throw Error('Usage: prepare-expanded-neighborhood.mjs SOURCE CHUNKS FAR_CANDIDATE TREE_LOD_SNAPSHOT NEW_OUTPUT')
const source = resolve(snapshotArg), farRoot = resolve(farArg), treeRoot = resolve(treesArg), output = resolve(outputArg)
for (const root of [source, farRoot, treeRoot]) if (output === root || output.startsWith(root + '/')) throw Error('Output must be separate from frozen inputs')
try { await stat(output); throw Error('Output exists; preserve previous candidate evidence') } catch (error) { if (error.code !== 'ENOENT') throw error }
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function checked(root, path, expected) {
  if (path.startsWith('/') || path.split('/').some(p => p === '..' || p.startsWith('.'))) throw Error(`Unsafe asset path: ${path}`)
  const bytes = await readFile(join(root, path))
  if (!expected || sha(bytes) !== expected) throw Error(`Attestation mismatch: ${path}`)
  return bytes
}
const manifest = await readJSON(resolve(chunksArg)), far = await readJSON(join(farRoot, 'assets/models/city/buildings-far/lod-manifest.json'))
const treePath = 'assets/models/city/trees/lod-manifest.json', trees = await readJSON(join(treeRoot, treePath))
const treeRuntime = await readJSON(join(treeRoot, 'manifest.json'))
for (const [path, hash] of Object.entries(manifest.sourceHashes)) await checked(source, path, hash)
for (const [path, hash] of Object.entries(far.sourceContext)) await checked(source, path, hash)
await checked(treeRoot, treePath, treeRuntime.sourceHashes[treePath])
const registry = await readJSON(join(source, 'assets.json')), publicRegistry = structuredClone(registry)
const features = new Map(manifest.features.map(feature => [feature.id, feature]))
const variants = new Map(), dependencies = {...manifest.dependencies}, assets = {...manifest.assets}, copies = new Map()
const addVariant = async (feature, entry, root, prefix) => {
  const near = manifest.assets[feature.asset]
  if (!near || near.path !== entry.nearAsset || near.dependencies.length !== Object.keys(entry.nearDependencies).length) throw Error(`Near dependency closure changed: ${feature.id}`)
  for (const path of near.dependencies) {
    if (entry.nearDependencies[path] !== manifest.dependencies[path]?.sha256) throw Error(`Near identity changed: ${path}`)
    await checked(source, path, entry.nearDependencies[path])
  }
  const variantPaths = entry.farDependencies || Object.fromEntries(treeRuntime.assets[Object.keys(treeRuntime.assets).find(key => treeRuntime.assets[key].path === entry.path)].dependencies.map(path => [path, treeRuntime.dependencies[path].sha256]))
  for (const [path, hash] of Object.entries(variantPaths)) {
    const bytes = await checked(root, path, hash)
    if (dependencies[path] && dependencies[path].sha256 !== hash) throw Error(`Conflicting shared dependency: ${path}`)
    dependencies[path] = {bytes: bytes.length, sha256: hash}
    copies.set(path, {path, sha256: hash, bytes: bytes.length, sourceSet: prefix})
  }
  const key = `${prefix}-${sha(entry.path).slice(0, 16)}`
  if (publicRegistry.files[key]) throw Error('Variant registration collision')
  publicRegistry.files[key] = {path: entry.path, files: {'f.gltf': entry.path}}
  assets[key] = {path: entry.path, dependencies: Object.keys(variantPaths).sort(), triangles: entry.triangles}
  const gltf = JSON.parse(await readFile(join(root, entry.path), 'utf8'))
  // Virtual project-absolute resources are resolved through the attested graph.
  // Relative URI aliases must remain explicit for the Kite asset URL resolver.
  for (const resource of [...gltf.buffers || [], ...gltf.images || []]) {
    if (!resource.uri) continue
    const physical = resource.uri.startsWith('/kite3d/') ? resource.uri.slice(8) : join(entry.path.slice(0, entry.path.lastIndexOf('/')), resource.uri).replaceAll('\\', '/')
    if (!variantPaths[physical]) throw Error(`Unattested resource URI: ${resource.uri}`)
    publicRegistry.files[key].files[resource.uri] = physical
  }
  return {key, detail: entry.detail, path: entry.path, triangles: entry.triangles, dependencies: Object.keys(variantPaths).sort()}
}
for (const entry of far.entries) {
  const feature = features.get(entry.id)
  if (!feature) continue // Authored exclusions are never admitted through a far asset.
  if (feature.ownerTile !== entry.ownerTile || JSON.stringify(feature.worldMatrix) !== JSON.stringify(entry.worldMatrix)) throw Error(`Far placement changed: ${entry.id}`)
  variants.set(feature.id, {far: await addVariant(feature, entry, farRoot, 'building-far')})
}
const treeVariants = new Map()
for (const entry of trees.entries) {
  const feature = manifest.features.find(feature => manifest.assets[feature.asset]?.path === entry.nearAsset && feature.id.startsWith('sf-tree:'))
  if (!feature) continue
  treeVariants.set(`${entry.nearAsset}:${entry.detail}`, await addVariant(feature, entry, treeRoot, 'tree-lod'))
}
for (const feature of manifest.features.filter(feature => feature.id.startsWith('sf-tree:'))) {
  const near = manifest.assets[feature.asset]
  variants.set(feature.id, Object.fromEntries(['mid', 'far'].map(detail => [detail, treeVariants.get(`${near.path}:${detail}`)]).filter(([, value]) => value)))
}
const pinnedIds = new Set(manifest.pinnedFeatureIds), baseline = []
for (const [id, chunk] of Object.entries(manifest.tiles)) {
  const paths = new Set(), nearValidationPaths = new Set(), members = []; let triangles = 0
  for (const featureId of chunk.featureIds) {
    const feature = features.get(featureId)
    if (!feature || pinnedIds.has(featureId)) throw Error('Invalid baseline chunk membership')
    const variant = variants.get(featureId)?.far, near = manifest.assets[feature.asset]
    members.push({id: feature.id, ownerTile: feature.ownerTile, runtimeChunk: id, asset: variant?.key ?? feature.asset, detail: variant ? 'far' : 'original'})
    for (const path of variant?.dependencies || near.dependencies) paths.add(path)
    for (const path of near.dependencies) nearValidationPaths.add(path)
    triangles += variant?.triangles ?? feature.triangles
  }
  const unique = [...paths].sort(), coldPaths = [...new Set([...paths, ...nearValidationPaths])].sort()
  baseline.push({id, key: `${id}:baseline`, detail: 'far', semanticOwners: chunk.semanticOwners, members,
    geometryBounds: chunk.geometryBounds, triangles,
    assetBytes: unique.reduce((sum, path) => sum + dependencies[path].bytes, 0),
    conservativeColdBytes: coldPaths.reduce((sum, path) => sum + dependencies[path].bytes, 0),
    dependencies: unique, coldDependencies: coldPaths,
    drawCost: null, admission: 'blocked-until-measured-render-cost-and-total-budget'})
}
const sourceCoverage = await readJSON(join(source, 'scene/coverage/candidate-build-report.json'))
const allMembers = baseline.flatMap(group => group.members)
const registryBytes = JSON.stringify(publicRegistry, null, 2) + '\n'
const farManifestPath = 'assets/models/city/buildings-far/lod-manifest.json'
for (const [root, path, sourceSet] of [[farRoot,farManifestPath,'building-far'],[treeRoot,treePath,'tree-lod']]) {
  const bytes = await readFile(join(root,path))
  copies.set(path,{path,sha256:sha(bytes),bytes:bytes.length,sourceSet})
}
const proposal = {
  status: 'offline-expanded-neighborhood-plan-not-viewer',
  farRepresentation: far.preparationMode || 'footprint-only', visualAccepted: false,
  originalSourceHashes: manifest.sourceHashes,
  proposedRuntimeSourceHashes: {...manifest.sourceHashes, 'assets.json':sha(registryBytes),
    [farManifestPath]:copies.get(farManifestPath).sha256, [treePath]:copies.get(treePath).sha256},
  sourceCoverageMasks: sourceCoverage.coverageMasks, coordinateSystem: manifest.coordinateSystem,
  requiredBaselineGroups: baseline, pinnedFeatureIds: manifest.pinnedFeatureIds, authoredExclusions: manifest.exclusions,
  featureVariants: Object.fromEntries(variants), assets, dependencies,
  registryExtensions: Object.keys(publicRegistry.files).filter(key => !registry.files[key]),
  coverage: {eligibleFeatures: allMembers.length, eligibleBuildings: allMembers.filter(member => member.id.startsWith('sf-building:')).length,
    substitutedBuildings: allMembers.filter(member => member.id.startsWith('sf-building:') && member.detail === 'far').length,
    originalBuildingExceptions: allMembers.filter(member => member.id.startsWith('sf-building:') && member.detail === 'original').map(member => member.id)},
  limits: null,
  blockers: ['Expanded texture lifecycle regression must pass.', 'Far representation requires distance-render acceptance before thresholds are chosen; footprint-only bodies were rejected at 300 m and 600 m.', 'Mandatory baseline must fit a measured active budget in full; never choose five arbitrary chunks.', 'Draw costs and decoded memory have not been measured for this full baseline.'],
  limitations: ['This is a copy/registration plan, not a published or browser-validated viewer.', 'Representation preparationMode determines retained appearance; current candidates are not visually accepted. Selected landmark exceptions remain exact original geometry.', 'Four source-authored unsupported exceptions remain explicit exclusions, not silently complete coverage.', 'Cold bytes conservatively include original-asset validation and shared duplicates across chunks.'],
}
await mkdir(output, {recursive: true})
await writeFile(join(output, 'neighborhood-plan.json'), JSON.stringify(proposal, null, 2) + '\n')
await writeFile(join(output, 'extended-assets.json'), registryBytes)
await writeFile(join(output, 'variant-copy-plan.json'), JSON.stringify([...copies.values()].sort((a,b) => a.path.localeCompare(b.path)), null, 2) + '\n')
console.log(JSON.stringify({output, ...proposal.coverage, baselineGroups: baseline.length, baselineTriangles: baseline.reduce((sum, group) => sum + group.triangles, 0), registryExtensions: proposal.registryExtensions.length, status: proposal.status}))
