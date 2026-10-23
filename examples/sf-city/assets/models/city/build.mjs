import {broadleafGeometry} from './tree-geometry.mjs'
import {washingtonSquare,parkBoundary} from './washington-square.mjs'
import {churchParts} from './church.mjs'
import {siteTree} from './tree-siting.mjs'
import {streetFurniture} from './furniture.mjs'
import {bakeBuildingMaterials, buildingResources, metricUV} from './building-materials.mjs'
import {grantContext} from './grant-context.mjs'
import {grantBackground} from './grant-background.mjs'
import {photoFacade, retainedWalls} from './photo-facade.mjs'
import {bakeGroundMaterials, groundMaterial, groundResources} from './materials.mjs'
import {foliageTexture, palmCrown} from './foliage.mjs'
import {facadeKit} from './facade-kit.mjs'
import {strip, corridors, clipped, crossingLift} from './streets.mjs'
import {THREE, material, surface, asset} from './mesh.mjs'
import {area, bounds, loadCity, elevation, hash, write, xy, polygonArea} from '../../../scene/data.mjs'

const GENERATOR_VERSION = 5
bakeGroundMaterials()
bakeBuildingMaterials()
const city = loadCity()
const {ground} = elevation(city)
const roadCorridors = corridors(city.roads)
const outerCorridors = corridors(city.roads.map(r => ({...r, width: r.width + 2 * r.sidewalk})))
const placements = [], collisions = [], tiles = {}, photoStudies = []
const palette = ['#dfd6bd', '#bdcfcb', '#d8c2ad', '#a9b9bf', '#d1b8ab', '#ddd2b4', '#adc0ad', '#c4c4bc', '#b5b1a7', '#d4cabd']
const dark = material('Window glass approximation', '#314959', 0.3, 0.25)
const roof = material('Flat roof', '#737670')
const trim = material('Painted trim', '#e2dcd0')
const seed = (id) => parseInt(hash(id).slice(0, 8), 16) / 2 ** 32

function record(feature, generated, position, extra = {}) {
  const tile = extra.tile || `${Math.floor(position[0] / area.tileSizeM)}_${Math.floor(position[2] / area.tileSizeM)}`
  const p = {id: feature.id, sourceId: feature.sourceId, name: feature.name || feature.id,
    asset: feature.asset || generated.path, baked: !feature.asset, position, tile, ...extra,
    triangles: generated.triangles || 0, sourceHash: hash(feature)}
  placements.push(p)
  ;(tiles[tile] ||= []).push(feature.id)
}

