// Isolated candidate packager. Never modifies dist/, the release exporter or release archives.
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises'
import {resolve, dirname} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
const require = createRequire(import.meta.url)
const project = resolve(dirname(new URL(import.meta.url).pathname), '..')
const [snapshotArg, outputArg, coverageArg] = process.argv.slice(2)
if (!snapshotArg || !outputArg || !coverageArg) throw Error('Usage: node scene/stream-candidate-export.mjs FROZEN_SNAPSHOT NEW_OUTPUT COVERAGE_REPORT')
const snapshot = resolve(snapshotArg), output = resolve(outputArg)
if (output === snapshot || output.startsWith(snapshot + '/') || output === project || output.startsWith(project + '/')) throw Error('Use a separate new directory outside the project and snapshot')
try { await stat(output); throw Error('Output already exists; choose a new directory to preserve prior evidence') } catch (error) { if (error.code !== 'ENOENT') throw error }
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const manifest = await json(resolve(snapshot, 'manifest.json')), selection = await json(resolve(snapshot, 'mixed-selection.json'))
const coverage = await json(resolve(coverageArg))
if (selection.chosen.length !== 153 || Object.keys(manifest.tiles).length !== 5 || selection.pinned.length !== 4) throw Error('Candidate scope differs from the validated 153-feature fixture')
const selected = [...selection.chosen, ...selection.pinned, selection.terrain]
const chosenIds = new Set(selection.chosen.map(f => f.id))
if (Object.values(manifest.tiles).flatMap(t => t.featureIds).some(id => !chosenIds.has(id))) throw Error('Owner manifest expands selected feature scope')
await mkdir(output, {recursive:true})
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), files = {}
async function put(path, bytes) {
  const dest = resolve(output,path)
  if (!dest.startsWith(output + '/') || path.split('/').some(p => p.startsWith('.'))) throw Error(`Unsafe candidate path: ${path}`)
  await mkdir(dirname(dest),{recursive:true}); await writeFile(dest,bytes)
  files[path] = {bytes:Buffer.byteLength(bytes), sha256:sha(bytes)}
}
async function copy(path, from = snapshot, expected) {
  if (files[path]) return
  const source = resolve(from,path)
  if (!source.startsWith(from + '/')) throw Error(`Source escapes snapshot: ${path}`)
  const bytes = await readFile(source)
  if (expected && sha(bytes) !== expected) throw Error(`Frozen snapshot differs: ${path}`)
  await put(path,bytes)
}
for (const [path, hash] of Object.entries(manifest.sourceHashes)) await copy(path,snapshot,hash)
for (const f of selected) for (const path of manifest.assets[f.asset].dependencies) await copy(path,snapshot,manifest.dependencies[path].sha256)
const lodPath = 'assets/models/city/trees/lod-manifest.json'
if (!manifest.sourceHashes[lodPath]) throw Error('Candidate requires a hash-attested tree LOD manifest')
const lod = await json(resolve(snapshot,lodPath))
const selectedAssets = new Set(selection.chosen.map(f => manifest.assets[f.asset].path))
const lodAssets = []
for (const entry of lod.entries.filter(entry => selectedAssets.has(entry.nearAsset))) {
  const asset = Object.values(manifest.assets).find(asset => asset.path === entry.path)
  const near = Object.values(manifest.assets).find(asset => asset.path === entry.nearAsset)
  if (!asset || !near || !['mid','far'].includes(entry.detail)
    || near.dependencies.length !== Object.keys(entry.nearDependencies).length
    || !near.dependencies.every(path => entry.nearDependencies[path] === manifest.dependencies[path]?.sha256)) throw Error('LOD does not attest the selected near asset')
  for (const path of asset.dependencies) await copy(path,snapshot,manifest.dependencies[path].sha256)
  lodAssets.push({near:entry.nearAsset,detail:entry.detail,path:entry.path})
}
if (lodAssets.length !== 6) throw Error('Expected exactly six attested tree detail assets')
await copy('assets/environments/grant-street/street.hdr')
const drawEstimates = {'-1_-1':1332, '-1_-2':584, '0_-2':60, '-2_-2':44, '-1_-3':16}
for (const [id,tile] of Object.entries(manifest.tiles)) {
  if (!drawEstimates[id]) throw Error('Unmeasured owner group')
  tile.conservativeDrawCalls = drawEstimates[id]
  tile.details = {}
  for (const detail of ['near','mid','far']) {
    const dependencies = new Set(); let triangles = 0
    for (const featureId of tile.featureIds) {
      const feature = selection.chosen.find(f => f.id === featureId)
      if (!feature) throw Error('LOD cost includes an unselected feature')
      const near = manifest.assets[feature.asset]
      const variant = feature.id.startsWith('sf-tree:') && lod.entries.find(entry => entry.nearAsset === near.path && entry.detail === detail)
      const asset = variant ? Object.values(manifest.assets).find(asset => asset.path === variant.path) : near
      // Include near preflight bytes as well as replacement bytes in the conservative cold-load cost.
      for (const path of [...near.dependencies,...asset.dependencies]) dependencies.add(path)
      triangles += feature.visible ? (variant ? variant.triangles : feature.triangles) : 0
    }
    tile.details[detail] = {triangles,coldDependencyBytes:[...dependencies].reduce((sum,path) => sum + manifest.dependencies[path].bytes,0),conservativeDrawCalls:drawEstimates[id]}
  }
}
await put('manifest.json',JSON.stringify(manifest)); await copy('mixed-selection.json')
for (const path of ['lib/tile-streaming.js','lib/tile-preflight.js','lib/tile-material-pool.js','lib/batch-keys.js']) await copy(path,project)
for (const path of ['NOTICES.txt','licenses/BMW-CC-BY-4.0.txt','licenses/threepipe-LICENSE.txt','licenses/three-LICENSE.txt','licenses/kite3d-LICENSE.txt']) await copy(path,resolve(project,'scene/public-notices'))
await put('_blitz/runtime.js',await readFile(require.resolve('@kite3d/engine/runtime.js')))
await put('main.js',await readFile(resolve(project,'scene/stream-candidate-main.js')))
await put('viewer.js',await readFile(resolve(project,'scene/stream-candidate-viewer.js')))
const pkg = await json(resolve(project,'package.json'))
delete pkg.devDependencies; delete pkg.scripts
pkg.mainScene = 'bootstrap.gltf'; pkg.main = './main.js'
await put('package.json',JSON.stringify(pkg))
await put('bootstrap.gltf',JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Experimental streamed city'}]}))
const [lon,lat] = coverage.origin, scale = 111320 * Math.cos(lat * Math.PI / 180)
const sourceMasks = coverage.coverageMasks.map(([west,south,east,north])=>({min:[(west-lon)*scale,0,-(north-lat)*111320],max:[(east-lon)*scale,0,-(south-lat)*111320]}))
const minX = Math.min(...sourceMasks.map(b=>b.min[0])), minZ = Math.min(...sourceMasks.map(b=>b.min[2]))
const maxX = Math.max(...sourceMasks.map(b=>b.max[0])), maxZ = Math.max(...sourceMasks.map(b=>b.max[2]))
await put('coverage.json',JSON.stringify({status:'experimental-not-production',lodAssets,pinnedCost:{triangles:16640,bytes:1245878,drawCalls:52},bakedFeatures:manifest.totals.features,sourceMasks,viewBox:[minX-10,minZ-10,maxX-minX+20,maxZ-minZ+20],origin:coverage.origin,verticalOriginM:coverage.verticalOriginM,limitations:['Source masks are the exact query coverage union, not full model availability.','Gold/green overlays are conservative feature AABBs, not surveyed footprints.','Only 153 selected models plus pinned terrain and authored poplars are available.','No hardware FPS or complete San Francisco coverage is claimed.']}))
await put('index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>North Beach streaming candidate</title><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;background:#233039;color:#eef4ef;font:14px system-ui}canvas{display:block;width:100%;height:100%;outline:none}aside{position:fixed;top:12px;left:12px;width:min(340px,calc(100% - 48px));padding:12px;background:#17242eee;border-radius:8px;max-height:80vh;overflow:auto}h1{font-size:18px;margin:0 0 8px}p{margin:8px 0}button{padding:8px;margin:2px;color:#fff;background:#344c5d;border:1px solid #7a9bad;border-radius:4px}button:focus-visible{outline:2px solid white}svg{width:100%;height:150px;background:#14202a}#outside{color:#ffd892}#tile-errors{white-space:pre-wrap;font-size:11px}#boot{position:fixed;bottom:12px;left:12px;right:12px;background:#17242e;padding:15px} [hidden]{display:none!important}</style><canvas tabindex="0" aria-label="Experimental North Beach city. Drag to orbit, right drag to pan, scroll to zoom."></canvas><aside><h1>North Beach: streaming candidate</h1><p>Limited North Beach area · Experimental</p><div><button data-view="overview">Overview</button><button data-view="north">North block</button><button data-view="park">Park edge</button><button data-view="wide">Wide</button></div><p>Drag to orbit · Right drag to pan · Scroll to zoom</p><p id="residency" role="status" aria-live="polite"></p><p id="outside" hidden>View target is outside selected model bounds. Surroundings are unavailable here.</p><details><summary>Coverage and loading details</summary><p id="scope"></p><svg id="coverage-map" role="img" aria-label="Source coverage and selected model bounds, north upward"></svg><p>Gray: exact source-mask union. Gold: available model bounds. Green: loaded model bounds. White dot: view target. Bounds are not surveyed footprints.</p><p id="budget-status"></p><pre id="tile-errors"></pre></details><button id="retry-tiles" hidden>Retry failed tiles</button><button id="reload">Reload candidate</button></aside><p id="boot" role="status">Preparing the experimental city…</p><script type="importmap">{"imports":{"three":"./_blitz/runtime.js","threepipe":"./_blitz/runtime.js"}}</script><script type="module" src="./viewer.js"></script></html>`)
await put('candidate-files.json',JSON.stringify({status:'unvalidated-viewer-candidate',files},null,2))
console.log(`Prepared isolated candidate in ${output}; browser validation still required.`)
