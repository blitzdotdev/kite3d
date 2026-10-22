// Deterministic authored foliage, not species reconstruction or sampled imagery.
import {png} from './png.mjs'
import {THREE} from './mesh.mjs'
export function foliageTexture() {
  const size = 256, pixels = Buffer.alloc(size * size * 4)
  function ellipse(cx, cy, rx, ry, angle, shade) {
    const c = Math.cos(angle), s = Math.sin(angle), radius = Math.ceil(Math.max(rx, ry))
    for (let y = Math.max(0, Math.floor(cy-radius)); y <= Math.min(size-1,cy+radius); y++) {
      for (let x = Math.max(0, Math.floor(cx-radius)); x <= Math.min(size-1,cx+radius); x++) {
        const dx=x-cx,dy=y-cy,u=dx*c+dy*s,v=-dx*s+dy*c
        if(u*u/(rx*rx)+v*v/(ry*ry)>1)continue
        const i=(y*size+x)*4, vein=Math.abs(v)<0.7?12:0
        pixels[i]=shade+vein;pixels[i+1]=shade+25+vein;pixels[i+2]=Math.max(20,shade-14);pixels[i+3]=255
      }
    }
  }
  for(let i=0;i<115;i++) {
    const angle=i*2.399963, radius=96*Math.sqrt((i+0.5)/115)
    const x=128+Math.cos(angle)*radius,y=128+Math.sin(angle)*radius*.88
    ellipse(x,y,11+i%6,4+i%3,angle+0.6,45+(i*17)%49)
  }
  return png(size, pixels)
}
export function foliageCards() {
  const positions=[],uv=[],indices=[]
  for(let i=0;i<72;i++) {
    const t=(i+.5)/72, az=i*2.399963, y=1-2*t, r=Math.sqrt(1-y*y)
    const center=new THREE.Vector3(Math.cos(az)*r*2.2,6.7+y*2.55,Math.sin(az)*r*2.2)
    const normal=new THREE.Vector3(Math.cos(az+.5),.35*Math.sin(i*1.7),Math.sin(az+.5)).normalize()
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),normal).normalize().multiplyScalar(1.25)
    const up=new THREE.Vector3().crossVectors(normal,right).normalize().multiplyScalar(1.25)
    const offset=positions.length/3
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]])positions.push(...center.clone().addScaledVector(right,x).addScaledVector(up,y).toArray())
    uv.push(0,0,1,0,1,1,0,1);indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3)
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g
}