function building(feature) {
  if(feature.patch.photoFacade?.flattenCorner){
    // Reversible photo-estimated visual override, never a mutation of the source snapshot.
    const polygons=feature.polygons.map(p=>p.map(r=>r.map(v=>[...v]))),ring=polygons[0][0],end=ring[28],north=ring[29]
    const length=Math.hypot(end[0]-north[0],end[1]-north[1]),u=[(end[0]-north[0])/length,(end[1]-north[1])/length],out=[-u[1],u[0]]
    for(let i=23;i<28;i++){const z=Math.min(0,(ring[i][0]-end[0])*out[0]+(ring[i][1]-end[1])*out[1]);ring[i]=[end[0]+out[0]*z,end[1]+out[1]*z]}
    feature={...feature,polygons,footprintCorrection:'Photo-estimated flattened south corner; original DataSF footprint retained in source snapshot'}
  }
  const [cx, cz] = feature.center
  const groundCorners = feature.polygons.flatMap((p) => p[0].map(([x, z]) => ground(x, z)))
  const base = ground(cx, cz), bottom = Math.min(...groundCorners) - 0.6
  const height = feature.height
  const top = base + height
  let color = feature.facadeColor || palette[Math.floor(seed(feature.id) * palette.length)]
  const landmark=feature.id==='sf-building:201006.0001265'
  const family=landmark?'stone':height>26?'masonry':['timber','stucco','masonry'][Math.floor(seed(feature.id+'family')*3)]
  if(!feature.facadeColor&&family==='masonry')color=['#a77662','#bc9480','#9c8073','#c8bba5'][Math.floor(seed(feature.id+'brick')*4)]
  if(landmark)color='#ded8c8'
  feature={...feature, family}
  const materials = [material('SF '+family, color), structuredClone(roof), structuredClone(dark), structuredClone(trim),
    material('Shopfront paint', ['#304f47','#733f35','#263e4a'][Math.floor(seed(feature.id+'shop')*3)]), material('Glazing sky reflection', '#819aab', 0.24, 0.2), material('Varied interior blinds', '#b2ad96',.95)]
  if(landmark){materials[2]=material('Church recessed openings','#171c20',.7);materials[4]=material('Church timber doors','#514131',.8)}
  const parts = []
  const photo = photoFacade(feature, ground, base, top, bottom, materials.length)
  if(photo){materials.push(...photo.materials);photoStudies.push(photo)}
  let polygonIndex = 0
  for (const polygon of feature.polygons) {
    if (polygonArea(polygon[0]) < 2) continue
    const shape = new THREE.Shape(polygon[0].map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz))))
    for (const hole of polygon.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)))))
    const body = new THREE.ExtrudeGeometry(shape, {depth: top - bottom, bevelEnabled: false, steps: 1, curveSegments: 1})
    body.rotateX(-Math.PI / 2); body.translate(0, bottom - base, 0)
    if(photo){const cap=body.groups[0];body.setIndex(Array.from({length:cap.count},(_,i)=>cap.start+i));body.clearGroups()}
    parts.push({name: `Footprint ${polygonIndex++}`, geometry: body, mat: photo ? 1 : [1, 0]})
  }
  if(landmark)parts.push(...churchParts(feature,base,ground))
  else if(feature.patch.photoContext)parts.push(...grantContext(feature,city,base))
  else parts.push(...facadeKit(feature, city.roads, ground, base, photo ? photo.edge : -1))
  if(photo)parts.push(...retainedWalls(feature, photo, base, bottom, top),...photo.parts)

  if(!photo&&!landmark){
    const ring=feature.polygons[0][0];let contains=false
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>cz)!==(b[1]>cz)&&cx<(b[0]-a[0])*(cz-a[1])/(b[1]-a[1])+a[0])contains=!contains}
    if(contains&&height>5){
      parts.push({name:'Inferred rooftop service enclosure',geometry:new THREE.BoxGeometry(1.8,.65,1.2).translate(0,height+.325,0),mat:1})
      parts.push({name:'Inferred rooftop vent',geometry:new THREE.CylinderGeometry(.16,.16,.8,8).translate(.55,height+.9,0),mat:3})
    }
  }
  const resources=photo?.resources || buildingResources(family,materials)
  if(!photo)for(const part of parts)metricUV(part.geometry)
  const id = feature.id.replace(':', '-')
  const generated = asset(`assets/models/city/buildings/${id}`, parts, materials,
    {name: `Building ${feature.sourceId}`, cityId: feature.id, heightSource: feature.heightSource, ...(photo ? {photoFacade:photo.provenance} : {})}, resources)
  record({...feature, name: `Building ${feature.sourceId}`}, generated, [cx, base, cz],
    {kind: 'building', footprintCorrection: feature.footprintCorrection, heightM: height, heightSource: feature.heightSource, architecturalFamily: family, landmarkSource: landmark ? 'scene/sources/park-landmark-provenance.json' : undefined, visualSpireHeightM: landmark ? 58.2168 : undefined, facadeSource: landmark ? 'Original approximate church silhouette from published dimensions and inspected facade photograph; hidden sides and detail inferred' : photo ? 'Partial photo-derived Grant frontage; inferred offset; footprint correction explicitly recorded when enabled' : feature.patch.photoContext ? 'Photo-estimated Grant background north elevation; mapped footprint and height retained, openings not surveyed' : 'authored SF-inspired bay, cornice and storefront modules; inferred assignment',
      sourceDataset: 'ynuv-fyni'})
  collisions.push({id: feature.id, polygons: feature.polygons, bottomM: bottom, topM: top,
    type: 'footprint-prism', integratedPhysics: false})
}

