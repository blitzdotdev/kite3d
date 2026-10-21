import {Group, InstancedMesh2, Mesh2, mergeGeometries} from 'threepipe'

export async function main({viewer}) {
  const previousViewer = window.viewer
  window.viewer = viewer
  const camera = viewer.scene.mainCamera
  const saved = {position: camera.position.clone(), target: camera.target.clone()}
  const manifest = await fetch(new URL('./scene/generated.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error('Unable to load SF city manifest')
    return r.json()
  })

  // Runtime-only batching. The saved scene retains every individually editable feature.
  viewer.scene.modelRoot.updateMatrixWorld(true)
  const buckets = new Map(), surfaces = new Map(), hidden = []
  const placementById = new Map(manifest.placements.map((p) => [p.id, p]))
  const seenFeatures = new Set()
  viewer.scene.modelRoot.traverse((node) => {
    const placement = placementById.get(node.userData?.cityId)
    if (!placement || !placement.asset.startsWith('assets/models/city/') || !node.visible) return
    if (seenFeatures.has(placement.id)) return
    seenFeatures.add(placement.id)
    const tree = node.userData.city?.kind === 'tree'
    const children = []
    node.traverse((child) => { if (child.isMesh) children.push(child) })
    if (!children.length || children.some((child) => Array.isArray(child.material))) return
    children.forEach((child) => {
      if (tree) {
        const key = `${child.geometry.uuid}:${child.material.uuid}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(child)
      } else {
        const m = child.material
        // The baked placeholder materials have no textures or custom shader extensions.
        const key = `${placement.tile}:${JSON.stringify([m.type, m.color?.toArray(), m.roughness, m.metalness, m.side])}`
        if (!surfaces.has(key)) surfaces.set(key, {material: m, geometries: []})
        const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()
        geometry.applyMatrix4(child.matrixWorld)
        surfaces.get(key).geometries.push(geometry)
      }
    })
    hidden.push(node)
  })
  const runtime = new Group()
  runtime.name = 'SF runtime batches'
  const ownedGeometry = []
  for (const {material, geometries} of surfaces.values()) {
    const merged = mergeGeometries(geometries, false)
    geometries.forEach((geometry) => geometry.dispose())
    if (!merged) throw new Error('Unable to batch generated city surfaces')
    ownedGeometry.push(merged)
    runtime.add(new Mesh2(merged, material))
  }
  for (const meshes of buckets.values()) {
    const first = meshes[0]
    const batch = new InstancedMesh2(first.geometry, first.material, meshes.length)
    meshes.forEach((mesh, index) => batch.setMatrixAt(index, mesh.matrixWorld))
    batch.instanceMatrix.needsUpdate = true
    batch.computeBoundingBox(); batch.computeBoundingSphere()
    runtime.add(batch)
  }
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
    <div style="color:#c0cbc5;margin-top:8px">Real city geometry. First-pass procedural surfaces.</div>
    <div data-bookmarks style="display:flex;gap:6px;margin-top:12px"></div>
    <div style="font-size:10px;color:#a8beb5;margin-top:10px">© City and County of San Francisco / DataSF · PDDL<br>Terrain from city ground samples. Facades and tree sizes inferred.</div>`
  hud.append(panel)
  document.body.append(hud)
  const views = [
    {name: 'Overview', position: [350, 300, 440], target: [0, 15, 0]},
    {name: 'Park edge', position: [45, 52, 60], target: [-80, 15, -65]},
    {name: 'Hill', position: [225, 108, 40], target: [155, 40, -90]},
  ]
  function view(index) {
    const v = views[index]
    camera.position.set(...v.position); camera.target.set(...v.target)
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
  resize(); view(0)
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', resize)
    window.removeEventListener('keydown', keydown)
    hud.remove()
    runtime.removeFromParent()
    // InstancedMesh.dispose releases its instance buffers, not the shared source geometry/material.
    ;[...runtime.children].forEach((mesh) => mesh.dispose())
    ownedGeometry.forEach((geometry) => geometry.dispose())
    hidden.forEach((node) => { node.visible = true })
    camera.position.copy(saved.position); camera.target.copy(saved.target)
    camera.setDirty({change: 'transform'})
    window.viewer = previousViewer
    viewer.setDirty()
  }
}
