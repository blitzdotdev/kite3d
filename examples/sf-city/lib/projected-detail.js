// Conservative screen-space gate for the inspected trim-only building variant.
// CSS viewport pixels match the visual comparison; this is not a metre cutoff.
export function projectedBoundsSpan(bounds, camera, width, height) {
  if (!(width > 0 && height > 0) || !bounds?.min || !bounds?.max) return Infinity
  camera.updateMatrixWorld(true)
  const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements
  const multiply = (m, p) => [0,1,2,3].map(row => m[row]*p[0]+m[4+row]*p[1]+m[8+row]*p[2]+m[12+row]*p[3])
  const points=[], eyePoints=[]
  for (const x of [bounds.min[0],bounds.max[0]]) for (const y of [bounds.min[1],bounds.max[1]]) for (const z of [bounds.min[2],bounds.max[2]]) {
    const eye=multiply(view,[x,y,z,1])
    eyePoints.push(eye)
  }
  if (eyePoints.every(eye => -eye[2] <= camera.near)) return 0
  // An eye/near-plane crossing must retain detail, not wrap projected corners.
  if (eyePoints.some(eye => -eye[2] <= camera.near)) return Infinity
  for (const eye of eyePoints) {
    const clip=multiply(projection,eye)
    if (!(clip[3] > 0)) return Infinity
    points.push([clip[0]/clip[3]*width/2,clip[1]/clip[3]*height/2])
  }
  if ([0,1].some(axis => points.every(p => p[axis] < -(axis ? height : width)/2) || points.every(p => p[axis] > (axis ? height : width)/2))) return 0
  return Math.max(...[0,1].map(axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]))))
}
export function buildingGroupDetail(features, camera, width, height, previous='near') {
  const buildings=features.filter(f=>f.id.startsWith('sf-building:'))
  if (!buildings.length) return previous
  const span=Math.max(...buildings.map(f=>projectedBoundsSpan(f.worldBounds,camera,width,height)))
  // A whole group stays near if any building requires it. Admission may defer
  // promotion, but must retain the distant baseline and disclose that limitation.
  return previous==='far' ? (span>=75?'near':'far') : (span<=60?'far':'near')
}