function clip(a, b) {
  let low = 0, high = 1
  const dx = b[0] - a[0], dz = b[1] - a[1]
  for (const [p, q] of [[-dx, a[0] - bounds[0]], [dx, bounds[2] - a[0]], [-dz, a[1] - bounds[1]], [dz, bounds[3] - a[1]]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t)
    if (low > high) return null
  }
  return [[a[0] + low * dx, a[1] + low * dz], [a[0] + high * dx, a[1] + high * dz]]
}

function road(feature) {
  const points = [], triangles = [], walks = [], wt = [], paint = [], pt = [], curbs = [], ct = [], gutters = [], gt = []
  let asphaltMasks = []
  const strips = (target, tris, a, b, left, right, lift, step = 1) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.01) return
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len
    const count = Math.ceil(len / step)
    for (let k = 0; k < count; k++) {
      const polygon = [[k / count, left], [k / count, right], [(k + 1) / count, right], [(k + 1) / count, left]]
        .map(([t, off]) => [a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + nz * off])
      for (const part of (target === points || target === paint) ? clipped(polygon, asphaltMasks) : [polygon]) {
        const v = target.length
        part.forEach(([x, z]) => target.push([x, ground(x, z) + lift, z]))
        for (let j = 1; j + 1 < part.length; j++) tris.push([v, v + j, v + j + 1])
      }
    }
  }
  const half = feature.width / 2
  for (let i = 1; i < feature.points.length; i++) {
    const pair = clip(feature.points[i - 1], feature.points[i])
    if (!pair) continue
    const [a, b] = pair, len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const corridorIndex = roadCorridors.findIndex(s => s.id === feature.id && s.index === i - 1)
    asphaltMasks = roadCorridors.slice(0, corridorIndex)
    strips(points, triangles, a, b, -half, half, 0.07)
    const masks = roadCorridors.filter(s => s.id !== feature.id || s.index !== i - 1)
    const count = Math.ceil(len)
    const interpolate = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (feature.sidewalk > 0) {
      for (let k = 0; k < count; k++) {
        const start = interpolate(k / count), end = interpolate((k + 1) / count)
        for (const [left, right] of [[-half - feature.sidewalk, -half], [half, half + feature.sidewalk]]) {
          for (const polygon of clipped(strip(start, end, left, right), [...masks, ...outerCorridors.slice(0, corridorIndex)])) {
            const v = walks.length
            polygon.forEach(p => walks.push([p[0], ground(...p) + crossingLift(p, masks), p[1]]))
            for (let j = 1; j + 1 < polygon.length; j++) wt.push([v, v + j, v + j + 1])
            for (let j = 0; j < polygon.length; j++) {
              const p = polygon[j], q = polygon[(j + 1) % polygon.length]
              const offset = r => Math.abs(((b[0] - a[0]) * (r[1] - a[1]) - (b[1] - a[1]) * (r[0] - a[0])) / len)
              // Only the carriageway-facing edge gets a curb; cell seams stay open.
              if (Math.abs(offset(p) - half) > 1e-5 || Math.abs(offset(q) - half) > 1e-5) continue
              const c = curbs.length
              curbs.push([p[0], ground(...p) + 0.07, p[1]], [q[0], ground(...q) + 0.07, q[1]],
                [q[0], ground(...q) + crossingLift(q, masks), q[1]], [p[0], ground(...p) + crossingLift(p, masks), p[1]])
              ct.push([c, c + 1, c + 2], [c, c + 2, c + 3])
            }
          }
        }
        for (const [left, right] of [[-half, -half + 0.3], [half - 0.3, half]]) {
          for (const polygon of clipped(strip(start, end, left, right), masks)) {
            const v = gutters.length
            polygon.forEach(p => gutters.push([p[0], ground(...p) + 0.075, p[1]]))
            for (let j = 1; j + 1 < polygon.length; j++) gt.push([v, v + j, v + j + 1])
          }
        }
      }
    }
    if (feature.width >= 8) {
      for (let s = 9; s + 3 < len - 9; s += 8) {
        const p = [a[0] + (b[0] - a[0]) * s / len, a[1] + (b[1] - a[1]) * s / len]
        const q = [a[0] + (b[0] - a[0]) * (s + 3) / len, a[1] + (b[1] - a[1]) * (s + 3) / len]
        strips(paint, pt, p, q, -0.065, 0.065, 0.09)
      }
    }
  }
  if (!points.length) return
  const parts = [{name: 'Carriageway', geometry: surface(points, triangles, 0.25), mat: 0}]
  if (walks.length) parts.push({name: 'Clipped sidewalks with lowered crossing approaches', geometry: surface(walks, wt, 0.25), mat: 1})
  if (curbs.length) parts.push({name: 'Raised curb faces', geometry: surface(curbs, ct, 0.25), mat: 1})
  if (gutters.length) parts.push({name: 'Concrete drainage margins', geometry: surface(gutters, gt, 0.25), mat: 1})
  if (paint.length) parts.push({name: 'Inferred center markings', geometry: surface(paint, pt), mat: 2})
  const generated = asset(`assets/models/city/roads/${feature.id.replace(':', '-')}`, parts,
    [groundMaterial('Asphalt', '#64696c', 0), groundMaterial('Concrete sidewalk', '#a39e91', 1), material('Centerline', '#e4c76a')],
    {name: feature.name, cityId: feature.id}, groundResources(['asphalt','concrete']))
  const center = feature.points[Math.floor(feature.points.length / 2)]
  record(feature, generated, [0, 0, 0], {kind: 'road', tile: `${Math.floor(center[0] / area.tileSizeM)}_${Math.floor(center[1] / area.tileSizeM)}`,
    widthM: feature.width, widthSource: feature.widthSource, sidewalkSource: feature.sidewalkSource, sourceDataset: '3psu-pn9h'})
}

