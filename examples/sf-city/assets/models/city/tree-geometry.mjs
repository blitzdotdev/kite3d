// Original static tree templates informed by the connected-branch/crown-normal
// concepts documented in TREE-KIT.md. No newer renderer or shader code is used.
import {THREE} from './mesh.mjs'
export function broadleafGeometry(variant=0,detail='near'){
 if(!['near','mid','far'].includes(detail))throw new Error('Unknown tree detail: '+detail)
 let state=8179+variant*7117
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
 const wood={p:[],n:[],uv:[],c:[],i:[]},leaf={p:[],n:[],uv:[],c:[],i:[]},tips=[]
 const V=(x,y,z)=>new THREE.Vector3(x,y,z)
 function tube(points,r0,r1,rings,sides){
  const curve=new THREE.CatmullRomCurve3(points),origin=wood.p.length/3
  // Preserve every terminal spray and the seeded growth pattern across levels.
  // Only simplify wood hidden inside the crown; leaf thinning previously made
  // distant crowns disappear and must be validated separately.
  if(detail!=='near'){
   if(r0<(detail==='far'?.05:.02))return curve
   rings=Math.max(2,Math.ceil(rings/(detail==='far'?3:2)))
   sides=Math.max(3,Math.ceil(sides/(detail==='far'?2:1.5)))
  }
  let across=V(1,0,0)
  for(let j=0;j<=rings;j++){
   const t=j/rings,p=curve.getPoint(t),axis=curve.getTangent(t).normalize()
   across.addScaledVector(axis,-across.dot(axis)).normalize()
   if(across.lengthSq()<.1)across=V(0,0,1).cross(axis).normalize()
   const around=new THREE.Vector3().crossVectors(axis,across).normalize(),r=r0*(1-t)+r1*t
   for(let k=0;k<=sides;k++){
    const a=k/sides*Math.PI*2,n=across.clone().multiplyScalar(Math.cos(a)).addScaledVector(around,Math.sin(a)),q=p.clone().addScaledVector(n,r)
    wood.p.push(...q);wood.n.push(...n);wood.uv.push(k/sides*Math.PI*2*r0,p.y*.8)
    const shade=.82+.13*Math.min(1,Math.hypot(p.x,p.z)/2);wood.c.push(shade,shade,shade)
    if(j&&k){const b=origin+j*(sides+1)+k;wood.i.push(b,b-1,b-sides-2,b,b-sides-2,b-sides-1)}
   }
  }
  return curve
 }
 const spread=variant===1?1.25:variant===2?.63:1,leader=variant===1?7.1:8.5
 tube([V(0,0,0),V(.06,.35,0),V(-.08,3,.08),V(.15,leader,0)],.34,.055,10,8)
 // A separate short flared root collar blends into the tapered leader.
 tube([V(0,0,0),V(.04,.25,0),V(.03,.65,.015)],.49,.31,3,8)
 for(let k=0;k<6;k++){
  const angle=k*2.399963+variant*.7,y=2.8+k*.62,start=V(.02,y,.03),reach=(2.8-k*.16)*spread
  const end=V(Math.cos(angle)*reach,y+2.5,Math.sin(angle)*reach)
  const limb=tube([start,start.clone().lerp(end,.45).add(V(0,.45,0)),end],.15-k*.013,.035,5,6)
  for(let j=0;j<3;j++){
   const t=.4+j*.23,at=limb.getPoint(t),az=angle+(j%2?1:-1)*(.6+random()*.4),len=(1.25-j*.1)*spread
   const tip=at.clone().add(V(Math.cos(az)*len,.9+random()*.4,Math.sin(az)*len))
   const branch=tube([at,at.clone().lerp(tip,.5).add(V(0,.2,0)),tip],.045,.012,3,4)
   for(let n=0;n<2;n++){
    const p=branch.getPoint(.62+n*.32),a=az+(n?-.7:.7),q=p.clone().add(V(Math.cos(a)*.55*spread,.5+random()*.3,Math.sin(a)*.55*spread))
    tube([p,p.clone().lerp(q,.5).add(V(0,.1,0)),q],.015,.004,2,3)
    tips.push({p:q,d:q.clone().sub(p).normalize()})
   }
  }
 }
 const center=new THREE.Box3().setFromPoints(tips.map(t=>t.p)).getCenter(V(0,0,0))
 for(const tip of tips)for(let j=0;j<6;j++){
  const a=random()*Math.PI*2,size=1.5+random()*.6,up=tip.d.clone().add(V(Math.cos(a)*.55,.2,Math.sin(a)*.55)).normalize(),side=new THREE.Vector3().crossVectors(up,V(Math.cos(a+.7),.1,Math.sin(a+.7))).normalize(),face=new THREE.Vector3().crossVectors(side,up).normalize(),base=leaf.p.length/3
  // Keep geometric winding in the crown-facing hemisphere. DoubleSide shaders
  // flip back-face normals, so flipping only the supplied normals is incorrect.
  const outward=tip.p.clone().addScaledVector(up,size*.425).sub(center)
  outward.y*=.65;outward.normalize();outward.y+=.2;outward.normalize()
  const reverse=face.dot(outward)<0
  if(reverse)face.negate()
  for(const [x,y,u,v]of [[-.5,-.15,0,0],[.5,-.15,1,0],[.5,1,1,1],[-.5,1,0,1]]){
   const p=tip.p.clone().addScaledVector(side,x*size).addScaledVector(up,y*size),out=p.clone().sub(center);out.y*=.65;out.normalize();out.y+=.2;out.normalize()
   const normal=out.multiplyScalar(.75).addScaledVector(face,.25).normalize()
   const shade=.72+.25*Math.min(1,p.distanceTo(center)/3),tint=.92+random()*.08
   leaf.p.push(...p);leaf.n.push(...normal);leaf.uv.push(u,v);leaf.c.push(shade*tint,shade,shade*.93)
  }
  if(reverse)leaf.i.push(base,base+2,base+1,base,base+3,base+2)
  else leaf.i.push(base,base+1,base+2,base,base+2,base+3)
 }
 const maxY=Math.max(...leaf.p.filter((_,i)=>i%3===1)),scale=10/maxY
 function geometry(b){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p.map(v=>v*scale),3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));g.setIndex(b.i);g.computeBoundingBox();return g}
 return {wood:geometry(wood),leaves:geometry(leaf)}
}
