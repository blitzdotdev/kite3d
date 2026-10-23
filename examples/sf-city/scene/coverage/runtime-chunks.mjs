// Offline experimental residency manifest. Does not alter scene assets or owners.
// Usage: node runtime-chunks.mjs SNAPSHOT ELIGIBILITY_REPORT OUTPUT_DIRECTORY
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {createHash} from 'node:crypto'
const [snapshotArg, auditArg, outputArg] = process.argv.slice(2)
if (!snapshotArg || !auditArg || !outputArg) throw new Error('Expected SNAPSHOT ELIGIBILITY_REPORT OUTPUT_DIRECTORY')
const snapshot = resolve(snapshotArg), output = resolve(outputArg)
if (output === snapshot || output.startsWith(snapshot + '/')) throw new Error('Write runtime candidates outside the immutable source snapshot')
const hash = value => createHash('sha256').update(value).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const source = await json(join(snapshot, 'scene/coverage/runtime-candidate.json'))
const audit = await json(resolve(auditArg))
if (resolve(audit.snapshot) !== snapshot) throw new Error('Eligibility audit belongs to a different snapshot')
for (const [path, expected] of Object.entries(source.sourceHashes)) {
  if (hash(await readFile(join(snapshot, path))) !== expected) throw new Error(`Source changed: ${path}`)
}
const inventory = new Map(source.features.map(f => [f.id, f]))
const allAudit = [...audit.eligible, ...audit.pinnedCandidates, ...audit.rejected]
if (allAudit.length !== source.features.length || new Set(allAudit.map(f => f.id)).size !== allAudit.length) throw new Error('Incomplete/duplicate eligibility audit')
for (const record of allAudit) {
  const f = inventory.get(record.id)
  if (!f || f.asset !== record.asset || f.ownerTile !== record.owner) throw new Error(`Audit mismatch: ${record.id}`)
}
const terrain = source.features.find(f => f.id === 'sf-terrain') ?? source.features.find(f => source.assets[f.asset]?.path.endsWith('/terrain/f.gltf'))
if (!terrain || !audit.eligible.some(f => f.id === terrain.id)) throw new Error('Expected eligible pinned terrain')
const features = audit.eligible.filter(f => f.id !== terrain.id).map(f => inventory.get(f.id)).sort((a, b) => a.id.localeCompare(b.id))
const pinned = [terrain, ...audit.pinnedCandidates.map(f => inventory.get(f.id))]
const assetIds = new Set([...features, ...pinned].map(f => f.asset))
const assets = Object.fromEntries([...assetIds].sort().map(id => [id, source.assets[id]]))
const dependencyPaths = [...new Set(Object.values(assets).flatMap(a => a.dependencies))].sort()
const dependencies = Object.fromEntries(dependencyPaths.map(path => [path, source.dependencies[path]]))
for (const path of dependencyPaths) {
  const bytes = await readFile(join(snapshot, path))
  if (bytes.length !== dependencies[path]?.bytes || hash(bytes) !== dependencies[path]?.sha256) throw new Error(`Dependency changed: ${path}`)
}
// Count source primitive draws before any instancing/merging. This deliberately
// overestimates optimized draws; four passes assumes the validated static
// main/G-buffer/shadow pipeline, not arbitrary future renderer plugins.
const primitiveCounts = new Map()
for (const [id, asset] of Object.entries(assets)) {
  const gltf = await json(join(snapshot, asset.path)); let count = 0
  const visit = (index, ancestors = new Set()) => {
    if (ancestors.has(index)) throw new Error(`Cyclic asset: ${asset.path}`)
    const node = gltf.nodes[index], next = new Set(ancestors).add(index)
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const material = gltf.materials?.[primitive.material]
      count += material?.alphaMode === 'BLEND' && material.doubleSided ? 2 : 1
    }
    for (const child of node.children ?? []) visit(child, next)
  }
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) visit(index)
  primitiveCounts.set(id, count)
}
const cellSize = 64, triangleTarget = 40000, byteTarget = 6 * 1024 * 1024
const pathsFor = list => [...new Set(list.flatMap(f => assets[f.asset].dependencies))].sort()
const bytesFor = paths => paths.reduce((sum, path) => sum + dependencies[path].bytes, 0)
const groups = new Map(), standalone = []
for (const f of features) {
  const {min, max} = f.worldBounds
  if (max[0] - min[0] > cellSize || max[2] - min[2] > cellSize) { standalone.push([f]); continue }
  const cell = `${Math.floor((min[0] + max[0]) / 2 / cellSize)}_${Math.floor((min[2] + max[2]) / 2 / cellSize)}`
  if (!groups.has(cell)) groups.set(cell, [])
  groups.get(cell).push(f)
}
const chunks = []
for (const [cell, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  let members = [], triangles = 0
  for (const f of list) {
    if (members.length && (triangles + f.triangles > triangleTarget || bytesFor(pathsFor([...members, f])) > byteTarget)) {
      chunks.push({cell, members}); members = []; triangles = 0
    }
    members.push(f); triangles += f.triangles
  }
  if (members.length) chunks.push({cell, members})
}
for (const members of standalone) chunks.push({cell: 'cross-cell', members})
const runtimeFeatures = new Map(), tiles = {}, oversized = []
for (const {cell, members} of chunks) {
  const featureIds = members.map(f => f.id), featureHash = hash(JSON.stringify(featureIds)), id = `chunk-${cell}-${featureHash.slice(0, 12)}`
  const paths = pathsFor(members), coldDependencyBytes = bytesFor(paths), triangles = members.reduce((sum, f) => sum + f.triangles, 0)
  const geometryBounds = {min: [0, 1, 2].map(i => Math.min(...members.map(f => f.worldBounds.min[i]))), max: [0, 1, 2].map(i => Math.max(...members.map(f => f.worldBounds.max[i])))}
  const reasons = []
  if (triangles > triangleTarget) reasons.push('single-feature-triangle-target')
  if (coldDependencyBytes > byteTarget) reasons.push('single-feature-byte-target')
  if (reasons.length) oversized.push({id, featureIds, triangles, coldDependencyBytes, reasons})
  const sourcePrimitiveDraws = members.reduce((sum, f) => sum + primitiveCounts.get(f.asset), 0)
  tiles[id] = {featureIds, geometryBounds, triangles, coldDependencyBytes, conservativeDrawCalls: sourcePrimitiveDraws * 4,
    semanticOwners: [...new Set(members.map(f => f.ownerTile))].sort(), crossCellFeature: cell === 'cross-cell',
    dependencies: paths, costAttestation: {method: 'unbatched-source-primitive-upper-bound', passMultiplier: 4,
      featureIdsSHA256: featureHash, dependenciesSHA256: hash(JSON.stringify(paths.map(p => [p, dependencies[p].sha256]))), sourcePrimitiveDraws},
    targetExceptions: reasons}
  for (const f of members) runtimeFeatures.set(f.id, {...f, runtimeChunk: id})
}
if (runtimeFeatures.size !== features.length) throw new Error('Chunk feature loss/duplication')
const pinnedPaths = pathsFor(pinned)
const manifest = {...source, status: 'offline-runtime-chunks-unmeasured', streamingImplemented: false,
  features: [...runtimeFeatures.values(), ...pinned], assets, dependencies, tiles,
  runtimePartition: {cellSize, triangleTarget, byteTarget, preservesSemanticOwnerTile: true},
  exclusions: audit.rejected, pinnedFeatureIds: pinned.map(f => f.id),
  limitations: ['Experimental chunk candidate, not a deployed expanded viewer.',
    '64 m centroid groups preserve entire source assets; large cross-cell features are separate chunks.',
    'Draw costs are conservative source primitive bounds, not measured optimized draw calls or GPU memory.',
    'Four authored exceptions remain excluded and must be disclosed; their source data is unchanged.',
    'All generated eligibility must still pass runtime source preflight. No tree LOD substitutions in this manifest.']}
const report = {snapshot, sourceHashes: source.sourceHashes, features: features.length, chunks: chunks.length,
  semanticOwners: new Set(features.map(f => f.ownerTile)).size, crossCellChunks: standalone.length,
  triangles: features.reduce((sum, f) => sum + f.triangles, 0), uniqueStoredBytes: bytesFor(pathsFor(features)),
  oversized, exclusions: audit.rejected,
  pinnedCost: {triangles: pinned.reduce((sum, f) => sum + f.triangles, 0), bytes: bytesFor(pinnedPaths),
    drawCalls: pinned.reduce((sum, f) => sum + primitiveCounts.get(f.asset), 0) * 4 + 16},
  chunksBlockedBy2100DrawCap: Object.entries(tiles).filter(([, t]) => t.conservativeDrawCalls > 2100).map(([id]) => id),
  largestChunkTriangles: Math.max(...Object.values(tiles).map(t => t.triangles)), largestChunkBytes: Math.max(...Object.values(tiles).map(t => t.coldDependencyBytes))}
await mkdir(output, {recursive: true})
await writeFile(join(output, 'runtime-chunks.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(output, 'runtime-chunks-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({features: report.features, chunks: report.chunks, crossCell: report.crossCellChunks, oversized: oversized.length, blockedBySourceDrawBound: report.chunksBlockedBy2100DrawCap.length, output}))
