// Assemble only the public runtime and its data. This does not create credentials or publish.
import {readFileSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {resolve, dirname, relative, extname} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {root} from './data.mjs'
import {parsePackageJSON, parseAssetsJSONManifest, validateSceneSource, parsePackageJsonSettingsConfig} from '@kite3d/engine/projectFormat'
import {dependencyImportMap} from '@kite3d/engine/importMap'

const require = createRequire(import.meta.url)
const runtime = readFileSync(require.resolve('@kite3d/engine/runtime.js'))
const pkg = parsePackageJSON(readFileSync(resolve(root, 'package.json'), 'utf8'))
const registry = parseAssetsJSONManifest(readFileSync(resolve(root, 'assets.json'), 'utf8'))
validateSceneSource(pkg.mainScene, readFileSync(resolve(root, pkg.mainScene), 'utf8'))
const config = await parsePackageJsonSettingsConfig(pkg)
if (config.plugins.length || config.scripts.length) throw new Error('Extend the export allowlist before adding scripts or plugins')
const version = pkg.devDependencies.kite3d
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const output = resolve(root, 'dist')
rmSync(output, {recursive: true, force: true}); mkdirSync(output)
const files = {}
const publicRegistry = {version: registry.version, files: {}}
function put(path, bytes) {
  if (resolve(output, path) === output || !resolve(output, path).startsWith(output + '/')) throw new Error(`Invalid export path: ${path}`)
  mkdirSync(dirname(resolve(output, path)), {recursive: true})
  writeFileSync(resolve(output, path), bytes)
  const mime = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary'}[extname(path)]
  files[path] = {sha256: sha(bytes), size: Buffer.byteLength(bytes), ...(mime ? {mime} : {})}
}
function copy(path, assetEntry) {
  const source = resolve(root, path)
  if (!source.startsWith(root + '/') || relative(root, source).split('/').some(p => p.startsWith('.'))) throw new Error(`Invalid public path: ${path}`)
  if (files[path] && !assetEntry) return
  const bytes = readFileSync(source)
  // Whitespace-only compaction in the public copy; editable source stays pretty.
  put(path, /\.(gltf|json)$/.test(path) ? JSON.stringify(JSON.parse(bytes)) : bytes)
  if (/\.gltf$/.test(path)) {
    const doc = JSON.parse(bytes)
    const reachable = new Set()
    function visit(index) {
      if (reachable.has(index)) return
      reachable.add(index)
      const node = doc.nodes?.[index]
      if (!node) throw new Error(`Missing scene node: ${index}`)
      const reference = node.extras?.rootPath
      if (reference) {
        const match = /^\/kite3d\/@([^/]+)\/f\.gltf$/.exec(reference)
        if (!match) throw new Error(`Unsupported public asset reference: ${reference}`)
        const id = match[1], entry = registry.files[id]
        if (!entry) throw new Error(`Unregistered public asset: ${id}`)
        if (!publicRegistry.files[id]) {
          const publicEntry = {path: entry.path, files: {'f.gltf': entry.path}}
          publicRegistry.files[id] = publicEntry
          copy(entry.path, {source: entry, target: publicEntry})
        }
      }
      for (const child of node.children || []) visit(child)
    }
    for (const index of doc.scenes?.[doc.scene ?? 0]?.nodes || []) visit(index)
    for (const resource of [...doc.buffers || [], ...doc.images || []]) {
      if (!resource.uri) continue
      if (/^(data:|https?:)/.test(resource.uri)) throw new Error(`Export requires local resource: ${resource.uri}`)
      const resourcePath = assetEntry?.source.files?.[resource.uri] || (resource.uri.startsWith('/kite3d/') ? resource.uri.slice('/kite3d/'.length) : relative(root, resolve(dirname(source), resource.uri)))
      if (assetEntry) assetEntry.target.files[resource.uri] = resourcePath
      copy(resourcePath)
    }
  }
}
for (const path of [pkg.mainScene, 'main.js', 'lib/generated-placement.js', 'lib/batch-keys.js', 'scene/generated.json']) copy(path)
const manifest = JSON.parse(readFileSync(resolve(root, 'scene/generated.json')))
if(manifest.photoStudies?.length) copy('assets/environments/grant-street/street.hdr')
put('assets.json', JSON.stringify(publicRegistry))
delete pkg.devDependencies; delete pkg.scripts
pkg.kite3d.version = version
put('package.json', JSON.stringify(pkg))
put('_blitz/runtime.js', runtime)
// Ship attribution from the validated release alongside the public runtime.
for (const path of ['NOTICES.txt', 'licenses/BMW-CC-BY-4.0.txt', 'licenses/threepipe-LICENSE.txt', 'licenses/three-LICENSE.txt', 'licenses/kite3d-LICENSE.txt']) {
  put(path, readFileSync(resolve(root, 'scene/public-notices', path)))
}
put('viewer.js', readFileSync(resolve(root, 'scene/viewer-entry.js')))
put('index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="kite3d-runtime" content="${version} ${sha(runtime)}"><title>North Beach / Kite3D City Lab</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#172c2e;color:#d9e3df;font:16px/1.6 system-ui}canvas{width:100%;height:100%;display:block;outline:none}.status{position:fixed;inset:0;z-index:10000;display:grid;place-content:center;padding:24px;text-align:center;background:#172c2e}.status[hidden]{display:none}.status h1{font-size:24px;margin:0 0 8px}.status p{max-width:32em;margin:0 0 16px;color:#bdccc4}button{font:inherit;border:1px solid #91ae9d;border-radius:8px;background:#d5e5d5;color:#173229;padding:10px 20px;cursor:pointer}button:focus-visible{outline:3px solid white;outline-offset:4px}button:disabled{opacity:.6;cursor:wait}noscript{position:fixed;inset:0;z-index:10001;background:#172c2e;padding:30px}
</style><canvas id="kite3d-canvas" tabindex="0" aria-label="Interactive North Beach city. Drag to orbit, scroll to zoom, or use the view buttons." aria-hidden="true"></canvas><section id="loading" class="status" role="status" aria-live="polite"><h1>Loading North Beach</h1><p>Preparing the city, buildings and materials. The first visit may take a moment.</p></section><section id="load-error" class="status" role="alert" hidden><h1>The city could not load</h1><p>Loading stopped before the city was ready. The error below identifies the failed step.</p><button id="retry" type="button">Try again</button></section><noscript>Enable JavaScript to explore North Beach.</noscript><script type="importmap">${JSON.stringify(dependencyImportMap(config.dependencies))}</script><script type="module" src="./viewer.js"></script></html>`)
// Keep the upload manifest beside the export, not in the public release.
mkdirSync(resolve(root, '.kite3d'), {recursive: true})
writeFileSync(resolve(root, '.kite3d/release.json'), JSON.stringify({files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))}, null, 2) + '\n')
console.log(`Exported ${Object.keys(files).length} files (${Object.values(files).reduce((n, f) => n + f.size, 0)} bytes) to dist/`)
