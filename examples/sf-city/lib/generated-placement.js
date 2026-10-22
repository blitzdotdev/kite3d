// Only untouched references to the baked, untextured asset kit may use simplified batching.
export function isGeneratedPlacement(node, placement, registry) {
  if (!placement?.asset.startsWith('assets/models/city/') || !node.visible) return false
  const current = node.userData?.rootPath
  if (!current || current !== node.userData?.cityGenerated?.rootPath) return false
  const match = /^\/kite3d\/@([^/]+)\/f\.gltf$/.exec(current)
  const entry = match && registry.files?.[match[1]]
  return entry?.path === placement.asset && (!entry.files || entry.files['f.gltf'] === placement.asset)
}
