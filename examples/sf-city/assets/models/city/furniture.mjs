// Original reusable street furniture; inferred placement, not an inventory survey.
import {THREE,asset,material,box} from './mesh.mjs'
export function streetFurniture(city,ground,bounds,record){
 const metal=material('Street furniture dark bronze','#303c38',.48,.55),glass=material('Lamp opal diffuser','#ddd9ba',.35)
 const parts=[{name:'Fluted base',geometry:new THREE.CylinderGeometry(.17,.25,.65,12).translate(0,.325,0),mat:0},{name:'Tapered shaft',geometry:new THREE.CylinderGeometry(.065,.105,5.2,10).translate(0,3.15,0),mat:0},{name:'Lantern frame',geometry:box(.48,.12,.48,[0,5.83,0]),mat:0},{name:'Lantern diffuser',geometry:new THREE.CylinderGeometry(.2,.14,.55,8).translate(0,6.12,0),mat:1},{name:'Lantern cap',geometry:new THREE.ConeGeometry(.32,.23,8).translate(0,6.51,0),mat:0}]
 const lamp=asset('assets/models/city/props/street-lamp',parts,[metal,glass],{name:'Authored neighborhood street lantern'})
 const bin=asset('assets/models/city/props/litter-bin',[{name:'Bin body',geometry:new THREE.CylinderGeometry(.25,.27,.85,16).translate(0,.425,0),mat:0},{name:'Bin rim',geometry:new THREE.TorusGeometry(.26,.035,6,16).rotateX(Math.PI/2).translate(0,.86,0),mat:0},{name:'Recessed lid',geometry:new THREE.CylinderGeometry(.23,.23,.035,16).translate(0,.79,0),mat:1}],[metal,material('Bin opening','#111a17')],{name:'Authored litter bin'})
 const inside=(p,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
 const placed=[]
 for(const road of city.roads){
  if(road.sidewalk<1.3||road.id==='sf-road:6404000')continue
  for(let j=1;j<road.points.length;j++){
   const a=road.points[j-1],b=road.points[j],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<35)continue
   const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len
   for(let s=15,index=0;s<len-12;s+=38,index++){
    const side=index%2?1:-1,off=road.width/2+.55,x=a[0]+ux*s-uz*off*side,z=a[1]+uz*s+ux*off*side
    if(x<bounds[0]||x>bounds[2]||z<bounds[1]||z>bounds[3]||placed.some(p=>Math.hypot(p[0]-x,p[1]-z)<15))continue
    if(city.buildings.some(f=>f.polygons.some(p=>inside([x,z],p[0]))))continue
    // Keep furniture clear of other carriageways and crossing approaches.
    if(city.roads.some(r=>r.id!==road.id&&r.points.slice(1).some((q,k)=>{const p=r.points[k],dx=q[0]-p[0],dz=q[1]-p[1],t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(x-p[0]-t*dx,z-p[1]-t*dz)<r.width/2+3})))continue
    placed.push([x,z]);const id=`sf-prop:${road.sourceId}-${j}-${index}`
    record({id,name:'Inferred street lantern'},lamp,[x,ground(x,z)+.17,z],{kind:'street-prop',sourceDataset:'Heuristic curb placement, original authored model'})
    if(index%3===0)record({id:id+'-bin',name:'Inferred litter bin'},bin,[x+ux*.8,ground(x+ux*.8,z+uz*.8)+.17,z+uz*.8],{kind:'street-prop',sourceDataset:'Heuristic sidewalk placement, original authored model'})
   }
  }
 }
}
