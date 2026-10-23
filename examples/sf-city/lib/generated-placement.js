// Static batches must respect inherited visibility and authored animation/components.
function staticVisible(node) {
  for (let current = node; current; current = current.parent) {
    if (current.visible === false || current.animations?.length) return false
    if (Object.keys(current.userData?.EntityComponentPlugin || {}).length) return false
  }
  return true
}
// Only untouched references to the baked asset kit may use runtime batching.
export function isGeneratedPlacement(node, placement, registry) {
  if (!placement?.baked || !staticVisible(node)) return false
  const current = node.userData?.rootPath
  if (!current || current !== node.userData?.cityGenerated?.rootPath) return false
  const match = /^\/kite3d\/@([^/]+)\/f\.gltf$/.exec(current)
  const entry = match && registry.files?.[match[1]]
  return entry?.path === placement.asset && (!entry.files || entry.files['f.gltf'] === placement.asset)
}

// Hide only leaf meshes emitted by the baker. Authored siblings and descendants stay live.
export function bakedMeshes(node, placement) {
  const meshes = []
  node.traverse(root => {
    if (root.userData?.cityBakedAsset !== placement.asset) return
    for (const child of root.children) {
      if (child.isMesh && child.userData?.cityBakedPart === true && !child.children.length &&
          staticVisible(child) && !Array.isArray(child.material)) meshes.push(child)
    }
  })
  return meshes
}
