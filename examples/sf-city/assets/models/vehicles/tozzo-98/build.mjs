// Adapt the attributed CC-BY-4.0 source to editable external-resource glTF.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath}from'node:url'
import {THREE as T}from'../../city/mesh.mjs'
const dir=fileURLToPath(new URL('.',import.meta.url)),source=readFileSync(dir+'source.glb'),jsonLength=source.readUInt32LE(12),g=JSON.parse(source.subarray(20,20+jsonLength)),binStart=28+jsonLength,bin=source.subarray(binStart),imageViews=new Set()
mkdirSync(dir+'textures',{recursive:true})
for(const [i,img]of g.images.entries()){const v=g.bufferViews[img.bufferView],ext=img.mimeType==='image/png'?'png':'jpg',name=`textures/image-${i}.${ext}`;writeFileSync(dir+name,bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength));imageViews.add(img.bufferView);delete img.bufferView;img.uri=name}
const chunks=[],viewMap=new Map(),views=[];let offset=0
for(const [i,v]of g.bufferViews.entries()){if(imageViews.has(i))continue;viewMap.set(i,views.length);views.push({...v,buffer:0,byteOffset:offset});const data=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);chunks.push(data);offset+=data.length;const padding=(-offset)&3;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}}
for(const a of g.accessors)if(a.bufferView!==undefined)a.bufferView=viewMap.get(a.bufferView)
g.bufferViews=views;g.buffers=[{uri:'geometry.bin',byteLength:offset}]
const bounds=new T.Box3(),world=new Map()
function visit(index,parent){const n=g.nodes[index],m=n.matrix?new T.Matrix4().fromArray(n.matrix):new T.Matrix4().compose(new T.Vector3(...n.translation||[0,0,0]),new T.Quaternion(...n.rotation||[0,0,0,1]),new T.Vector3(...n.scale||[1,1,1]));m.premultiply(parent);world.set(index,m);if(n.mesh!==undefined)for(const p of g.meshes[n.mesh].primitives){const a=g.accessors[p.attributes.POSITION];bounds.union(new T.Box3(new T.Vector3(...a.min),new T.Vector3(...a.max)).applyMatrix4(m))}for(const child of n.children||[])visit(child,m)}
for(const i of g.scenes[g.scene||0].nodes)visit(i,new T.Matrix4())
const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),scale=4.5/size.x
const transform=new T.Matrix4().makeRotationY(Math.PI).multiply(new T.Matrix4().makeScale(scale,scale,scale)).multiply(new T.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z))
const nodes=[{name:'Tozzo 98 sedan',children:[],extras:{cityBakedAsset:'assets/models/vehicles/tozzo-98/f.gltf',attribution:g.asset.extras}}],meshes=[]
for(const [index,m]of world){const n=g.nodes[index];if(n.mesh===undefined)continue;for(const p of g.meshes[n.mesh].primitives){const mesh=meshes.push({name:n.name,primitives:[p]})-1;nodes[0].children.push(nodes.length);nodes.push({name:n.name||'Sedan part',mesh,matrix:new T.Matrix4().multiplyMatrices(transform,m).toArray(),extras:{cityBakedPart:true}})}}
g.nodes=nodes;g.meshes=meshes;g.scenes=[{name:'Editable sedan',nodes:[0]}];g.scene=0;delete g.animations
writeFileSync(dir+'geometry.bin',Buffer.concat(chunks));writeFileSync(dir+'f.gltf',JSON.stringify(g)+'\n');console.log(JSON.stringify({size:size.toArray(),scale,geometryBytes:offset,parts:nodes.length-1}))

const dark=structuredClone(g);dark.materials.find(m=>m.name==='Tozzo98_Bodymat').pbrMetallicRoughness.baseColorFactor=[.012,.018,.022,1];writeFileSync(dir+'dark.gltf',JSON.stringify(dark)+'\n')
