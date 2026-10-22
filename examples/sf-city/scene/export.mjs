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
  put(path, bytes)
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
for (const path of [pkg.mainScene, 'main.js', 'lib/generated-placement.js', 'scene/generated.json']) copy(path)
put('assets.json', JSON.stringify(publicRegistry))
delete pkg.devDependencies; delete pkg.scripts
pkg.kite3d.version = version
put('package.json', JSON.stringify(pkg))
put('_blitz/runtime.js', runtime)
put('index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="kite3d-runtime" content="${version} ${sha(runtime)}"><title>North Beach / Kite3D City Lab</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}canvas{width:100%;height:100%;display:block}#loading{position:fixed;inset:0;display:grid;place-content:center;text-align:center;color:#d9e3df;font:16px/1.8 system-ui;background:#172c2e}#loading small{color:#a8beb5}#error{position:fixed;inset:20px;color:white;font:16px system-ui;pointer-events:none}</style><canvas id="kite3d-canvas"></canvas><div id="loading">Loading North Beach<small>Preparing the editable city and its materials...</small></div><div id="error"></div><script type="importmap">${JSON.stringify(dependencyImportMap(config.dependencies))}</script><script type="module">import {createGame} from './_blitz/runtime.js';createGame({base:new URL('./',location.href).href,canvas:document.querySelector('canvas')}).then(()=>document.querySelector('#loading').remove()).catch(error=>{document.querySelector('#loading')?.remove();document.querySelector('#error').textContent='Unable to load city: '+error.message;console.error(error)});</script></html>`)
// Keep the upload manifest beside the export, not in the public release.
mkdirSync(resolve(root, '.kite3d'), {recursive: true})
writeFileSync(resolve(root, '.kite3d/release.json'), JSON.stringify({files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))}, null, 2) + '\n')
console.log(`Exported ${Object.keys(files).length} files (${Object.values(files).reduce((n, f) => n + f.size, 0)} bytes) to dist/`)
