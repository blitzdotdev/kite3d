// Original offline PBR surfaces. Architectural families are heuristic, not surveyed.
import {png} from './png.mjs'
import {write} from '../../../scene/data.mjs'
import {THREE} from './mesh.mjs'
export function bakeBuildingMaterials(){
 const n=512
 for(const name of ['stucco','timber','masonry','stone','roof']){
  const height=new Float32Array(n*n),albedo=Buffer.alloc(n*n*4),rough=Buffer.alloc(n*n*4),normal=Buffer.alloc(n*n*4)
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const i=y*n+x,noise=((x*374761393+y*668265263)^(x*y*1274126177))>>>0,g=(noise%101)/100
   const course=name==='stone'?128:32,row=Math.floor(y/course),joint=(name==='masonry'||name==='stone')&&(y%course<3||(x+(row%2)*64)%(name==='stone'?256:128)<3),seam=name==='timber'&&y%32<3
   height[i]=joint?0:seam?.15:.7+g*(name==='stucco'?.25:.1)
   const block=Math.floor((x+(row%2)*64)/128),variation=((row*31+block*17)%13)-6
   const base=name==='stone'?(joint?180:231+variation*.7):name==='masonry'?(joint?178:220+variation):name==='roof'?135:name==='timber'?238:234
   for(let c=0;c<3;c++)albedo[i*4+c]=Math.max(0,base+(g-.5)*14-(seam?30:0))
   albedo[i*4+3]=255;rough[i*4]=255;rough[i*4+1]=name==='roof'?235:195+g*45;rough[i*4+2]=0;rough[i*4+3]=255
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const i=(y*n+x)*4,dx=height[y*n+(x+1)%n]-height[y*n+(x+n-1)%n],dy=height[((y+1)%n)*n+x]-height[((y+n-1)%n)*n+x]
   const v=new THREE.Vector3(-dx*1.8,-dy*1.8,1).normalize();normal[i]=128+v.x*127;normal[i+1]=128+v.y*127;normal[i+2]=128+v.z*127;normal[i+3]=255
  }
  for(const [suffix,data]of [['color',albedo],['normal',normal],['roughness',rough]])write(`assets/models/city/materials/${name}-${suffix}.png`,png(n,data))
 }
}
export function buildingResources(family,materials){
 const names=[family,'roof'],images=[]
 for(const name of names)for(const suffix of ['color','normal','roughness'])images.push({uri:`/kite3d/assets/models/city/materials/${name}-${suffix}.png`})
 for(const [mi,ti]of [[0,0],[1,3]]){
  materials[mi].pbrMetallicRoughness.baseColorTexture={index:ti}
  materials[mi].pbrMetallicRoughness.metallicRoughnessTexture={index:ti+2}
  materials[mi].normalTexture={index:ti+1,scale:.35}
 }
 return{images,textures:images.map((_,source)=>({source,sampler:0})),samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}]}
}
// Two metres per repeat; project each planar surface in physical local units.
export function metricUV(geometry){
 const p=geometry.attributes.position,n=geometry.attributes.normal,uv=[]
 for(let i=0;i<p.count;i++){
  const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i))
  uv.push((ay>ax&&ay>az?p.getX(i):ax>az?p.getZ(i):p.getX(i))*.5,(ay>ax&&ay>az?p.getZ(i):p.getY(i))*.5)
 }
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
}
