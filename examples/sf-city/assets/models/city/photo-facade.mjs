// Component-level photo facade. Mapped footprint, roof and semantic building ID stay intact.
import {readFileSync} from 'node:fs'
import {resolve, dirname} from 'node:path'
import {THREE, surface} from './mesh.mjs'
import {root, read} from '../../../scene/data.mjs'
export function photoFacade(feature, ground, base, top, bottom, materialOffset = 6) {
  const patch=feature.patch.photoFacade
  if(!patch)return null
  if(patch.asset!=='assets/models/architecture/grant-storefront/f.gltf')throw Error('Unsupported photo-facade asset')
  const ring=feature.polygons[0][0],edge=patch.edgeIndex
  if(!Number.isInteger(edge)||!ring[edge])throw Error('Invalid photo facade edge')
  const south=ring[edge],north=ring[(edge+1)%ring.length],length=Math.hypot(south[0]-north[0],south[1]-north[1]),width=24
  if(length<width)throw Error('Photo facade exceeds its mapped edge')
  const u=[(south[0]-north[0])/length,(south[1]-north[1])/length],out=[-u[1],u[0]],anchor=[south[0]-width*u[0],south[1]-width*u[1]]
  const floor=Math.max(...Array.from({length:25},(_,i)=>ground(anchor[0]+u[0]*i,anchor[1]+u[1]*i)))+.005
  const originY=floor-.16,scaleY=(top-originY)/11.56
  const point=([x,y,z])=>[anchor[0]+u[0]*x+out[0]*z,originY+y*scaleY,anchor[1]+u[1]*x+out[1]*z]
  const transform=new THREE.Matrix4().set(u[0],0,out[0],anchor[0]-feature.center[0],0,scaleY,0,originY-base,u[1],0,out[1],anchor[1]-feature.center[1],0,0,0,1)
  const doc=read(patch.asset),buffer=readFileSync(resolve(root,dirname(patch.asset),doc.buffers[0].uri)),parts=[]
  function attribute(id){const a=doc.accessors[id],view=doc.bufferViews[a.bufferView],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],Ctor={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];if(view.byteStride)throw Error('Unexpected interleaved facade');const start=(view.byteOffset||0)+(a.byteOffset||0),bytes=buffer.subarray(start,start+a.count*n*Ctor.BYTES_PER_ELEMENT);return new THREE.BufferAttribute(new Ctor(Uint8Array.from(bytes).buffer),n)}
  for(const node of doc.nodes){
    if(node.mesh===undefined||/^(Neighbour|Distant|Tower|Parking|Road|Curb|Walkway|Pavement joint)/.test(node.name))continue
    for(const primitive of doc.meshes[node.mesh].primitives){
      const geometry=new THREE.BufferGeometry();for(const [name,id]of Object.entries(primitive.attributes))geometry.setAttribute({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv'}[name],attribute(id));geometry.setIndex(attribute(primitive.indices));geometry.applyMatrix4(transform);parts.push({name:'Photo facade / '+node.name,geometry,mat:primitive.material+materialOffset})
    }
  }
  // The mapped south corner continues beyond the long straight frontage. Give its
  // short return faces inferred shop glazing and sash windows instead of a blank wall.
  // These openings are estimated; the footprint itself remains the DataSF outline.
  for(const index of [24,25,26,27]){
    const a=ring[index],b=ring[index+1],dx=b[0]-a[0],dz=b[1]-a[1],w=Math.hypot(dx,dz),ex=dx/w,ez=dz/w,ox=ez,oz=-ex
    if(w<.6)continue
    const frame=(name,y,height,width,depth,mat,offset=0)=>{
      const m=new THREE.Matrix4().set(ex,0,ox,(a[0]+b[0])/2+ox*offset-feature.center[0],0,1,0,originY+y*scaleY+height/2-base,ez,0,oz,(a[1]+b[1])/2+oz*offset-feature.center[1],0,0,0,1)
      parts.push({name:'Photo corner / '+name,geometry:new THREE.BoxGeometry(width,height,depth).applyMatrix4(m),mat})
    }
    frame('Shop dark recess',.7,2.25,w-.18,.035,11,.025)
    frame('Shop transom',3.12,.9,w-.18,.04,19,.03)
    for(const yy of [.65,3.02,4.14])frame('Ivory shop lintel',yy,.09,w,.12,7,.06)
    for(const yy of [5.05,8.0]){
      frame('Ivory sash surround',yy,2.15,Math.min(1.18,w-.18),.10,7,.06)
      frame('Burgundy sash',yy+.09,1.96,Math.min(1.02,w-.3),.08,9,.12)
      frame('Recessed window',yy+.17,1.8,Math.min(.87,w-.45),.025,11,.17)
      frame('Sash crossrail',yy+1.03,.07,Math.min(1.02,w-.3),.06,7,.19)
    }
  }
  // Fill the downhill ground gap beneath the level shop floor, rather than warping windows.
  for(let x=0;x<width;x++){
    const a=point([x,.16,0]),b=point([x+1,.16,0]);const local=p=>[p[0]-feature.center[0],p[1]-base,p[2]-feature.center[1]]
    parts.push({name:'Photo facade / ground-contact plinth',mat:materialOffset,geometry:surface([local([a[0],Math.min(bottom,ground(a[0],a[2])-.08),a[2]]),local([b[0],Math.min(bottom,ground(b[0],b[2])-.08),b[2]]),local(b),local(a)],[[0,1,2],[0,2,3]])})
  }
  const study=read('scene/photo-study.json')
  return {edge,width,length,parts,materials:doc.materials,resources:{images:doc.images,textures:doc.textures,samplers:doc.samplers,extensionsUsed:doc.extensionsUsed},point,backgroundTower:patch.backgroundTower===true,
    view:{name:'Grant study',position:point(study.camera.position),target:point(study.camera.target),fov:study.camera.fov,projectionShift:study.camera.projectionMatrixYShift},
    provenance:{reference:'scene/photo-study.json',parcel:'0115019',sourceBuilding:feature.id,edgeIndex:edge,partialFrontageM:width,anchor,originY,scaleY,yaw:-Math.atan2(u[1],u[0]),placementAccuracy:'Mapped building and street-facing edge; partial-frontage offset inferred, not surveyed',cornerCorrection:patch.flattenCorner?'Photo-estimated flattened corner, not surveyed':null}}
}
export function retainedWalls(feature,photo,base,bottom,top){
  const parts=[],[cx,cz]=feature.center
  for(const [pi,polygon]of feature.polygons.entries())for(const [ri,ring]of polygon.entries())for(let i=0;i<ring.length;i++){
    let a=ring[i];const b=ring[(i+1)%ring.length]
    if(pi===0&&ri===0&&i===photo.edge){const t=photo.width/photo.length;a=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}
    const signed=ring.reduce((sum,p,j)=>{const q=ring[(j+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1]},0)
    // Manual photo-view inspection exposed shadow acne: double-sided shading hid
    // inward wall normals, so shadow normal bias offset samples into the building.
    const reverse=ri===0?signed>0:signed<0
    parts.push({name:'Retained footprint wall',mat:0,geometry:surface([[a[0]-cx,bottom-base,a[1]-cz],[b[0]-cx,bottom-base,b[1]-cz],[b[0]-cx,top-base,b[1]-cz],[a[0]-cx,top-base,a[1]-cz]],reverse?[[0,2,1],[0,3,2]]:[[0,1,2],[0,2,3]])})
  }
  return parts
}