function trees() {
  const leaves = [material('Broadleaf canopy', '#667954'), material('Trunk', '#79634c')]
  write('assets/models/city/trees/broadleaf/leaves.png', foliageTexture())
  const leafMaterial = {...material('Authored leaf clusters', '#ffffff'), alphaMode: 'MASK', alphaCutoff: 0.5}
  leafMaterial.pbrMetallicRoughness.baseColorTexture = {index: 0}
  const broadleaves = [0,1,2].map(variant=>{
  const template=broadleafGeometry(variant)
  return asset('assets/models/city/trees/broadleaf'+(variant?'-'+variant:''), [
    {name:'Connected tapered trunk and branches',geometry:template.wood,mat:1},
    {name:'Twig-attached foliage sprays',geometry:template.leaves,mat:0},
  ], [leafMaterial, leaves[1]], {name:'Authored broadleaf canopy, inferred species shape'}, {
    images: [{uri: '/kite3d/assets/models/city/trees/broadleaf/leaves.png'}], textures: [{source: 0, sampler: 0}],
    samplers: [{magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071}],
  })
  })
  const palmParts = [{name: 'Trunk', geometry: new THREE.CylinderGeometry(0.16, 0.28, 8.6, 12).translate(0, 4.3, 0), mat: 1}]
  palmParts.push(...palmCrown())
  const palm = asset('assets/models/city/trees/palm', palmParts, leaves, {name: 'Original pinnate palm archetype, inferred 10 m crown'})
  for (const tree of city.trees) {
    const siting=siteTree(tree.position,city.roads,city.buildings)
    const [x, z] = siting.position
    record({...tree, name: `${tree.species.split(' :: ')[0]} #${tree.sourceId}`}, tree.kind === 'palm' ? palm : broadleaves[Math.floor(seed(tree.id+'crown')*3)],
      [x, ground(x, z), z], {kind: 'tree', sourcePosition:siting.sourcePosition, placementCorrection:siting.placementCorrection, placementWarning:siting.placementWarning, heightM: tree.height, heightSource: tree.heightSource, species: tree.species,
        scale: [tree.height / 10, tree.height / 10, tree.height / 10], yaw: seed(tree.id) * Math.PI * 2,
        sourceDataset: 'tkzw-k3nq'})
  }
}

