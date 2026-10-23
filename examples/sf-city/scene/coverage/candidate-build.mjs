// Reproducible isolated experiment. Never writes into the accepted project.
import {cp,mkdir,readFile,writeFile,symlink,stat} from 'node:fs/promises'
import {resolve,dirname,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {unionRectangles,rectangleArea} from './masks.mjs'
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),destination=resolve(process.argv[2]??'/tmp/sf-adjacent-candidate'),capturePaths=process.argv.slice(3).length?process.argv.slice(3).map(p=>resolve(p)):[resolve(source,'scene/coverage/captures/2026-10-22T18-22-06.980Z-729ad3d8-cf8b-4ff9-ad58-af78939954ac')]
const hash=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8')),save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n')
if(!destination.startsWith('/tmp/')||destination===source)throw new Error('Candidate destination must be a new /tmp directory')
try{await stat(destination);throw new Error('Candidate destination already exists; choose a new directory')}catch(error){if(error.code!=='ENOENT')throw error}
if(capturePaths.length>16)throw new Error('At most 16 captures per isolated candidate')
const captures=await Promise.all(capturePaths.map(async path=>({path,manifest:await json(path+'/tile-manifest.json'),manifestSHA256:hash(await readFile(path+'/tile-manifest.json'))})))
captures.sort((a,b)=>a.manifest.captureId.localeCompare(b.manifest.captureId))
if(captures.some(c=>c.manifest.status!=='source-ready'))throw new Error('Every capture must be source-ready')
if(new Set(captures.map(c=>c.manifest.captureId)).size!==captures.length)throw new Error('Duplicate capture arguments')
const area=await json(source+'/scene/area.json'),baseline=await json(source+'/scene/generated.json'),originalScene=await readFile(source+'/assets/main.scene.gltf'),originalOverrides=await readFile(source+'/scene/overrides.json')
if(area.coverageStatus)throw new Error('Build from the accepted original project with all captures, not a prior candidate bounding envelope')
const inputs=['assets/main.scene.gltf','assets.json','scene/generated.json','scene/overrides.json','scene/area.json'],before=Object.fromEntries(await Promise.all(inputs.map(async p=>[p,hash(await readFile(source+'/'+p))])))
await cp(source,destination,{recursive:true,filter:p=>!['node_modules','dist','.kite3d','.git','captures'].includes(basename(p))})
await symlink(resolve(source,'../../node_modules'),destination+'/node_modules','dir')
const conflicts=[],sources={},keys={buildings:'sf16_bldgid',roads:'cnn',trees:'treeid',sidewalks:'objectid'},stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v,canonical=v=>JSON.stringify(stable(v))
for(const [layer,key]of Object.entries(keys)){
 const current=await json(source+'/scene/sources/'+layer+'.json'),id=r=>layer==='roads'?String(Number(r[key])):String(r[key]),merged=new Map(current.map(r=>[id(r),r])),baselineIds=new Set(merged.keys());let duplicates=0,added=0,capturedRows=0
 for(const {path,manifest}of captures){
  const incomingBytes=await readFile(path+'/'+layer+'.json');if(hash(incomingBytes)!==manifest.layers[layer].payloadSHA256)throw new Error('Capture hash mismatch '+layer)
  const incoming=JSON.parse(incomingBytes);capturedRows+=incoming.length
  for(const row of incoming){const k=id(row);if(merged.has(k)){duplicates++;if(canonical(merged.get(k))!==canonical(row))conflicts.push({layer,sourceId:k,captureId:manifest.captureId,resolution:baselineIds.has(k)?'preserved-baseline-record':'preserved-earlier-capture-record'})}else{merged.set(k,row);added++}}
 }
 const rows=[...merged.values()],bytes=JSON.stringify(rows,null,2)+'\n';await writeFile(destination+'/scene/sources/'+layer+'.json',bytes);sources[layer]={baselineRows:current.length,capturedRows,duplicates,added,total:rows.length,sha256:hash(bytes)}
}
const baselineMasks=unionRectangles(area.coverageMasks??[area.bounds]),masks=unionRectangles([...baselineMasks,...captures.map(c=>c.manifest.bounds)]),eastScale=111320*Math.cos(area.origin[1]*Math.PI/180),world=r=>[(r[0]-area.origin[0])*eastScale,-(r[3]-area.origin[1])*111320,(r[2]-area.origin[0])*eastScale,-(r[1]-area.origin[1])*111320],worldMasks=masks.map(world),envelope=[Math.min(...masks.map(r=>r[0])),Math.min(...masks.map(r=>r[1])),Math.max(...masks.map(r=>r[2])),Math.max(...masks.map(r=>r[3]))]
if((envelope[2]-envelope[0])*eastScale>1024||(envelope[3]-envelope[1])*111320>1024)throw new Error('Prototype candidate iteration envelope exceeds 1024 metres; partition terrain generation before larger builds')
await save(destination+'/scene/area.json',{...area,bounds:envelope,coverageMasks:masks,coverageStatus:'candidate union, bounding rectangle is iteration envelope only'})
const captureProvenance=captures.map(c=>({captureId:c.manifest.captureId,tile:c.manifest.tile,bounds:c.manifest.bounds,manifestSHA256:c.manifestSHA256}))
const provenance=await json(source+'/scene/sources/provenance.json');await save(destination+'/scene/sources/provenance.json',{...provenance,candidate:{captures:captureProvenance,coverageMasks:masks,sources,conflicts,baselineSourceSHA256:hash(await readFile(source+'/scene/sources/provenance.json'))}})
let data=await readFile(destination+'/scene/data.mjs','utf8');const oldInside='export const inside = ([x, z]) => x >= bounds[0] && x < bounds[2] && z >= bounds[1] && z < bounds[3]';if(!data.includes(oldInside))throw new Error('Generator inside hook changed');data=data.replace(oldInside,`export const inside = ([x,z]) => ${JSON.stringify(worldMasks)}.some(b=>x>=b[0]&&x<b[2]&&z>=b[1]&&z<b[3])`);await writeFile(destination+'/scene/data.mjs',data)
let build=await readFile(destination+'/assets/models/city/build.mjs','utf8');const recordHook='function record(feature, generated, position, extra = {}) {';if(!build.includes(recordHook))throw new Error('Generator record hook changed');build=build.replace('area, bounds, loadCity','area, bounds, inside, loadCity');build=build.replace(recordHook,`const candidateOwners = new Map(${JSON.stringify(baseline.placements.map(p=>[p.id,p.tile]))})\n${recordHook}\n  if(candidateOwners.has(feature.id))extra={...extra,tile:candidateOwners.get(feature.id)}\n  else if(!['road','terrain'].includes(extra.kind)&&!inside([position[0],position[2]]))return`);await writeFile(destination+'/assets/models/city/build.mjs',build)
// Clip only world-coordinate road/ground geometry. Buildings retain complete mapped footprints.
const helper=`
const candidateMasks=${JSON.stringify(worldMasks)}
function candidateClip(geometry){
 const names=Object.keys(geometry.attributes),index=geometry.index?.array??Array.from({length:geometry.attributes.position.count},(_,i)=>i),out=Object.fromEntries(names.map(k=>[k,[]])),groups=[]
 const sourceGroups=geometry.groups.length?geometry.groups:[{start:0,count:index.length,materialIndex:0}]
 for(const group of sourceGroups){const start=out.position.length/3
  for(let i=group.start;i<group.start+group.count;i+=3){const vertices=[index[i],index[i+1],index[i+2]].map(n=>Object.fromEntries(names.map(k=>{const a=geometry.attributes[k];return[k,Array.from({length:a.itemSize},(_,j)=>a.array[n*a.itemSize+j])]})))
   for(const box of candidateMasks){let polygon=vertices
    for(const [axis,edge,sign]of[[0,box[0],1],[0,box[2],-1],[2,box[1],1],[2,box[3],-1]]){const next=[];for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length],da=(a.position[axis]-edge)*sign,db=(b.position[axis]-edge)*sign;if(da>=0)next.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);next.push(Object.fromEntries(names.map(k=>[k,a[k].map((v,c)=>v+(b[k][c]-v)*t)])))}}polygon=next}
    for(let j=1;j+1<polygon.length;j++)for(const v of[polygon[0],polygon[j],polygon[j+1]])for(const k of names)out[k].push(...v[k])
   }
  }groups.push({start,count:out.position.length/3-start,materialIndex:group.materialIndex})
 }
 const result=new THREE.BufferGeometry();for(const k of names)result.setAttribute(k,new THREE.Float32BufferAttribute(out[k],geometry.attributes[k].itemSize));for(const g of groups)if(g.count)result.addGroup(g.start,g.count,g.materialIndex);geometry.dispose();return result
}
`
let mesh=await readFile(destination+'/assets/models/city/mesh.mjs','utf8');const hook='export function asset(path, parts, materials, extras = {}, resources = {}) {';if(!mesh.includes(hook))throw new Error('Asset hook changed');mesh+=helper;mesh=mesh.replace(hook,hook+"\n  if(path==='assets/models/city/terrain'||path.startsWith('assets/models/city/roads/'))parts=parts.map(p=>({...p,geometry:candidateClip(p.geometry)}))");await writeFile(destination+'/assets/models/city/mesh.mjs',mesh)
function run(file,args=[]){const result=spawnSync(process.execPath,[file,...args],{cwd:destination,encoding:'utf8',maxBuffer:1024*1024*10});if(result.status!==0)throw new Error(result.stderr||result.stdout);console.log(result.stdout.trim())}
run('assets/models/city/build.mjs');run('scene/compose.mjs');run('scene/coverage/runtime-manifest.mjs',[destination+'/scene/coverage/runtime-candidate.json'])
const generated=await json(destination+'/scene/generated.json'),oldIds=new Set(baseline.placements.map(p=>p.id)),added=generated.placements.filter(p=>!oldIds.has(p.id)),changedAssets=[]
for(const p of baseline.placements){try{if(hash(await readFile(source+'/'+p.asset))!==hash(await readFile(destination+'/'+p.asset)))changedAssets.push(p.id)}catch{changedAssets.push(p.id)}}
const preservedOwners=baseline.placements.every(p=>generated.placements.find(n=>n.id===p.id)?.tile===p.tile),overridesUnchanged=originalOverrides.equals(await readFile(destination+'/scene/overrides.json'))
for(const p of inputs)if(hash(await readFile(source+'/'+p))!==before[p])throw new Error('Baseline input changed during candidate build: '+p)
const summary={status:'isolated-geometry-candidate',destination,captures:captureProvenance,origin:area.origin,verticalOriginM:area.verticalOriginM,coverageMasks:masks,addedCoverageSquareMetres:(rectangleArea(masks)-rectangleArea(baselineMasks))*eastScale*111320,sources,conflicts,baselinePlacements:baseline.placements.length,candidatePlacements:generated.placements.length,addedPlacements:added.map(p=>({id:p.id,kind:p.kind,tile:p.tile})),preservedOwners,overridesUnchanged,rebakedBaselineAssetCount:changedAssets.length,rebakedBaselineIds:changedAssets,limitations:['All geometry rebaked coherently against union elevation samples; old terrain is not mixed into new ground.','Saved scene overrides survive compose; authored manual asset modifications need review because generated assets are rebaked in this isolated copy.','Road and terrain triangles clipped exactly to union; complete mapped boundary building footprints may extend beyond it.','Street props follow source roads and require boundary review.','Collision metadata is an unintegrated bounding-envelope draft; not valid for masked runtime physics.','Terrain remains monolithic and must stay pinned until derived partitioning is validated.','No new city coverage is accepted or deployed until streamer traversal and visual seam checks pass.']}
await save(destination+'/scene/coverage/candidate-build-report.json',summary);console.log(JSON.stringify({destination,addedCoverageSquareMetres:summary.addedCoverageSquareMetres,addedPlacements:added.length,preservedOwners,overridesUnchanged,rebakedBaselineAssetCount:changedAssets.length,conflicts:conflicts.length}))
