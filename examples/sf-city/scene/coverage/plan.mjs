// Offline coverage planning only. No requests, geometry generation or runtime imports.
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {resolve, dirname} from 'node:path'
import {createHash} from 'node:crypto'

const directory=dirname(fileURLToPath(import.meta.url)),scene=resolve(directory,'..')
const area=JSON.parse(readFileSync(resolve(scene,'area.json')))
const generated=JSON.parse(readFileSync(resolve(scene,'generated.json')))
const provenance=JSON.parse(readFileSync(resolve(scene,'sources/provenance.json')))
export const tileSizeM=128
export const origin=Object.freeze([...area.origin])
const eastScale=111320*Math.cos(origin[1]*Math.PI/180)
export const toWorld=([lon,lat])=>[(lon-origin[0])*eastScale,-(lat-origin[1])*111320]
export const toGeographic=([x,z])=>[origin[0]+x/eastScale,origin[1]-z/111320]
export const ownerTile=([x,z])=>`${Math.floor(x/tileSizeM)}_${Math.floor(z/tileSizeM)}`
export function tileBounds(id){
 if(!/^-?\d+_-?\d+$/.test(id))throw new Error('Expected integer x_z tile ID')
 const[x,z]=id.split('_').map(Number),[w,n]=toGeographic([x*tileSizeM,z*tileSizeM]),[e,s]=toGeographic([(x+1)*tileSizeM,(z+1)*tileSizeM])
 return[w,s,e,n]
}
export function tileRange([w,s,e,n]){
 const[a,b]=toWorld([w,n]),[c,d]=toWorld([e,s])
 return{minX:Math.floor(a/tileSizeM),minZ:Math.floor(b/tileSizeM),maxX:Math.ceil(c/tileSizeM)-1,maxZ:Math.ceil(d/tileSizeM)-1}
}
const regions=[
 {id:'mainland',bounds:[-122.52,37.707,-122.355,37.812],stage:2},
 {id:'treasure-yerba-buena',bounds:[-122.386,37.806,-122.356,37.835],stage:3},
 {id:'alcatraz',bounds:[-122.426,37.823,-122.419,37.830],stage:3},
].map(r=>({...r,boundsKind:'Author-selected acquisition envelope, not an administrative or land polygon',range:tileRange(r.bounds)}))
const datasets={
 buildings:{id:'ynuv-fyni',geometry:'shape',key:'sf16_bldgid',fields:['sf16_bldgid','shape','gnd_mediancm','gnd_mincm','gnd_maxcm','hgt_median_m','hgt_maxcm','data_as_of']},
 roads:{id:'3psu-pn9h',geometry:'line',key:'cnn',fields:['cnn','streetname','st_type','classcode','oneway','line','f_node_cnn','t_node_cnn','data_as_of']},
 trees:{id:'tkzw-k3nq',key:'treeid',fields:['treeid','species','latitude','longitude','mapdbh','data_as_of']},
 sidewalks:{id:'4g86-grxu',geometry:'shape',key:'objectid',fields:['objectid','cnn','width_min','sidewalk_f','side','shape','data_as_of']},
}
export function queryForTile(id,layer){
 const spec=datasets[layer];if(!spec)throw new Error('Unknown layer')
 const[w,s,e,n]=tileBounds(id),polygon=`POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`
 const spatial=spec.geometry?`intersects(${spec.geometry}, '${polygon}')`:`latitude >= ${s} AND latitude < ${n} AND longitude >= ${w} AND longitude < ${e}`
 const query=new URLSearchParams({'$select':spec.fields.join(','),'$where':(layer==='roads'?'active = true AND ':'')+spatial,'$order':spec.key,'$limit':'5000'})
 return`https://data.sf.gov/resource/${spec.id}.json?${query}`
}
function nextBatch(){
 const r=tileRange(area.bounds),candidates=[]
 for(let z=r.minZ-1;z<=r.maxZ+1;z++)for(let x=r.minX-1;x<=r.maxX+1;x++){
  const within=x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ
  const id=`${x}_${z}`,bounds=tileBounds(id),partial=within&&(bounds[0]<area.bounds[0]||bounds[1]<area.bounds[1]||bounds[2]>area.bounds[2]||bounds[3]>area.bounds[3])
  if(within&&!partial)continue
  candidates.push({id,bounds,status:'not-acquired',reason:partial?'complete-partial-snapshot-tile':'adjacent-expansion',queries:Object.fromEntries(Object.keys(datasets).map(k=>[k,queryForTile(id,k)]))})
 }
 return candidates.sort((a,b)=>{const[ax,az]=a.id.split('_').map(Number),[bx,bz]=b.id.split('_').map(Number);return Number(a.reason==='adjacent-expansion')-Number(b.reason==='adjacent-expansion')||Math.hypot(ax+.5,az+.5)-Math.hypot(bx+.5,bz+.5)||az-bz||ax-bx}).slice(0,16)
}
export function coveragePlan(){
 const unique=new Set();for(const {range:r}of regions)for(let z=r.minZ;z<=r.maxZ;z++)for(let x=r.minX;x<=r.maxX;x++)unique.add(`${x}_${z}`)
 return{version:1,kind:'offline-coverage-plan',geometryGeneratedByThisModule:false,
 coordinateSystem:{origin,axes:'X east, Y up, Z south',horizontal:'Fixed-origin local equirectangular approximation, identical to existing scene/data.mjs; not survey coordinates',vertical:'Existing NAVD88 ground heights minus verticalOriginM, not ellipsoid altitude',verticalOriginM:area.verticalOriginM,tileSizeM},
 actualCoverage:{bounds:area.bounds,stats:generated.stats,sourceCapture:provenance.capturedAt,sourceManifestSHA256:createHash('sha256').update(readFileSync(resolve(scene,'sources/provenance.json'))).digest('hex'),note:'Only the existing bounded North Beach snapshot has generated geometry. Intersecting tiles are not complete city tiles.'},
 plannedCoverage:{regions,envelopeTileCount:unique.size,landTileCount:null,requiresLandAndJurisdictionMask:true,excluded:['Farallon Islands deferred to a separate geographic region and coordinate strategy','Bay water and land outside San Francisco must be masked before acquisition/generation'],note:'Envelope tile count is a planning upper bound, not generated coverage or measured land area.'},
 acquisition:{networkEnabled:false,maxTilesPerBatch:16,maxConcurrentRequests:2,maxRowsPerResponse:5000,fullResponseAction:'Do not accept as complete. Subdivide query or use stable ordered pagination with duplicate/missing-ID checks; stage files atomically.',emptyResponseAction:'Record valid empty as distinct from denied/error/truncated. Never replace prior data on errors.',datasets,nextBatch:nextBatch()},
 proposedRuntimeBudgets:{status:'Acceptance targets, not measurements',initialTransferBytes:20000000,residentGPUBytes:384000000,nearTiles:9,maxResidentDetailTiles:25,maxInflightTiles:2,visibleTriangles:1500000,fullFrameDrawCalls:500,interactionFrameMsTarget:33.3,notes:'Measure all render passes and target hardware. Adjust quality/LOD against evidence rather than claiming these budgets are achieved.'},
 tileManifestContract:{id:'integer x_z, fixed 128 m origin grid',status:['not-acquired','source-ready','generated','validated','failed'],required:['bounds','worldOrigin','sourceManifestHash','generatorVersion','overrideHash','ownerFeatureIds','crossTileReferences','assetsByDetail','byteSizeByDetail','triangleCountByDetail','validation'],ownership:'Keep existing semantic dataset feature IDs. Choose one canonical owner from the unclipped source feature, never per-query fragment. Neighbor tiles reference the same feature. Existing owner IDs are migrated explicitly, never silently renumbered.',edits:'Author edits remain in source assets/overrides. Tile changes do not replace references, unknown extras/extensions, hidden ancestors or components. Runtime batching/LOD must be reversible and never write back to authored files.',lifecycle:'Desired tile set from camera position; load with generation token, discard stale responses, attach only complete validated tiles; unload owned render objects, listeners and buffers; reference-count shared textures/materials; cancel pending work on Stop/dispose.'},
 nextMilestone:'First make current North Beach meet measured runtime targets. Then complete partial snapshot border tiles and acquire adjacent cells, at most the listed 16 tiles, retain provenance, generate/edit locally, and validate traversal across one tile boundary with unload/reload and preserved owner edits before any wider expansion.'}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=coveragePlan();writeFileSync(resolve(directory,'plan.json'),JSON.stringify(output,null,2)+'\n')
 console.log(JSON.stringify({output:'scene/coverage/plan.json',actualBounds:output.actualCoverage.bounds,plannedEnvelopeTiles:output.plannedCoverage.envelopeTileCount,nextBatchTiles:output.acquisition.nextBatch.length,networkRequests:0,generatedGeometry:0}))
}
