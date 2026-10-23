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
  for(let i=0;i<160;i++) {
    const angle=i*2.399963, radius=96*Math.sqrt((i+0.5)/160)
    const x=128+Math.cos(angle)*radius,y=128+Math.sin(angle)*radius*.88
    ellipse(x,y,11+i%6,6+i%3,Math.sin(i*18.137)*Math.PI,45+(i*17)%49)
  }
  return png(size, pixels)
}
export function foliageCards(variant = 0) {
  const positions=[],uv=[],indices=[]
  for(let i=0;i<72;i++) {
    const t=(i+.5)/72, az=i*2.399963, y=1-2*t, r=Math.sqrt(1-y*y)
    const center=new THREE.Vector3(Math.cos(az)*r*(variant===1?2.8:2.2),6.7+y*(variant===2?3.1:2.55),Math.sin(az)*r*(variant===1?2.5:2.2))
    const normal=new THREE.Vector3(Math.cos(az+.5),.35*Math.sin(i*1.7),Math.sin(az+.5)).normalize()
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),normal).normalize().multiplyScalar(1.25)
    const up=new THREE.Vector3().crossVectors(normal,right).normalize().multiplyScalar(1.25)
    const offset=positions.length/3
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]])positions.push(...center.clone().addScaledVector(right,x).addScaledVector(up,y).toArray())
    uv.push(0,0,1,0,1,1,0,1);indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3)
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g
}

// Original pinnate palm crown. Curved leaflets replace the coarse diamond cards.
// Dimensions are an authored archetype, not an inventory-derived crown survey.
export function palmCrown(){
 const parts=[]
 for(let k=0;k<14;k++){
  const az=k*2.399963,length=3.2+(k%3)*.35,drop=1.2+(k%4)*.35
  const point=t=>new THREE.Vector3(Math.cos(az)*length*t,9.2+1.6*Math.sin(t*Math.PI*.8)-drop*t*t,Math.sin(az)*length*t)
  const curve=new THREE.CatmullRomCurve3(Array.from({length:9},(_,i)=>point(i/8)))
  parts.push({name:`Palm frond ${k+1} rachis`,geometry:new THREE.TubeGeometry(curve,12,.025,4,false),mat:0})
  const positions=[],indices=[]
  for(let j=2;j<23;j++){
   const t=j/24,center=point(t),forward=point(Math.min(1,t+.02)).sub(center).normalize(),side=new THREE.Vector3(-Math.sin(az),0,Math.cos(az)),span=.8*Math.sin(Math.PI*t)**.65
   for(const sign of [-1,1]){
    const tip=center.clone().addScaledVector(side,sign*span).addScaledVector(forward,.24);tip.y-=.25+span*.25
    const mid=center.clone().lerp(tip,.55);mid.y+=.09
    const i=positions.length/3
    positions.push(...center.clone().addScaledVector(forward,-.035).toArray(),...mid.clone().addScaledVector(forward,-.055).toArray(),...tip.toArray(),...mid.clone().addScaledVector(forward,.055).toArray(),...center.clone().addScaledVector(forward,.035).toArray())
    indices.push(i,i+1,i+3,i+1,i+2,i+3,i,i+3,i+4)
   }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();parts.push({name:`Palm frond ${k+1} pinnate leaflets`,geometry:g,mat:0})
 }
 return parts
}
