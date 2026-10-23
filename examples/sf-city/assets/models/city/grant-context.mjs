// Photo-estimated north elevation on a real mapped building. No reference pixels.
import {THREE, box} from './mesh.mjs'
export function grantContext(feature, city, base) {
  if (!feature.patch.photoContext) return []
  const source=city.buildings.find(b=>b.id==='sf-building:201006.0004170')
  const ring=source.polygons[0][0],a=ring[28],b=ring[29],length=Math.hypot(a[0]-b[0],a[1]-b[1])
  const u=[(a[0]-b[0])/length,(a[1]-b[1])/length],out=[-u[1],u[0]],anchor=[a[0]-24*u[0],a[1]-24*u[1]]
  const transform=new THREE.Matrix4().set(u[0],0,out[0],anchor[0]-feature.center[0],0,1,0,0,u[1],0,out[1],anchor[1]-feature.center[1],0,0,0,1)
  const parts=[],front=46.28,height=feature.height
  const block=(name,x,y,z,w,h,d,mat)=>{const geometry=box(w,h,d,[x,y+h/2,z],0).applyMatrix4(transform);parts.push({name:'Grant context / '+name,geometry,mat})}
  // The footprint behind this elevation remains unchanged. Openings and shop details
  // are inferred from Figure 128, not an identification of the historical business.
  block('Pale north elevation',front,.05,-7.7,.12,height-.05,15.5,0)
  block('Parapet coping',front-.08,height-.16,-7.7,.3,.18,15.7,3)
  block('Recessed dark shop band',front-.085,.16,-7.7,.06,2.7,15.1,2)
  block('Charcoal shop fascia',front-.14,2.72,-7.7,.12,.32,15.3,4)
  for(const z of [-14.5,-11,-7.5,-4,-.5])block('Shop painted mullion',front-.15,.16,z,.12,2.6,.09,4)
  for(const y of [3.65,7.0])for(const z of [-13.2,-8.5,-3.65,-.95])for(const dz of [-.46,.46]){
    block('Window inset shadow',front-.08,y,z+dz,.08,1.8,.71,2)
    block('Cool recessed glazing',front-.13,y+.08,z+dz,.03,1.63,.57,5)
    for(const edge of [-.36,.36])block('Fine ivory jamb',front-.16,y,z+dz+edge,.12,1.8,.045,3)
    for(const dy of [0,.92,1.8])block('Window sill and sash',front-.18,y+dy,z+dz,.14,.055,.77,3)
  }
  // Small irregular display rectangles stay behind the shop's thin framing.
  for(const [z,y,w,h]of [[-2,.8,.45,.7],[-3.2,1.2,.7,.5],[-7.8,.7,.4,.8],[-10.7,1.3,.5,.4]])block('Inferred shop display',front-.13,y,z,.02,h,w,3)
  return parts
}
