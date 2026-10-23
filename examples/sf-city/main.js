import {createGeometryKey, createRuntimeMaterialPool} from './lib/batch-keys.js'
import {isGeneratedPlacement, bakedMeshes} from './lib/generated-placement.js'
import {Group, InstancedMesh2, Mesh2, mergeGeometries, DirectionalLight2, SSAOPlugin, Float32BufferAttribute} from 'threepipe'

export async function main({viewer}) {
  // Avoid rendering thousands of authored meshes while fetching the manifest and
  // preparing batches. Always restore rendering, including interrupted startup.
  const renderingWasEnabled = viewer.renderEnabled
  viewer.renderEnabled = false
  let ownedEnvironment = null, ownedMaterialPool = null, started = false
  const savedEnvironmentRotation = viewer.scene.environmentRotation?.clone()
  try {
  const previousViewer = window.viewer
  window.viewer = viewer
  const camera = viewer.scene.mainCamera
  const saved = {position: camera.position.clone(), target: camera.target.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, view: camera.view ? {...camera.view} : null}
  const [manifest, registry] = await Promise.all(['./scene/generated.json', './assets.json'].map(path =>
    fetch(new URL(path, import.meta.url)).then(r => {
      if (!r.ok) throw new Error(`Unable to load SF city data: ${path}`)
      return r.json()
    })))

  if(!viewer.scene.environment && manifest.photoStudies?.length){
    ownedEnvironment = await viewer.setEnvironmentMap(new URL('./assets/environments/grant-street/street.hdr', import.meta.url).href)
    if(viewer.scene.environmentRotation)viewer.scene.environmentRotation.y=manifest.photoStudies[0].yaw || 0
  }

  // Runtime-only batching. The saved scene retains every individually editable feature.
  viewer.scene.modelRoot.updateMatrixWorld(true)
  const buckets = new Map(), surfaces = new Map(), hidden = []
  const placementById = new Map(manifest.placements.map((p) => [p.id, p]))
  const seenFeatures = new Set()
  const materialPool = ownedMaterialPool = createRuntimeMaterialPool()
  const materialKey = materialPool.keyForMaterial, geometryKey = createGeometryKey()
  const sourceMaterials = new Set()
  viewer.scene.modelRoot.traverse(node => {
    if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) sourceMaterials.add(material)
  })
  await materialPool.prepare(sourceMaterials)
  viewer.scene.modelRoot.traverse((node) => {
    const placement = placementById.get(node.userData?.cityId)
    if (!isGeneratedPlacement(node, placement, registry)) return
    if (seenFeatures.has(placement.id)) return
    seenFeatures.add(placement.id)
    const tree = node.userData.city?.kind === 'tree'
    const children = bakedMeshes(node, placement)
    if (!children.length || children.some((child) => Array.isArray(child.material))) return
    children.forEach((child) => {
      if (tree) {
        const key = `${geometryKey(child.geometry)}:${materialKey(child.material)}:${child.castShadow}:${child.receiveShadow}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(child)
      } else {
        const m = child.material
        // Compare complete material state, including texture sampling and source URLs.
        const key = `${placement.tile}:${materialKey(m)}`
        if (!surfaces.has(key)) surfaces.set(key, {material: m, geometries: []})
        const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()
        if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
        geometry.applyMatrix4(child.matrixWorld)
        surfaces.get(key).geometries.push(geometry)
      }
    })
    hidden.push(...children)
  })
  const runtime = new Group()
  runtime.name = 'SF runtime batches'
  runtime.userData.cityBatchStats = materialPool.stats
  const lightState = []
  viewer.scene.modelRoot.traverse(node => {
    if (node.isLight && node.userData?.cityId?.startsWith('sf-light:')) { lightState.push([node, node.intensity]); node.intensity *= 0.25 }
  })
  const ownedGeometry = []
  for (const {material, geometries} of surfaces.values()) {
    const merged = mergeGeometries(geometries, false)
    geometries.forEach((geometry) => geometry.dispose())
    if (!merged) throw new Error('Unable to batch generated city surfaces')
    ownedGeometry.push(merged)
    const mesh = new Mesh2(merged, materialPool.get(material))
    // The WebGL depth shadow pass treats transmissive glass as opaque. Clear
    // generated panes must not black out the recessed shop interiors behind them.
    // This is a clear-glass approximation, not refractive shadow/caustic tracing.
    mesh.castShadow = !(material.transmission >= 0.95); mesh.receiveShadow = true
    runtime.add(mesh)
  }
  for (const meshes of buckets.values()) {
    const first = meshes[0]
    const batch = new InstancedMesh2(first.geometry, materialPool.get(first.material), meshes.length)
    meshes.forEach((mesh, index) => batch.setMatrixAt(index, mesh.matrixWorld))
    batch.instanceMatrix.needsUpdate = true
    batch.computeBoundingBox(); batch.computeBoundingSphere()
    batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow
    runtime.add(batch)
  }
  // Fixed-camera reference comparison favored neutral daylight over the prior
  // strong yellow tint. Keep exposure and owner environment intensity unchanged.
  const sun = new DirectionalLight2('#ffffff', 3.2)
  sun.name = 'City afternoon sun'
  sun.position.set(-180, 270, 190); sun.lookAt(0, 0, 0)
  sun.castShadow = true; sun.shadowMapSize.set(2048, 2048)
  sun.shadowFrustum = 640; sun.shadowNear = 1; sun.shadowFar = 1000
  sun.shadowBias = -0.0002; sun.shadowNormalBias = 0.06
  const sunOffset=sun.position.clone()
  let shadowFocusKey=''
  function focusShadows(){
    const extent=Math.max(100,Math.min(640,Math.ceil(camera.position.distanceTo(camera.target)*1.5/10)*10))
    const texel=extent/2048,focus=camera.target.clone()
    focus.set(Math.round(focus.x/texel)*texel,Math.round(focus.y/texel)*texel,Math.round(focus.z/texel)*texel)
    const key=[extent,...focus.toArray()].join(',')
    if(key===shadowFocusKey)return
    shadowFocusKey=key
    sun.position.copy(focus).add(sunOffset);sun.lookAt(focus)
    sun.shadowFrustum=extent;sun.shadowNear=extent<=100?100:1;sun.shadowFar=Math.max(600,extent+380)
    sun.shadowNormalBias=Math.max(.06,texel*1.2);sun.setDirty()
  }
  runtime.add(sun)
  const ownedAO = !viewer.getPlugin(SSAOPlugin)
  const ao = ownedAO ? await viewer.addPlugin(SSAOPlugin) : viewer.getPlugin(SSAOPlugin)
  if (ownedAO) { ao.pass.intensity = 0.35; ao.pass.occlusionWorldRadius = 1.2 }
  hidden.forEach((node) => { node.visible = false })
  runtime.userData.excludeFromExport = true
  viewer.scene.addObject(runtime, {addToRoot: true})

  const hud = document.createElement('div')
  hud.dataset.sfCity = 'hud'
  hud.style.cssText = 'position:fixed;pointer-events:none;z-index:20;font:12px/1.5 system-ui;color:#e9ece7;'
  const panel = document.createElement('div')
  panel.style.cssText = 'position:absolute;left:18px;top:18px;max-width:340px;padding:16px 18px;background:#172c2eea;border:1px solid #71898466;border-radius:12px;box-shadow:0 8px 35px #0003;pointer-events:auto;'
  panel.innerHTML = `<div style="font-size:10px;letter-spacing:2px;color:#b9d3bd">KITE3D / CITY LAB</div>
    <div style="font-size:23px;font-weight:650;margin:5px 0">North Beach, San Francisco</div>
    <div>${manifest.stats.buildings} buildings · ${manifest.stats.roads} streets · ${manifest.stats.trees} mapped trees</div>
    <div style="color:#c0cbc5;margin-top:8px">Mapped layout. Procedural curbs, facades and trees.</div>
    <div data-bookmarks style="display:flex;gap:6px;margin-top:12px"></div>
    <div style="font-size:10px;color:#a8beb5;margin-top:10px">© City and County of San Francisco / DataSF · PDDL<br><a href="https://github.com/bmwcarit/digital-car-3d" target="_blank" rel="noopener" style="color:inherit">BMW Car IT</a> / <a href="https://sketchfab.com/DanielZhabotinsky" target="_blank" rel="noopener" style="color:inherit">Daniel Zhabotinsky</a> models: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:inherit">CC BY 4.0</a>.<br>Terrain from city ground samples. Curb shapes and tree sizes inferred.<br>Drag to orbit · Scroll to zoom · Keys 1–4 for views.</div>`
  hud.append(panel)
  document.body.append(hud)
  const views = [
    {name: 'Overview', position: [350, 300, 440], target: [0, 15, 0]},
    {name: 'Park edge', position: [45, 52, 60], target: [-80, 15, -65]},
    {name: 'Hill', position: [225, 108, 40], target: [155, 40, -90]},
    ...(manifest.views || []),
  ]
  function view(index) {
    const v = views[index]
    camera.controls?.stopDamping?.()
    camera.position.set(...v.position); camera.target.set(...v.target)
    camera.lookAt(camera.target)
    camera.fov = v.fov || saved.fov
    if(v.projectionShift){
      const width=viewer.canvas.clientWidth, height=viewer.canvas.clientHeight
      camera.setViewOffset(width,height,0,-v.projectionShift*height/2,width,height)
    }else{camera.view=saved.view ? {...saved.view} : null;camera.updateProjectionMatrix()}
    camera.setDirty({change: 'transform'})
    viewer.setDirty()
  }
  views.forEach((v, i) => {
    const button = document.createElement('button')
    button.textContent = `${i + 1} ${v.name}`
    button.style.cssText = 'font:inherit;color:inherit;border:1px solid #93b0a466;background:#d5e5d511;border-radius:6px;padding:5px 8px;cursor:pointer'
    button.addEventListener('click', () => view(i))
    panel.querySelector('[data-bookmarks]').append(button)
  })
  const resize = () => {
    const r = viewer.canvas.getBoundingClientRect()
    Object.assign(hud.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`})
  }
  const keydown = (event) => {
    if (/INPUT|TEXTAREA/.test(event.target?.tagName || '')) return
    const index = Number(event.key) - 1
    if (index >= 0 && index < views.length) view(index)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(viewer.canvas)
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', keydown)
  camera.addEventListener('cameraUpdate',focusShadows)
  resize(); view(0)
  started = true
  return async () => {
    observer.disconnect()
    camera.removeEventListener('cameraUpdate',focusShadows)
    window.removeEventListener('resize', resize)
    window.removeEventListener('keydown', keydown)
    hud.remove()
    if(ownedEnvironment && viewer.scene.environment===ownedEnvironment){viewer.scene.environment=null;if(savedEnvironmentRotation)viewer.scene.environmentRotation.copy(savedEnvironmentRotation)}
    if (ownedAO) await viewer.removePlugin(ao)
    lightState.forEach(([light, intensity]) => { light.intensity = intensity; light.setDirty?.() })
    runtime.removeFromParent()
    // InstancedMesh.dispose releases its instance buffers, not the shared source geometry/material.
    ;[...runtime.children].forEach((mesh) => mesh.dispose?.())
    ownedGeometry.forEach((geometry) => geometry.dispose())
    materialPool.dispose()
    hidden.forEach((node) => { node.visible = true })
    camera.position.copy(saved.position); camera.target.copy(saved.target)
    camera.quaternion.copy(saved.quaternion)
    camera.fov=saved.fov;camera.view=saved.view ? {...saved.view} : null;camera.updateProjectionMatrix()
    camera.setDirty({change: 'transform'})
    window.viewer = previousViewer
    viewer.setDirty()
  }
  } finally {
    if (!started) ownedMaterialPool?.dispose()
    if(!started && ownedEnvironment && viewer.scene.environment===ownedEnvironment){viewer.scene.environment=null;if(savedEnvironmentRotation)viewer.scene.environmentRotation.copy(savedEnvironmentRotation)}
    viewer.renderEnabled = renderingWasEnabled
    viewer.setDirty()
  }
}