// Clipping duplicates vertices. Share normals at coincident points so the lawn does
// not display a separate lighting triangle for every source grid cell.
function groundSurface(points, triangles) {
  const g = surface(points, triangles, 0.25), normals = g.getAttribute('normal')
  const sums = new Map(), keys = points.map(p => p.map(v => Math.round(v * 10000)).join(':'))
  for (let i = 0; i < points.length; i++) {
    const n = sums.get(keys[i]) || new THREE.Vector3()
    n.x += normals.getX(i); n.y += normals.getY(i); n.z += normals.getZ(i); sums.set(keys[i], n)
  }
  for (const n of sums.values()) n.normalize()
  for (let i = 0; i < points.length; i++) {const n = sums.get(keys[i]); normals.setXYZ(i, n.x, n.y, n.z)}
  return g
}
function terrain() {
  const positions = [], paved = [], grass = [], grid = []
  const countX = Math.ceil((bounds[2] - bounds[0] + 30) / area.terrainStepM)
  const countZ = Math.ceil((bounds[3] - bounds[1] + 30) / area.terrainStepM)
  for (let j = 0; j <= countZ; j++) {
    grid[j] = []
    for (let i = 0; i <= countX; i++) {
      const x = bounds[0] - 15 + i * (bounds[2] - bounds[0] + 30) / countX
      const z = bounds[1] - 15 + j * (bounds[3] - bounds[1] + 30) / countZ
      grid[j][i] = positions.length; positions.push([x, ground(x, z), z])
      if (i && j) {
        const list = paved
        list.push([grid[j - 1][i - 1], grid[j][i], grid[j - 1][i]], [grid[j - 1][i - 1], grid[j][i - 1], grid[j][i]])
      }
    }
  }
  // The coarse terrain must not poke through finely graded roads on hills.
  // Remove covered ground triangles rather than hiding the mismatch with a vertical offset.
  const parkBox=[Math.min(...parkBoundary.map(p=>p[0])),Math.min(...parkBoundary.map(p=>p[1])),Math.max(...parkBoundary.map(p=>p[0])),Math.max(...parkBoundary.map(p=>p[1]))]
  const groundMasks = [...outerCorridors,{polygon:parkBoundary,box:parkBox}]
  const visibleGround = [], visiblePaved = [], visibleGrass = []
  for (const [source, target] of [[paved, visiblePaved], [grass, visibleGrass]]) {
    for (const triangle of source) {
      const footprint = triangle.map(i => [positions[i][0], positions[i][2]])
      for (const polygon of clipped(footprint, groundMasks)) {
        const v = visibleGround.length
        polygon.forEach(p => visibleGround.push([p[0], ground(...p), p[1]]))
        for (let j = 1; j + 1 < polygon.length; j++) target.push([v, v + j, v + j + 1])
      }
    }
  }
  const generated = asset('assets/models/city/terrain', [
    {name: 'Interpolated ground', geometry: groundSurface(visibleGround, visiblePaved), mat: 0},
    {name: 'Approximate Washington Square lawn', geometry: groundSurface(visibleGround, visibleGrass), mat: 1},
  ], [groundMaterial('Urban ground', '#c4c0b2', 0), groundMaterial('Lawn', '#b2c18d', 1)],
  {name: 'Ground from footprint ground samples', elevationSource: 'Interpolated DataSF gnd_mediancm; NAVD88 metres; not 2023 LiDAR'}, groundResources(['concrete','lawn']))
  record({id: 'sf-terrain:north-beach', name: 'North Beach ground'}, generated, [0, 0, 0], {kind: 'terrain'})
  write('scene/collision.json', {version: 1, origin: area.origin, verticalOriginM: area.verticalOriginM,
    integratedPhysics: false, terrain: {positions, triangles: [...paved, ...grass]}, buildings: collisions})
}

