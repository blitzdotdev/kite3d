// Opt-in offline derivative using pinned meshoptimizer 0.20.0. Never rewrites near.
// node prepare-lod.mjs /tmp/new-bmw-candidate [ratio=.07] [relative-error=.02]
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {MeshoptSimplifier} from 'meshoptimizer'

const source=fileURLToPath(new URL('.',import.meta.url)),output=resolve(process.argv[2]||''),ratio=Number(process.argv[3]||.07),error=Number(process.argv[4]||.02)
if(!output.startsWith('/tmp/')||existsSync(output)||!(ratio>0&&ratio<1)||!(error>0&&error<=.1))throw Error('Require new /tmp output, ratio (0,1), error (0,.1]')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const sourceHashes=Object.fromEntries(['f.gltf','geometry.bin','LICENSE.txt','provenance.json'].map(p=>[p,hash(readFileSync(join(source,p)))]))
const g=JSON.parse(readFileSync(join(source,'f.gltf'))),original=structuredClone(g),bytes=readFileSync(join(source,'geometry.bin')),accessors=g.accessors,views=g.bufferViews
if(g.buffers.length!==1||g.buffers[0].uri!=='geometry.bin'||g.images?.length||g.animations?.length||g.skins?.length)throw Error('Unsupported source dependencies or animation')
await MeshoptSimplifier.ready
MeshoptSimplifier.useExperimentalFeatures=true
const count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},types={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5121:Uint8Array}
function array(id){const a=accessors[id],v=views[a.bufferView],Ctor=types[a.componentType],n=count[a.type];if(!Ctor||!n||a.sparse||v.byteStride&&v.byteStride!==n*Ctor.BYTES_PER_ELEMENT)throw Error('Unsupported source accessor');const start=(v.byteOffset||0)+(a.byteOffset||0);return new Ctor(Uint8Array.from(bytes.subarray(start,start+a.count*n*Ctor.BYTES_PER_ELEMENT)).buffer)}
const chunks=[];let offset=0;g.accessors=[];g.bufferViews=[]
function append(data,old){const padding=(-offset)&3;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}const buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength),view=g.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length})-1;chunks.push(buffer);offset+=buffer.length;const a={...old,bufferView:view,byteOffset:0,count:data.length/count[old.type]};delete a.min;delete a.max;if(old.type==='VEC3'){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<data.length;i++){a.min[i%3]=Math.min(a.min[i%3],data[i]);a.max[i%3]=Math.max(a.max[i%3],data[i])}}return g.accessors.push(a)-1}
const parts=[]
for(const [mi,mesh]of g.meshes.entries())for(const [pi,p]of mesh.primitives.entries()){
 if(p.mode!==undefined&&p.mode!==4||p.targets||p.extensions)throw Error('Unsupported primitive')
 const sourceAttributes=Object.fromEntries(Object.entries(p.attributes).map(([name,id])=>[name,array(id)]))
 const sourcePosition=sourceAttributes.POSITION,indices=Uint32Array.from(array(p.indices)),weld=new Map(),sourceVertices=[],weldMap=new Uint32Array(sourcePosition.length/3)
 // Exact attribute tuples only: reconnect duplicate vertices without smoothing
 // normal seams, changing UVs, or crossing a primitive/material boundary.
 for(let v=0;v<weldMap.length;v++){
  const key=Object.entries(sourceAttributes).map(([name,a])=>{const n=count[accessors[p.attributes[name]].type];return Array.from(a.subarray(v*n,v*n+n)).join(',')}).join('|')
  if(!weld.has(key)){weld.set(key,sourceVertices.length);sourceVertices.push(v)}weldMap[v]=weld.get(key)
 }
 for(let i=0;i<indices.length;i++)indices[i]=weldMap[indices[i]]
 const packed=Object.fromEntries(Object.entries(sourceAttributes).map(([name,a])=>{const n=count[accessors[p.attributes[name]].type],b=new a.constructor(sourceVertices.length*n);sourceVertices.forEach((v,i)=>b.set(a.subarray(v*n,v*n+n),i*n));return[name,b]}))
 const position=packed.POSITION,normal=packed.NORMAL||null
 if(!(position instanceof Float32Array)||normal&&!(normal instanceof Float32Array))throw Error('Expected float geometry')
 const target=Math.min(indices.length,Math.max(36,Math.floor(indices.length*ratio/3)*3))
 const [reduced,achievedError]=normal?MeshoptSimplifier.simplifyWithAttributes(indices,position,3,normal,3,[.1,.1,.1],target,error):MeshoptSimplifier.simplify(indices,position,3,target,error)
 const [remap,vertices]=MeshoptSimplifier.compactMesh(reduced),attributes={}
 for(const [name,id]of Object.entries(p.attributes)){const old=accessors[id],src=packed[name],n=count[old.type],dst=new src.constructor(vertices*n);for(let v=0;v<remap.length;v++)if(remap[v]<vertices)for(let k=0;k<n;k++)dst[remap[v]*n+k]=src[v*n+k];if([...dst].some(v=>!Number.isFinite(v)))throw Error('Nonfinite output');attributes[name]=append(dst,old)}
 p.attributes=attributes;p.indices=append(reduced,{componentType:5125,type:'SCALAR'})
 parts.push({mesh:mi,primitive:pi,name:mesh.name,nearTriangles:indices.length/3,triangles:reduced.length/3,relativeError:achievedError,localPositionErrorBound:achievedError*MeshoptSimplifier.getScale(position,3)})
}
g.buffers=[{uri:'geometry.bin',byteLength:offset}];g.asset.generator+='; opt-in meshoptimizer attribute-aware simplification'
if(JSON.stringify(g.nodes)!==JSON.stringify(original.nodes)||JSON.stringify(g.materials)!==JSON.stringify(original.materials))throw Error('Hierarchy or material mutation')
for(const [p,h]of Object.entries(sourceHashes))if(hash(readFileSync(join(source,p)))!==h)throw Error('Source changed during preparation')
const multiplicity=new Map();for(const node of g.nodes)if(node.mesh!==undefined)multiplicity.set(node.mesh,(multiplicity.get(node.mesh)||0)+1)
const bin=Buffer.concat(chunks),json=Buffer.from(JSON.stringify(g)+'\n')
const report={version:1,status:'isolated-opt-in-unvalidated',creator:'BMW Car IT',license:'CC-BY-4.0',source:'https://github.com/bmwcarit/digital-car-3d',sourceHashes,derivativeHashes:{'f.gltf':hash(json),'geometry.bin':hash(bin)},ratio,relativeError:error,materialsAndHierarchyExact:true,uvNote:'Adapted near asset has POSITION and NORMAL only; all available attributes retained at surviving vertices.',nearUniqueTriangles:parts.reduce((s,p)=>s+p.nearTriangles,0),triangles:parts.reduce((s,p)=>s+p.triangles,0),nearInstancedTriangles:parts.reduce((s,p)=>s+p.nearTriangles*(multiplicity.get(p.mesh)||0),0),instancedTriangles:parts.reduce((s,p)=>s+p.triangles*(multiplicity.get(p.mesh)||0),0),nearBufferBytes:bytes.length,bufferBytes:bin.length,parts}
mkdirSync(output,{recursive:true});writeFileSync(join(output,'f.gltf'),json);writeFileSync(join(output,'geometry.bin'),bin);writeFileSync(join(output,'lod-manifest.json'),JSON.stringify(report,null,2)+'\n');copyFileSync(join(source,'LICENSE.txt'),join(output,'LICENSE.txt'));copyFileSync(join(source,'provenance.json'),join(output,'source-provenance.json'))
writeFileSync(join(output,'README.txt'),'BMW Car IT G05 / BMW X5 2018. CC BY 4.0. https://github.com/bmwcarit/digital-car-3d\nDerivative: offline meshoptimizer simplification; original hierarchy/materials retained. No endorsement. Original near remains unchanged. Verify source hashes before opt-in use; visually validate before substitution.\n')
console.log(JSON.stringify({...report,parts:undefined},null,2))
