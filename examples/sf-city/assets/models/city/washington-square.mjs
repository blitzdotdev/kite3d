// Original geometry traced approximately from SF Rec & Park July 2018 concept plan,
// page 6. Three street corners align the drawing, which is explicitly not to scale.
import {THREE,asset,material,box,surface} from './mesh.mjs'
import {clipped} from './streets.mjs'
import {xy} from '../../../scene/data.mjs'
import {groundMaterial,groundResources} from './materials.mjs'
const nw=xy([-122.411018517,37.801169752]),ne=xy([-122.409369117,37.801370656]),se=xy([-122.409189818,37.800445061])
export const planPoint=([x,y])=>[nw[0]+(ne[0]-nw[0])*(x-650)/780+(se[0]-ne[0])*(y-90)/535,nw[1]+(ne[1]-nw[1])*(x-650)/780+(se[1]-ne[1])*(y-90)/535]
const outline=[[705,120],[1400,120],[1400,595],[980,595],[695,265]]
export const parkBoundary=outline.map(planPoint)
const lawnControls=[[1105,195],[1235,205],[1325,260],[1355,350],[1330,455],[1260,520],[1160,540],[1110,525],[1050,475],[1000,452],[925,437],[875,390],[870,330],[900,275],[965,260],[1010,255],[1015,228],[1100,220]]
export function washingtonSquare(ground,record){
 const lawn=new THREE.CatmullRomCurve3(lawnControls.map(([x,y])=>new THREE.Vector3(x,0,y)),true,'catmullrom',.3).getPoints(128).slice(0,-1).map(p=>[p.x,p.z])
 const beds=[[[710,125],[815,125],[815,175],[745,155],[715,265],[695,225]],[[850,125],[1030,125],[1040,165],[850,160]],[[1120,125],[1360,125],[1360,170],[1300,200],[1250,160],[1110,160]],[[1360,210],[1400,210],[1400,575],[1360,575],[1335,530],[1380,420]],[[990,495],[1060,485],[1100,570],[1100,595],[990,595]],[[1200,565],[1270,555],[1320,525],[1350,550],[1330,590],[1210,590]]]
 const masks=points=>{const c=points.map(planPoint);return THREE.ShapeUtils.triangulateShape(c.map(p=>new THREE.Vector2(...p)),[]).map(t=>{let polygon=t.map(i=>c[i]);const [a,b,d]=polygon;if((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0])<0)polygon.reverse();return{polygon,box:[Math.min(...polygon.map(p=>p[0])),Math.min(...polygon.map(p=>p[1])),Math.max(...polygon.map(p=>p[0])),Math.max(...polygon.map(p=>p[1]))]}})}
 const lawnMasks=masks(lawn),bedMasks=beds.flatMap(masks)
 function patch(name,points,mat,lift,holes=[],subtract=[]){
  const contour=points.map(planPoint),rings=holes.map(h=>h.map(planPoint)),coords=[...contour,...rings.flat()],faces=THREE.ShapeUtils.triangulateShape(contour.map(p=>new THREE.Vector2(...p)),rings.map(r=>r.map(p=>new THREE.Vector2(...p))))
  const vertices=[],indices=[],cache=new Map()
  const vertex=([x,z])=>{const key=x.toFixed(6)+','+z.toFixed(6);if(cache.has(key))return cache.get(key);const i=vertices.length;vertices.push([x,ground(x,z)+lift,z]);cache.set(key,i);return i}
  const split=(a,b,c,depth=0)=>{
   // Split only the longest edge. Neighboring patches then sample shared edges
   // at the same positions, avoiding cracks from unrelated triangle depths.
   const lengths=[Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(b[0]-c[0],b[1]-c[1]),Math.hypot(c[0]-a[0],c[1]-a[1])]
   const longest=Math.max(...lengths)
   if(depth<20&&longest>5){const i=lengths.indexOf(longest),v=[a,b,c],p=v[i],q=v[(i+1)%3],r=v[(i+2)%3],m=[(p[0]+q[0])/2,(p[1]+q[1])/2];split(p,m,r,depth+1);split(m,q,r,depth+1);return}
   const cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);indices.push((cross>0?[a,c,b]:[a,b,c]).map(vertex))
  }
  faces.forEach(t=>{for(const polygon of clipped(t.map(i=>coords[i]),subtract))for(let i=1;i+1<polygon.length;i++)split(polygon[0],polygon[i],polygon[i+1])})
  return{name,geometry:surface(vertices,indices,.5),mat}
 }
 const parts=[patch('Plan-derived concrete circulation',outline,0,.025,[lawn],bedMasks),patch('Kidney-shaped central lawn',lawn,1,.04)]
 beds.forEach(bed=>parts.push(patch('Plan-derived planting pocket',bed,2,.04,[ ],lawnMasks)))
 const built=asset('assets/models/city/park/washington-square',parts,[groundMaterial('Park concrete','#cbc7bb',0),groundMaterial('Park lawn','#8ca663',1),material('Low planting beds','#596b42')],{name:'Washington Square plan-derived layout'},groundResources(['concrete','lawn']))
 record({id:'sf-park:washington-square',name:'Washington Square / 2018 plan layout'},built,[0,0,0],{kind:'park',sourceDataset:'SF Rec & Park July 25 2018 concept, p6; hand traced and affine aligned, not surveyed as-built'})
 const benchParts=[]
 for(let i=0;i<5;i++)benchParts.push({name:'Timber seat slat',geometry:box(1.8,.045,.08,[0,.48,-.2+i*.1]),mat:0})
 for(let i=0;i<4;i++)benchParts.push({name:'Timber back slat',geometry:box(1.8,.085,.045,[0,.65+i*.11,-.22]),mat:0})
 for(const x of [-.64,.64])benchParts.push({name:'Cast bench leg',geometry:box(.07,.48,.44,[x,.24,0]),mat:1})
 const bench=asset('assets/models/city/park/bench',benchParts,[material('Weathered park bench timber','#79634a'),material('Painted bench iron','#25362d',.6,.3)],{name:'Original park bench model'})
 const seats=[[910,168],[970,160],[1040,165],[1160,165],[1220,170],[1325,215],[1360,300],[1370,380],[1310,500],[1190,565],[1050,480],[875,290],[865,370]]
 seats.forEach((p,i)=>{const[x,z]=planPoint(p),[cx,cz]=planPoint([1100,365]);record({id:`sf-park:bench-${i}`,name:'Washington Square bench '+(i+1)},bench,[x,ground(x,z)+.05,z],{kind:'park-prop',yaw:Math.atan2(cx-x,cz-z),sourceDataset:'Approximate bench locations from 2018 plan, original dimensions'})})
 for(const [i,p]of [[0,[1105,335]],[1,[1135,350]],[2,[1130,385]],[3,[1090,395]]]){const[x,z]=planPoint(p);record({id:`sf-park:poplar-${i}`,name:'Plan poplar '+(i+1),asset:'assets/models/city/trees/broadleaf-2/f.gltf'},{path:'assets/models/city/trees/broadleaf-2/f.gltf'},[x,ground(x,z),z],{kind:'tree',scale:[.45,1.3,.45],sourceDataset:'2018 plan shows four replacement poplars; crown is an authored approximation'})}
 const pedestal=asset('assets/models/city/park/monument-base',[{name:'Stone plinth',geometry:box(1.65,.4,1.65,[0,.2,0]),mat:0},{name:'Stone pedestal',geometry:box(.85,1.9,.85,[0,1.35,0]),mat:0}],[material('Monument granite','#9b9c93')],{name:'Franklin monument base; sculpture pending'})
 const[x,z]=planPoint([1105,365]);record({id:'sf-park:franklin-base',name:'Franklin monument base / sculpture pending'},pedestal,[x,ground(x,z),z],{kind:'park-prop',sourceDataset:'Plan-position estimate; simplified base, sculpture not reconstructed'})
}
