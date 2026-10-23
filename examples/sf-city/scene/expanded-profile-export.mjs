// Isolated complete-context profiling export. Never modifies a release directory.
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises'
import {resolve, dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const project = resolve(dirname(new URL(import.meta.url).pathname), '..')
const [sourceArg, chunksArg, planArg, farArg, treesArg, outputArg, grouping = 'chunks64'] = process.argv.slice(2)
if (!outputArg) throw Error('Usage: expanded-profile-export.mjs SOURCE CHUNKS PLAN FAR TREE_LOD NEW_OUTPUT')
const source = resolve(sourceArg), planRoot = resolve(planArg), output = resolve(outputArg)
const roots = {'building-far':resolve(farArg), 'tree-lod':resolve(treesArg)}
for (const root of [source, planRoot, project, ...Object.values(roots)]) if (output === root || output.startsWith(root + '/')) throw Error('Output must be a separate directory')
try { await stat(output); throw Error('Output already exists') } catch (e) { if (e.code !== 'ENOENT') throw e }
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const plan = await readJSON(resolve(planRoot, 'neighborhood-plan.json'))
const manifest = await readJSON(resolve(chunksArg))
if (!['chunks64','owners128'].includes(grouping)) throw Error('Unknown profiling grouping')
if (grouping === 'owners128') {
  const byOwner = new Map(), featureMap = new Map(manifest.features.map(f => [f.id,f]))
  for (const group of plan.requiredBaselineGroups) for (const member of group.members) {
    if (!byOwner.has(member.ownerTile)) byOwner.set(member.ownerTile,[])
    byOwner.get(member.ownerTile).push(member)
  }
  const oldTiles = manifest.tiles
  manifest.tiles = {}; plan.requiredBaselineGroups = []
  for (const [id,members] of byOwner) {
    const features = members.map(m => featureMap.get(m.id)), paths = new Set(), cold = new Set()
    let triangles = 0
    for (const member of members) {
      const feature = featureMap.get(member.id), variant = plan.featureVariants[member.id]?.far
      const near = manifest.assets[feature.asset]
      for (const path of variant?.dependencies || near.dependencies) paths.add(path)
      for (const path of [...near.dependencies,...(variant?.dependencies || [])]) cold.add(path)
      triangles += variant?.triangles ?? feature.triangles
    }
    const bounds = {min:[0,1,2].map(i=>Math.min(...features.map(f=>f.worldBounds.min[i]))),max:[0,1,2].map(i=>Math.max(...features.map(f=>f.worldBounds.max[i])))}
    // Sum contributing old bounds conservatively; actual post-batch units are measured.
    const contributing = Object.values(oldTiles).filter(t=>t.featureIds.some(fid=>features.some(f=>f.id===fid)))
    const drawBound = contributing.reduce((n,t)=>n+t.conservativeDrawCalls,0)
    manifest.tiles[id] = {featureIds:members.map(m=>m.id),geometryBounds:bounds,semanticOwners:[id],triangles:features.reduce((n,f)=>n+f.triangles,0),coldDependencyBytes:[...cold].reduce((n,p)=>n+plan.dependencies[p].bytes,0),conservativeDrawCalls:drawBound}
    plan.requiredBaselineGroups.push({id,key:id+':baseline',detail:'far',semanticOwners:[id],members,geometryBounds:bounds,triangles,dependencies:[...paths],coldDependencies:[...cold],conservativeColdBytes:manifest.tiles[id].coldDependencyBytes})
  }
}
const copies = new Map((await readJSON(resolve(planRoot, 'variant-copy-plan.json'))).map(e => [e.path,e]))
if (plan.farRepresentation !== 'trim-only' || plan.coverage.eligibleFeatures !== 853) throw Error('Unexpected profiling scope')
const files = {}
async function put(path, bytes) {
  const dest = resolve(output, path)
  if (!dest.startsWith(output + '/') || path.split('/').some(p => p.startsWith('.'))) throw Error(`Unsafe path: ${path}`)
  await mkdir(dirname(dest), {recursive:true}); await writeFile(dest, bytes)
  files[path] = {bytes:Buffer.byteLength(bytes), sha256:sha(bytes)}
}
async function copy(path, root, hash) {
  if (files[path]) { if (hash && files[path].sha256 !== hash) throw Error(`Conflicting hash: ${path}`); return }
  const file = resolve(root,path)
  if (!file.startsWith(root + '/')) throw Error(`Unsafe source: ${path}`)
  const bytes = await readFile(file)
  if (hash && sha(bytes) !== hash) throw Error(`Changed source: ${path}`)
  await put(path,bytes)
}
for (const [path,hash] of Object.entries(plan.originalSourceHashes)) {
  const bytes = await readFile(resolve(source,path))
  if (sha(bytes) !== hash) throw Error(`Original source changed: ${path}`)
  if (path !== 'assets.json') await put(path,bytes)
}
await put('assets.json', await readFile(resolve(planRoot,'extended-assets.json')))
await put('provenance/original-assets.json', await readFile(resolve(source,'assets.json')))
if (files['assets.json'].sha256 !== plan.proposedRuntimeSourceHashes['assets.json']) throw Error('Extended registry changed')
const selectedPaths = new Set(), validationPaths = new Set()
for (const group of plan.requiredBaselineGroups) {
  for (const path of group.dependencies) selectedPaths.add(path)
  for (const path of group.coldDependencies) validationPaths.add(path)
}
for (const id of manifest.pinnedFeatureIds) {
  const f = manifest.features.find(f => f.id === id)
  for (const path of manifest.assets[f.asset].dependencies) { selectedPaths.add(path); validationPaths.add(path) }
}
for (const path of validationPaths) {
  const c = copies.get(path), root = c ? roots[c.sourceSet] : source
  await copy(path,root,plan.dependencies[path].sha256)
}
for (const [path,c] of copies) if (path.endsWith('lod-manifest.json')) await copy(path,roots[c.sourceSet],c.sha256)
manifest.assets = plan.assets; manifest.dependencies = plan.dependencies
manifest.sourceHashes = plan.proposedRuntimeSourceHashes
manifest.originalSourceHashes = plan.originalSourceHashes
manifest.originalRegistryPath = 'provenance/original-assets.json'
const farAttestation = await readJSON(resolve(roots['building-far'],'assets/models/city/buildings-far/lod-manifest.json'))
for (const [path,hash] of Object.entries(farAttestation.sourceContext)) {
  if (path === 'assets.json') continue
  await copy(path,source,hash)
  manifest.originalSourceHashes[path] = hash
  manifest.sourceHashes[path] = hash
}
manifest.buildingLod = {mode:'trim-only', path:'assets/models/city/buildings-far/lod-manifest.json'}
for (const group of plan.requiredBaselineGroups) manifest.tiles[group.id].details = {far:{triangles:group.triangles,coldDependencyBytes:group.conservativeColdBytes,conservativeDrawCalls:manifest.tiles[group.id].conservativeDrawCalls}}
const sumBytes = paths => [...paths].reduce((n,p) => n + plan.dependencies[p].bytes,0)
const accounting = {
  status:'unvalidated-full-context-profile', visualAccepted:false, eligibleFeatures:853,
  groups:plan.requiredBaselineGroups.length, sourceTriangles:plan.requiredBaselineGroups.reduce((n,g) => n+g.triangles,0),
  pinnedTriangles:16640, storedBaselineUniqueBytes:sumBytes(selectedPaths),
  storedValidationUniqueBytes:sumBytes(validationPaths),
  conservativeGroupColdBytes:plan.requiredBaselineGroups.reduce((n,g) => n+g.conservativeColdBytes,0),
  concurrency:2, batchCellSize:grouping === 'owners128' ? 128 : 64, grouping, authoredExclusions:plan.authoredExclusions,
  sourceCoverageMasks:plan.sourceCoverageMasks,
  limitations:['Byte counts are stored dependency bytes, not decoded CPU memory or VRAM.','Per-group charges intentionally count shared dependencies repeatedly.','Full baseline profiling ceilings are fixture bounds, not production performance budgets.','Trim-only visual acceptance and shadow lifecycle gate are required before browser execution.'],
}
await put('manifest.json',JSON.stringify(manifest)); await put('profile.json',JSON.stringify(accounting,null,2))
await copy('assets/environments/grant-street/street.hdr',source)
for (const file of ['tile-streaming.js','tile-preflight.js','tile-material-pool.js','batch-keys.js']) await copy(`lib/${file}`,project)
await put('main.js',await readFile(resolve(project,'scene/expanded-profile-main.js')))
await put('viewer.js',await readFile(resolve(project,'scene/expanded-profile-viewer.js')))
await put('_blitz/runtime.js',await readFile(require.resolve('@kite3d/engine/runtime.js')))
const pkg=await readJSON(resolve(project,'package.json')); delete pkg.devDependencies; delete pkg.scripts
pkg.main='./main.js'; pkg.mainScene='bootstrap.gltf'
await put('package.json',JSON.stringify(pkg)); await put('bootstrap.gltf',JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]}))
await put('index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Complete North Beach profiling candidate</title><style>html,body{margin:0;height:100%;background:#26323d;color:white;font:14px system-ui}canvas{width:100%;height:100%;display:block}aside{position:fixed;left:12px;top:12px;background:#17242eee;padding:12px;max-width:340px}button{padding:8px}pre{white-space:pre-wrap}</style><canvas></canvas><aside><b>North Beach full-context profile</b><p>Experimental complete eligible area. Four authored exceptions are excluded.</p><button id="reload">Reload</button><button id="dispose">Release all</button><p id="boot">Preparing…</p><pre id="status"></pre></aside><script type="importmap">{"imports":{"three":"./_blitz/runtime.js","threepipe":"./_blitz/runtime.js"}}</script><script type="module" src="./viewer.js"></script></html>`)
await put('profile-files.json',JSON.stringify({status:'unvalidated',files},null,2))
console.log(JSON.stringify({output,...accounting}))
