// Offline inspection only. Does not partition geometry or change the scene.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,dirname,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
globalThis.ImageData??=class{}
const {Matrix4,Vector3,Quaternion,Box3}=await import('three')
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../..')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const transform=n=>n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation??[0,0,0])),new Quaternion(...(n.rotation??[0,0,0,1])),new Vector3(...(n.scale??[1,1,1])))
const boxJSON=box=>box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()}
function localPath(path){const absolute=resolve(root,path);if(!absolute.startsWith(root+'/'))throw new Error('Dependency outside project: '+path);return absolute}
export async function deriveRuntimeManifest(){
 const inputs=['assets.json','assets/main.scene.gltf','scene/generated.json','scene/overrides.json'],sourceBytes=await Promise.all(inputs.map(p=>readFile(localPath(p)))),sourceHashes=Object.fromEntries(inputs.map((p,i)=>[p,hash(sourceBytes[i])]))
 const [registry,scene,generated]=sourceBytes.map(b=>JSON.parse(b)),owners=new Map(generated.placements.map(p=>[p.id,p.tile])),dependencies={},assets={},features=[],excluded=[],seen=new Set()
 const dependency=async path=>{if(!dependencies[path]){const bytes=await readFile(localPath(path));dependencies[path]={bytes:bytes.length,sha256:hash(bytes)}}}
 async function inspectAsset(key){
  if(assets[key])return assets[key]
  const entry=registry.files[key];if(!entry)throw new Error('Unregistered asset '+key)
  const paths=[...new Set([entry.path,...Object.values(entry.files??{})])].sort();for(const p of paths)await dependency(p)
  if(!entry.path.endsWith('.gltf'))throw new Error('Candidate inspector requires text glTF: '+entry.path)
  const gltf=JSON.parse(await readFile(localPath(entry.path))),bounds=new Box3(),materials=new Set();let triangles=0,primitives=0
  // URI registry maps are authoritative. Refuse unregistered external dependencies.
  for(const item of [...(gltf.buffers??[]),...(gltf.images??[])])if(item.uri&&!item.uri.startsWith('data:')){
   const mapped=entry.files?.[item.uri]??relative(root,resolve(dirname(localPath(entry.path)),item.uri))
   if(!paths.includes(mapped))throw new Error('Unregistered URI '+item.uri+' in '+entry.path)
  }
  function visit(index,parent,chain=new Set()){
   if(chain.has(index))throw new Error('Cyclic asset node hierarchy')
   const node=gltf.nodes[index],world=parent.clone().multiply(transform(node)),next=new Set(chain).add(index)
   if(node.skin!==undefined||node.weights||node.extensions?.EXT_mesh_gpu_instancing||node.extras?.rootPath)throw new Error('Unsupported dynamic or nested asset bounds in '+entry.path)
   if(node.mesh!==undefined)for(const primitive of gltf.meshes[node.mesh].primitives){
    if(primitive.targets)throw new Error('Morph bounds require evaluation in '+entry.path)
    const accessor=gltf.accessors[primitive.attributes.POSITION],count=primitive.indices===undefined?accessor.count:gltf.accessors[primitive.indices].count,mode=primitive.mode??4
    if(!accessor.min||!accessor.max||[...accessor.min,...accessor.max].some(v=>!Number.isFinite(v)))throw new Error('Missing finite POSITION bounds in '+entry.path)
    bounds.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(world))
    triangles+=mode===4?count/3:mode===5||mode===6?Math.max(0,count-2):0;primitives++;materials.add(primitive.material??'default')
   }
   for(const child of node.children??[])visit(child,world,next)
  }
  const roots=gltf.scenes?.[gltf.scene??0]?.nodes;if(!roots)throw new Error('Missing default asset scene '+entry.path)
  for(const index of roots)visit(index,new Matrix4())
  return assets[key]={path:entry.path,dependencies:paths,dependencyBytes:paths.reduce((s,p)=>s+dependencies[p].bytes,0),localBounds:boxJSON(bounds),triangles,meshPrimitiveInstances:primitives,materialSlots:materials.size}
 }
 async function visit(index,parent,hidden=false,chain=new Set()){
  if(chain.has(index))throw new Error('Cyclic scene hierarchy')
  const node=scene.nodes[index],world=parent.clone().multiply(transform(node)),next=new Set(chain).add(index),invisible=hidden||node.extras?.visible===false
  const ref=node.extras?.rootPath,id=node.extras?.cityId??node.extras?.gltfUUID
  if(ref){
   if(!id||seen.has(id))throw new Error('Missing or duplicate semantic identity at node '+index);seen.add(id)
   const match=/^\/kite3d\/@([^/]+)\/(.+)$/.exec(ref)
   if(!match)throw new Error('Unsupported asset reference '+ref)
   const key=match[1],asset=await inspectAsset(key),entry=registry.files[key]
   if(entry.files?.[match[2]]!==entry.path)throw new Error('Reference is not registered asset entry '+ref)
   const local=asset.localBounds,bounds=local?new Box3(new Vector3(...local.min),new Vector3(...local.max)).applyMatrix4(world):new Box3(),owner=owners.get(id)??null
   features.push({id,nodeIndex:index,name:node.name,ownerTile:owner,ownershipSource:owner?'generated-manifest':'unassigned-authored-object',asset:key,rootPath:ref,visible:!invisible,worldMatrix:world.toArray(),worldBounds:boxJSON(bounds),triangles:asset.triangles})
  }else if(node.mesh!==undefined)excluded.push({nodeIndex:index,reason:'Inline scene mesh requires separate inspector'})
  for(const child of node.children??[])await visit(child,world,invisible,next)
 }
 for(const index of scene.scenes[scene.scene??0].nodes)await visit(index,new Matrix4())
 const tiles={}
 for(const feature of features){const key=feature.ownerTile??'unassigned';const tile=tiles[key]??={featureIds:[],assetKeys:[],geometryBounds:null,triangles:0};tile.featureIds.push(feature.id);tile.assetKeys.push(feature.asset);if(feature.visible)tile.triangles+=feature.triangles}
 for(const tile of Object.values(tiles)){
  tile.featureIds.sort();tile.assetKeys=[...new Set(tile.assetKeys)].sort();tile.dependencies=[...new Set(tile.assetKeys.flatMap(key=>assets[key].dependencies))].sort();tile.coldDependencyBytes=tile.dependencies.reduce((s,p)=>s+dependencies[p].bytes,0)
  const bounds=new Box3();for(const f of features)if(tile.featureIds.includes(f.id)&&f.worldBounds&&f.visible)bounds.union(new Box3(new Vector3(...f.worldBounds.min),new Vector3(...f.worldBounds.max)))
  tile.geometryBounds=boxJSON(bounds)
 }
 for(const path of inputs)if(hash(await readFile(localPath(path)))!==sourceHashes[path])throw new Error('Source changed during inspection; rerun: '+path)
 return{version:1,status:'candidate-inspection-only',streamingImplemented:false,sourceHashes,coordinateSystem:{origin:generated.area.origin,axes:'X east, Y up, Z south',verticalDatum:'NAVD88 minus area.verticalOriginM'},limitations:['Static accessor AABBs are conservative geometry bounds, not ownership-cell extents.','Triangle counts include repeated instances, exclude shadow/effect passes, and are not GPU timings.','Material slots are asset-local indices, not proven equivalent materials.','No LODs, geometry splitting, visibility culling or runtime loading are implemented.','Unassigned authored objects must remain resident until explicit ownership is assigned.','Textures and buffers are counted as stored bytes, not decoded GPU memory.'],features:features.sort((a,b)=>a.id.localeCompare(b.id)),assets,dependencies,tiles,excluded,totals:{features:features.length,ownerTiles:Object.keys(tiles).filter(k=>k!=='unassigned').length,uniqueAssets:Object.keys(assets).length,uniqueDependencyBytes:Object.values(dependencies).reduce((s,d)=>s+d.bytes,0),visibleTriangles:features.filter(f=>f.visible).reduce((s,f)=>s+f.triangles,0)}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=resolve(process.argv[2]??resolve(directory,'captures/runtime-candidate.json')),manifest=await deriveRuntimeManifest();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({output,status:manifest.status,...manifest.totals}))
}
