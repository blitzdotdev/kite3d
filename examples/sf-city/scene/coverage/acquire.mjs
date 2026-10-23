// Explicit, bounded source acquisition. Default is a read-only dry run.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {coveragePlan,tileBounds,toWorld,ownerTile,queryForTile} from './plan.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),scene=resolve(directory,'..')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value
const serialize=value=>JSON.stringify(stable(value))+'\n'
const invalid=message=>Object.assign(new Error(message),{state:'invalid'})
function coordinate(value,limit){
 if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value))||Math.abs(Number(value))>limit)throw invalid('Invalid geographic coordinate')
 return Number(value)
}
function validateBounds(bounds){
 if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(v=>typeof v!=='number'||!Number.isFinite(v))||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||Math.abs(bounds[0])>180||Math.abs(bounds[2])>180||Math.abs(bounds[1])>90||Math.abs(bounds[3])>90)throw invalid('Invalid provenance area.bounds')
}
function validateGeometry(layer,g){
 const allowed=['roads','sidewalks'].includes(layer)?['LineString']:['Polygon','MultiPolygon']
 if(!g||!allowed.includes(g.type)||!Array.isArray(g.coordinates))throw invalid('Unsupported '+layer+' geometry')
 const position=p=>{if(!Array.isArray(p)||p.length<2||p.length>3||p.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw invalid('Invalid geometry position');coordinate(p[0],180);coordinate(p[1],90)}
 const same=(a,b)=>a[0]===b[0]&&a[1]===b[1]
 const line=points=>{if(!Array.isArray(points)||points.length<2)throw invalid('Invalid line coordinates');points.forEach(position);if(points.every(p=>same(p,points[0])))throw invalid('Degenerate line')}
 const ring=points=>{
  line(points)
  if(points.length<4||!same(points[0],points.at(-1))||new Set(points.slice(0,-1).map(p=>p[0]+','+p[1])).size<3)throw invalid('Invalid polygon ring closure or vertices')
  // Subtract the first vertex to avoid cancellation at geographic magnitudes.
  const [x,y]=points[0],area=points.slice(1).reduce((sum,p,i)=>sum+(points[i][0]-x)*(p[1]-y)-(p[0]-x)*(points[i][1]-y),0)
  if(Math.abs(area)<1e-16)throw invalid('Degenerate polygon ring')
 }
 const polygon=rings=>{if(!Array.isArray(rings)||!rings.length)throw invalid('Missing polygon rings');rings.forEach(ring)}
 if(g.type==='LineString')line(g.coordinates)
 else if(g.type==='Polygon')polygon(g.coordinates)
 else{if(!g.coordinates.length)throw invalid('Missing polygons');g.coordinates.forEach(polygon)}
}
const inside=([x,y],[w,s,e,n])=>x>=w&&x<=e&&y>=s&&y<=n
function segment(a,b,bounds){
 let lo=0,hi=1;const[w,s,e,n]=bounds,dx=b[0]-a[0],dy=b[1]-a[1]
 for(const[p,q]of[[-dx,a[0]-w],[dx,e-a[0]],[-dy,a[1]-s],[dy,n-a[1]]]){if(p===0){if(q<0)return false;continue}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false}return true
}
function inRing(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
export function intersects(geometry,bounds){
 if(!geometry||!Array.isArray(geometry.coordinates))throw new Error('Missing or unsupported source geometry')
 const c=geometry.coordinates,line=points=>points.some(p=>inside(p,bounds))||points.slice(1).some((p,i)=>segment(points[i],p,bounds))
 const polygon=rings=>rings.some(line)||[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]].some(p=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r)))
 switch(geometry.type){case'Point':return inside(c,bounds);case'MultiPoint':return c.some(p=>inside(p,bounds));case'LineString':return line(c);case'MultiLineString':return c.some(line);case'Polygon':return polygon(c);case'MultiPolygon':return c.some(polygon);default:throw new Error('Unsupported geometry type '+geometry.type)}
}
const prefix={buildings:'sf-building',roads:'sf-road',trees:'sf-tree',sidewalks:'sf-sidewalk'}
function semanticId(layer,row,spec){const value=row[spec.key];if(value==null||String(value).trim()==='')throw new Error('Missing stable source ID');if(layer==='roads'&&!Number.isFinite(Number(value)))throw new Error('Invalid road ID');return`${prefix[layer]}:${layer==='roads'?Number(value):value}`}
function anchor(layer,row,spec){
 if(layer==='trees')return toWorld([Number(row.longitude),Number(row.latitude)])
 const g=row[spec.geometry],c=g.coordinates
 if(g.type==='LineString')return toWorld(c[Math.floor(c.length/2)])
 const ring=g.type==='MultiPolygon'?c[0][0]:g.type==='Polygon'?c[0]:null
 if(!ring?.length)throw new Error('Unsupported ownership geometry')
 const points=ring.length>1&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]?ring.slice(0,-1):ring
 return toWorld([0,1].map(axis=>points.reduce((s,p)=>s+p[axis],0)/points.length))
}
export function normalizeLayer(layer,rows,spec,bounds,filterSpatial=false){
 if(!Array.isArray(rows))throw Object.assign(new Error('Response is not a record array'),{state:'invalid'})
 if(rows.length>=5000)throw Object.assign(new Error('Response reached the 5000-row cap; completeness unknown'),{state:'truncated'})
 const unique=new Map();let duplicates=0
 for(const raw of rows){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Object.assign(new Error('Invalid source record'),{state:'invalid'})
  const row=Object.fromEntries(spec.fields.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]])),id=semanticId(layer,row,spec)
  if(layer==='trees'){coordinate(row.longitude,180);coordinate(row.latitude,90)}else validateGeometry(layer,row[spec.geometry])
  const ownerAnchor=anchor(layer,row,spec)
  if(ownerAnchor.length!==2||ownerAnchor.some(v=>!Number.isFinite(v)))throw invalid('Invalid ownership anchor')
  if(filterSpatial){const keep=layer==='trees'?Number(row.longitude)>=bounds[0]&&Number(row.longitude)<bounds[2]&&Number(row.latitude)>=bounds[1]&&Number(row.latitude)<bounds[3]:intersects(row[spec.geometry],bounds);if(!keep)continue}
  const encoded=serialize(row)
  if(unique.has(id)){if(unique.get(id).encoded!==encoded)throw Object.assign(new Error('Conflicting duplicate semantic ID '+id),{state:'conflict'});duplicates++;continue}
  unique.set(id,{id,row,encoded,ownerAnchor})
 }
 const records=[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id)),payload=serialize(records.map(r=>r.row))
 return{records,payload,duplicates,status:records.length?'valid':'empty',dataAsOf:[...new Set(records.map(r=>r.row.data_as_of??null))].sort()}
}
function args(argv){
 const out={};for(let i=0;i<argv.length;i++){const flag=argv[i];if(flag==='--fetch'){out.fetch=true;continue}if(flag==='--help'){out.help=true;continue}if(!['--tile','--import-dir','--retry-from','--output'].includes(flag)||out[flag]!==undefined||!argv[i+1])throw new Error('Expected one --tile, optional --fetch OR --import-dir, and --output');out[flag]=argv[++i]}
 if(out.fetch&&out['--import-dir'])throw new Error('--fetch and --import-dir are mutually exclusive')
 return out
}
export async function acquireTile(options){
 if(options.fetch&&options.importDirectory)throw new Error('--fetch and --import-dir are mutually exclusive')
 const plan=coveragePlan(),tile=options.tile,bounds=tileBounds(tile),[x,z]=tile.split('_').map(Number)
 if(!plan.plannedCoverage.regions.some(({range:r})=>x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ))throw new Error('Tile is outside the planned acquisition envelopes')
 const queries=Object.fromEntries(Object.keys(plan.acquisition.datasets).map(layer=>[layer,queryForTile(tile,layer)]))
 if(!options.fetch&&!options.importDirectory)return{mode:'dry-run',tile,bounds,queries,networkRequests:0,writtenFiles:0}
 let retryManifest=null
 if(options.retryCapture){
  if(!options.fetch||options.importDirectory)throw new Error('--retry-from requires --fetch and no import')
  retryManifest=JSON.parse(await readFile(resolve(options.retryCapture,'tile-manifest.json'),'utf8'))
  if(retryManifest.tile!==tile)throw new Error('Retry tile mismatch')
  for(const [layer,query]of Object.entries(queries)){const previous=retryManifest.layers?.[layer];if(!previous||previous.query!==query)throw new Error('Retry query mismatch');if(['valid','empty'].includes(previous.status))continue;if(previous.httpStatus!==503)throw new Error('Retry is limited to HTTP 503 layers');const retryAt=previous.retryAfterAt??new Date(Date.parse(previous.receivedAt)+30000).toISOString();if(!Number.isFinite(Date.parse(retryAt))||Date.now()<Date.parse(retryAt))throw new Error('Retry backoff has not elapsed: '+retryAt)}
 }
 const startedAt=new Date().toISOString(),captureId=startedAt.replaceAll(':','-')+'-'+randomUUID(),base=resolve(options.output||resolve(directory,'captures')),staging=resolve(base,'.staging-'+captureId),destination=resolve(base,captureId)
 let sourceManifest=null,complete=true
 if(options.importDirectory){sourceManifest=JSON.parse(await readFile(resolve(options.importDirectory,'provenance.json'),'utf8'));const b=sourceManifest.area?.bounds;validateBounds(b);complete=b[0]<=bounds[0]&&b[1]<=bounds[1]&&b[2]>=bounds[2]&&b[3]>=bounds[3]}
 await mkdir(staging,{recursive:true});const layers={},features=[],names=Object.keys(queries);let cursor=0,networkRequests=0
 const existing=JSON.parse(await readFile(resolve(scene,'generated.json'),'utf8')),owners=new Map(existing.placements.map(p=>[p.id,p.tile]))
 async function worker(){while(cursor<names.length){const layer=names[cursor++],spec=plan.acquisition.datasets[layer],requestedAt=new Date().toISOString();let responseStatus=null,retryAfter=null,retryAfterAt=null,reused=false
  try{
   let bytes
   if(retryManifest&&['valid','empty'].includes(retryManifest.layers[layer].status)){bytes=await readFile(resolve(options.retryCapture,layer+'.json'));if(hash(bytes)!==retryManifest.layers[layer].payloadSHA256)throw invalid('Previous capture payload hash mismatch');reused=true}
   else if(options.importDirectory){bytes=await readFile(resolve(options.importDirectory,layer+'.json'));const expected=sourceManifest.layers?.[layer]?.sha256;if(expected&&hash(bytes)!==expected)throw Object.assign(new Error('Imported source hash differs from provenance'),{state:'invalid'})}
   else{networkRequests++;const response=await fetch(queries[layer],{redirect:'error',headers:{'User-Agent':'Kite3D-SF-tile-acquisition/1.0'},signal:AbortSignal.timeout(90000)});responseStatus=response.status;retryAfter=response.headers.get('retry-after');if(retryAfter!==null){const seconds=/^\d+$/.test(retryAfter.trim())?Number(retryAfter.trim()):null,at=seconds===null?Date.parse(retryAfter):Date.now()+seconds*1000;if(Number.isFinite(at)&&Math.abs(at)<=8640000000000000)retryAfterAt=new Date(at).toISOString()}if(!response.ok)throw Object.assign(new Error('HTTP '+response.status),{state:[401,403,429].includes(response.status)?'denied':'failed'});const reader=response.body?.getReader();if(!reader)throw new Error('Missing response body');const chunks=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32*1024*1024){await reader.cancel();throw Object.assign(new Error('Response exceeds 32 MiB byte budget'),{state:'oversized'})}chunks.push(value)}bytes=Buffer.concat(chunks)}
   const parsed=JSON.parse(bytes.toString('utf8')),normalized=normalizeLayer(layer,parsed,spec,bounds,!!options.importDirectory)
   // Stage every feature before publishing the payload or any successful layer state.
   const layerFeatures=normalized.records.map(({id,row,ownerAnchor})=>{
    const existingOwner=owners.get(id),chosenOwner=existingOwner??ownerTile(ownerAnchor)
    if(typeof chosenOwner!=='string'||! /^-?\d+_-?\d+$/.test(chosenOwner)||chosenOwner.split('_').some(v=>!Number.isSafeInteger(Number(v))))throw invalid('Invalid ownership tile for '+id)
    return{id,layer,sourceId:row[spec.key],recordSHA256:hash(serialize(row)),ownerTile:chosenOwner,ownershipSource:existingOwner?'existing-generated-manifest':'complete-source-feature-anchor',role:chosenOwner===tile?'owner':'cross-tile-reference'}
   })
   await writeFile(resolve(staging,layer+'.json'),normalized.payload,{flag:'wx'})
   layers[layer]={dataset:spec.id,query:queries[layer],requestedAt,receivedAt:new Date().toISOString(),httpStatus:responseStatus,status:normalized.status,inputSHA256:hash(bytes),payloadSHA256:hash(normalized.payload),inputRows:parsed.length,rows:normalized.records.length,duplicateCopiesRemoved:normalized.duplicates,dataAsOf:normalized.dataAsOf,mode:reused?'verified-capture-reuse':options.importDirectory?'spatially-filtered-import':'network',reusedCapture:reused?{captureId:retryManifest.captureId,payloadSHA256:retryManifest.layers[layer].payloadSHA256,originalInputSHA256:retryManifest.layers[layer].inputSHA256}:null,importSource:sourceManifest?{capturedAt:sourceManifest.capturedAt,area:sourceManifest.area,layerHash:sourceManifest.layers?.[layer]?.sha256??null}:null}
   features.push(...layerFeatures)
  }catch(error){layers[layer]={dataset:spec.id,query:queries[layer],requestedAt,receivedAt:new Date().toISOString(),httpStatus:responseStatus,status:error.state||'failed',reason:error.message,retryAfter,retryAfterAt,transportErrorCode:typeof error.cause?.code==='string'?error.cause.code:null}}
 }}
 await Promise.all([worker(),worker()])
 const validLayers=names.every(n=>['valid','empty'].includes(layers[n].status)),sourceReady=complete&&validLayers,manifest={version:1,captureId,retryOfCapture:retryManifest?.captureId??null,tile,bounds,coordinateSystem:plan.coordinateSystem,status:sourceReady?'source-ready':validLayers?'partial-source':'failed',geometryGenerated:false,startedAt,completedAt:new Date().toISOString(),networkRequests,maxConcurrentRequests:2,maxResponseBytes:32*1024*1024,completeTileCoverage:complete,layers,features:features.sort((a,b)=>a.id.localeCompare(b.id)),assetsByDetail:{},acceptedBaselineChanged:false}
 await writeFile(resolve(staging,'tile-manifest.json'),serialize(manifest),{flag:'wx'});await rename(staging,destination)
 return{captureDirectory:destination,tile,status:manifest.status,geometryGenerated:false,manifestSHA256:hash(serialize(manifest)),networkRequests,layerStates:Object.fromEntries(names.map(n=>[n,layers[n].status]))}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const options=args(process.argv.slice(2));if(options.help){console.log('node acquire.mjs --tile x_z [--fetch | --import-dir snapshots] [--retry-from previous-capture] [--output capture-directory]\nDefault: dry run. One tile only, four layers, concurrency two, no automatic retries.');process.exit(0)}if(!options['--tile'])throw new Error('--tile x_z is required');const result=await acquireTile({tile:options['--tile'],fetch:options.fetch,retryCapture:options['--retry-from'],importDirectory:options['--import-dir'],output:options['--output']});console.log(JSON.stringify(result,null,2));if(result.status&&result.status!=='source-ready')process.exitCode=1}catch(error){console.error(error.message);process.exitCode=1}
}