for (const feature of city.buildings) building(feature)
for (const feature of city.roads) road(feature)
trees(); terrain()
streetFurniture(city,ground,bounds,record)
washingtonSquare(ground,record)
// Authored parked props are separate editable references, never merged into building geometry.
for(const photo of photoStudies){
  if(photo.backgroundTower){
    const generated=grantBackground()
    record({id:'sf-study:grant-background-tower',name:'Grant study / inferred distant tower'},generated,photo.point([54,0,-5.5]),{kind:'photo-background',yaw:photo.provenance.yaw,scale:[1,photo.provenance.scaleY,1],sourceDataset:'Single-photo silhouette and placement estimate, not a mapped tower'})
  }
  const road=city.roads.find(r=>r.id==='sf-road:6404000')
  for(const [index,x,path]of [[0,7.44,'assets/models/vehicles/bmw-x5/f.gltf'],[1,13.44,'assets/models/vehicles/tozzo-98/f.gltf'],[2,18.94,'assets/models/vehicles/tozzo-98/dark.gltf']]){
    const wall=photo.point([x,0,0]),a=road.points[0],b=road.points[1],dx=b[0]-a[0],dz=b[1]-a[1],t=((wall[0]-a[0])*dx+(wall[2]-a[1])*dz)/(dx*dx+dz*dz),cx=a[0]+t*dx,cz=a[1]+t*dz
    const distance=Math.hypot(wall[0]-cx,wall[2]-cz),nx=(wall[0]-cx)/distance,nz=(wall[2]-cz)/distance,offset=road.width/2-.95-.18,px=cx+nx*offset,pz=cz+nz*offset
    const along=new THREE.Vector3(-nz,0,nx),rise=(ground(px+along.x*2,pz+along.z*2)-ground(px-along.x*2,pz-along.z*2))/4
    along.y=rise;along.normalize();const outward=new THREE.Vector3(-nx,0,-nz),up=outward.clone().cross(along).normalize(),rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along,up,outward)).toArray()
    const spec={id:`sf-study:grant-parked-${index+1}`,name:index===0?'Grant study / BMW X5 (CC BY 4.0)':'Grant study / Tozzo sedan (CC BY 4.0)',asset:path}
    record(spec,{path},[px,ground(px,pz)+.035,pz],{kind:'authored-vehicle',rotation,scale:index===0?[.9,.9,.9]:[1,1,1],sourceDataset:'Photo-inferred parking; licensed substitute vehicle model'})
  }
}
const provenance = JSON.parse((await import('node:fs')).readFileSync(new URL('../../../scene/sources/provenance.json', import.meta.url), 'utf8'))
write('scene/generated.json', {version: 1, generatorVersion: GENERATOR_VERSION, area, provenance,
  assumptions: ['Ground interpolated from older city footprint ground elevations; no 2023 LiDAR processed.',
    'Facades, flat roofs, road widths, markings and tree sizes are inferred placeholders.',
    'Sidewalk widths use positive SIDEWALK_F observations from the 2014 study, with defaults for unknown/variable widths; not surveyed curb geometry.',
    'Sidewalks are clipped against carriageways; 15 cm curbs and 1.8 m lowered crossing approaches are heuristic, not surveyed or accessibility-certified.',
    'Park contours and bench positions are traced approximately from the 2018 city concept plan, not surveyed as-built. Street lanterns and bins use inferred sidewalk placements; no traffic simulation or physics integration.',
    'Tiles are logical ownership groups; production streaming and LOD generation are not implemented.'],
  unmatchedOverrides: city.unmatchedOverrides, tiles, placements,
  photoStudies: photoStudies.map(p=>p.provenance), views: photoStudies.map(p=>p.view),
  stats: {buildings: city.buildings.length, roads: city.roads.length, trees: city.trees.length,
    tiles: Object.keys(tiles).length, triangles: placements.reduce((s, p) => s + p.triangles, 0)}})
console.log(`Baked ${city.buildings.length} buildings, ${city.roads.length} roads and ${city.trees.length} trees`)
