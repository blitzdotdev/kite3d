import {Group, Vector3, DirectionalLight, DirectionalLight2, SSAOPlugin} from 'threepipe'
import {createKiteTileAdapter, createTileStreaming, treeDetailAtDistance} from './lib/tile-streaming.js'
import {createStaticTilePreflight} from './lib/tile-preflight.js'
import {createTileMaterialPool} from './lib/tile-material-pool.js'

let inspect = () => ({active: false}), requestFrame = () => {}
export const renderCandidateFrame = () => requestFrame()
export const inspectCandidate = () => inspect()

export async function main({viewer}) {
  const base = new URL('./', import.meta.url)
  const read = async path => { const r = await fetch(new URL(path, base)); if (!r.ok) throw Error(`${path}: ${r.status}`); return r.json() }
  const [manifest, selection, coverage, generated] = await Promise.all(['manifest.json', 'mixed-selection.json', 'coverage.json', 'scene/generated.json'].map(read))
  const root = new Group(), pinnedRoot = new Group(), lights = new Group()
  viewer.scene.add(root, pinnedRoot, lights)
  const pool = createTileMaterialPool()
  let preflight, adapter, pinnedAdapter, groundAdapter, controller, ground, pinned, timer
  let stopped = false, renderedFrames = 0
  const recordFrame = () => { if (viewer.renderManager.webglRenderer.info.render.calls) renderedFrames++ }
  viewer.addEventListener('postFrame', recordFrame)
  requestFrame = () => { viewer.setDirty(); return renderedFrames }
  const pending = new AbortController()
  const leaving = () => { pending.abort(); controller?.stop() }
  window.addEventListener('pagehide', leaving)
  const cleanup = () => {
    if (stopped) return
    stopped = true; pending.abort(); clearInterval(timer)
    window.removeEventListener('pagehide', leaving)
    controller?.stop()
    if (ground) groundAdapter.release(ground)
    if (pinned) pinnedAdapter.release(pinned)
    pool.dispose(); preflight?.dispose()
    root.removeFromParent(); pinnedRoot.removeFromParent(); lights.removeFromParent()
    for (const button of document.querySelectorAll('[data-view],#retry-tiles')) button.onclick = null
    viewer.removeEventListener('preFrame', updateShadow)
    viewer.removeEventListener('postFrame', recordFrame)
    requestFrame = () => {}
    const final = {active:false, materialPool:pool.state, sources:adapter?.state, ground:groundAdapter?.state, pinned:pinnedAdapter?.state}
    inspect = () => final
  }
  const camera = viewer.scene.mainCamera
  const sun = new DirectionalLight2('#ffffff', 3.2)
  const updateShadow = () => {
    const extent = Math.max(100, Math.min(640, Math.ceil(camera.position.distanceTo(camera.target) * 1.5 / 10) * 10))
    const texel = extent / 2048, focus = camera.target.clone()
    focus.set(Math.round(focus.x / texel) * texel, Math.round(focus.y / texel) * texel, Math.round(focus.z / texel) * texel)
    const key = `${extent}:${focus.toArray()}`
    if (sun.userData.focusKey === key) return
    sun.userData.focusKey = key
    sun.position.copy(focus).add(new Vector3(-180, 270, 190)); sun.lookAt(focus)
    sun.shadowFrustum = extent; sun.shadowNear = extent <= 100 ? 100 : 1; sun.shadowFar = Math.max(600, extent + 380)
    sun.shadowNormalBias = Math.max(.06, texel * 1.2); sun.setDirty()
  }
  try {
    await viewer.setEnvironmentMap(new URL('assets/environments/grant-street/street.hdr', base).href)
    viewer.scene.environmentRotation.y = generated.photoStudies?.[0]?.yaw || 0
    sun.castShadow = true; sun.shadowMapSize.set(2048, 2048); sun.shadowBias = -.0002; lights.add(sun)
    for (const [color, intensity, position] of [[0xffefd6,.625,[-1,2,-1]],[0xb8d4ff,.3,[1,1,1]],[0xdbe6ff,.125,[-1,1,1]]]) {
      const light = new DirectionalLight(color, intensity); light.position.set(...position); lights.add(light)
    }
    const ao = await viewer.addPlugin(SSAOPlugin); ao.pass.intensity = .35; ao.pass.occlusionWorldRadius = 1.2
    viewer.timeline.endTime = 0
    preflight = await createStaticTilePreflight(manifest, base, viewer.assetManager.importer)
    adapter = createKiteTileAdapter(viewer, manifest, root, {...preflight, materialPool: pool, batch: true})
    groundAdapter = createKiteTileAdapter(viewer, manifest, pinnedRoot, preflight)
    pinnedAdapter = createKiteTileAdapter(viewer, manifest, pinnedRoot, {...preflight, validateFeature: preflight.validatePinnedFeature})
    const signal = pending.signal
    ground = await groundAdapter.load('terrain', {featureIds: [selection.terrain.id]}, signal); groundAdapter.attach(ground)
    pinned = await pinnedAdapter.load('authored', {featureIds: selection.pinned.map(f => f.id)}, signal); pinnedAdapter.attach(pinned)
    // This frozen candidate contains ONLY the tested five owner groups. No new city area is admitted.
    const treesByOwner = new Map()
    for (const feature of selection.chosen.filter(feature => feature.id.startsWith('sf-tree:'))) {
      if (!treesByOwner.has(feature.ownerTile)) treesByOwner.set(feature.ownerTile, [])
      treesByOwner.get(feature.ownerTile).push(feature)
    }
    const detailForTile = (id, tile, targetDistance, previous) => {
      const trees = treesByOwner.get(id)
      if (!trees?.length) return 'near'
      const distance = Math.min(...trees.map(({worldBounds: {min, max}}) => Math.hypot(
        Math.max(min[0] - camera.position.x, 0, camera.position.x - max[0]),
        Math.max(min[1] - camera.position.y, 0, camera.position.y - max[1]),
        Math.max(min[2] - camera.position.z, 0, camera.position.z - max[2]))))
      return treeDetailAtDistance(distance, previous)
    }
    controller = createTileStreaming(manifest, adapter, {
      nearRadius: 180, retainRadius: 240, maxNearTiles: 5,
      maxResidentTiles: 6, maxTriangles: 270000, maxBytes: 34 * 1024 * 1024, maxDrawCalls: 3420,
      activeBudget: {maxResidentTiles: 5, maxTriangles: 185000, maxBytes: 26 * 1024 * 1024, maxDrawCalls: 2100},
      pinnedCost: coverage.pinnedCost, detailForTile,
    })
    const views = {
      overview: [[-180,125,-50],[-65,15,-180]],
      north: [[-130,34,-160],[-65,12,-210]],
      park: [[-110,25,-45],[-65,16,-110]],
      wide: [[-380,280,220],[-65,15,-180]],
    }
    function view(name) { camera.controls?.stopDamping?.(); camera.position.fromArray(views[name][0]); camera.target.fromArray(views[name][1]); camera.setDirty(); controller.update(camera.target); viewer.setDirty() }
    for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => view(button.dataset.view)
    document.querySelector('#retry-tiles').onclick = () => { for (const id of Object.keys(controller.state.errors)) controller.retry(id) }
    const svg = document.querySelector('#coverage-map'), ns = 'http://www.w3.org/2000/svg'
    function rect(parent, bounds, fill) {
      const element = document.createElementNS(ns, 'rect')
      for (const [key,value] of Object.entries({x:bounds.min[0], y:bounds.min[2], width:bounds.max[0]-bounds.min[0], height:bounds.max[2]-bounds.min[2], fill})) element.setAttribute(key, value)
      parent.append(element)
    }
    svg.setAttribute('viewBox', coverage.viewBox.join(' '))
    // Render each source mask separately. Never fill the bounding-box gaps of their union.
    for (const bounds of coverage.sourceMasks) rect(svg, bounds, '#3f5061')
    const available = document.createElementNS(ns,'g'), loaded = document.createElementNS(ns,'g')
    svg.append(available,loaded)
    for (const feature of selection.chosen) rect(available,feature.worldBounds,'#9c803e')
    const point = document.createElementNS(ns,'circle'); point.setAttribute('r','4'); point.setAttribute('fill','#fff'); svg.append(point)
    let previous = ''
    function update() {
      if (stopped) return
      controller.update(camera.target)
      const state = controller.state, signature = JSON.stringify(state)
      point.setAttribute('cx',camera.target.x); point.setAttribute('cy',camera.target.z)
      if (signature !== previous) {
        previous = signature; loaded.replaceChildren()
        const residents = new Set(state.resident)
        const features = selection.chosen.filter(f => residents.has(f.ownerTile))
        for (const feature of features) rect(loaded,feature.worldBounds,'#69bba1')
        document.querySelector('#residency').textContent = `${features.length} models loaded${state.running ? ` · Loading ${state.running} areas` : ''}${Object.keys(state.errors).length ? ' · Some areas failed; retry below' : ''}`
        document.querySelector('#budget-status').textContent = `${features.length}/${selection.chosen.length} selected features; ${Object.keys(state.blocked || {}).length} owner groups limited by budget. Tree detail follows camera distance with hysteresis; pinned authored trees stay unchanged. ${Object.entries(state.details || {}).map(([id,detail]) => `${id}: ${detail}`).join(', ')}`
        document.querySelector('#retry-tiles').hidden = !Object.keys(state.errors).length
        document.querySelector('#tile-errors').textContent = Object.entries(state.errors).map(([id,error]) => `${id}: ${error}`).join('\n')
        viewer.setDirty()
      }
      const inside = selection.chosen.some(f => camera.target.x >= f.worldBounds.min[0] && camera.target.x <= f.worldBounds.max[0] && camera.target.z >= f.worldBounds.min[2] && camera.target.z <= f.worldBounds.max[2])
      document.querySelector('#outside').hidden = inside
    }
    document.querySelector('#scope').textContent = `${coverage.bakedFeatures} baked candidate features; ${selection.chosen.length} eligible features in this viewer, ${selection.pinned.length} pinned authored trees and one terrain mesh. Other city models are unavailable here.`
    inspect = () => ({active:!stopped, renderedFrames, camera:{position:camera.position.toArray(),target:camera.target.toArray()}, tiles:controller.state, materialPool:pool.state, sources:adapter.state, gpuCounts:{...viewer.renderManager.webglRenderer.info.memory}, canvas:[viewer.canvas.width,viewer.canvas.height]})
    view('overview'); viewer.addEventListener('preFrame',updateShadow); updateShadow(); update(); timer = setInterval(update, 200)
    // Loading does not await GPU frames while createGame renderDuringLoad is false.
    for (let n = 0; controller.state.running && n < 1800; n++) {
      if (signal.aborted) throw Error('Candidate load interrupted')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (signal.aborted) throw Error('Candidate load interrupted')
    if (controller.state.running) throw Error('Candidate loading timed out')
    update()
    return cleanup
  } catch (error) { cleanup(); throw error }
}
