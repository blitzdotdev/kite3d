// Original unbranded parked-vehicle approximation. Not a scanned or make-specific model.
import {THREE,material,surface,box,asset} from '../../city/mesh.mjs'
for(const [name,color,roof]of [['blue-crossover','#263c52',1.65],['silver-sedan','#b7b9b5',1.4]]){
 const mats=[material('Painted body',color,.22,.65),material('Tyre rubber','#242525',.95),material('Alloy wheels','#969d9c',.24,.8),material('Glazing','#33474e',.16,.65),material('Dark grille','#151c1e',.55),material('Headlight lens','#c5d7d9',.2,.35),material('Tail light','#943831',.25),material('Chrome trim','#b1b9b8',.18,.9)]
 const parts=[]
 const block=(label,w,h,d,p,mat)=>{const g=box(w,h,d,p);g.clearGroups();parts.push({name:label,geometry:g,mat})}
 const quad=(label,p,mat)=>parts.push({name:label,geometry:surface(p,[[0,1,2],[0,2,3]]),mat})
 const controls=[[-2.22,.28,.85,.77],[-2.06,.26,.96,.88],[-1.4,.25,1.02,.94],[-.8,.24,1.04,.93],[.9,.25,1.07,.93],[1.8,.29,1.02,.91],[2.15,.32,.9,.78]]
 const sections=[]
 for(let k=0;k<=70;k++){
  const x=-2.22+4.37*k/70,i=Math.min(controls.length-2,Math.max(0,controls.findIndex((p,j)=>j<controls.length-1&&x>=p[0]&&x<=controls[j+1][0]))),a=controls[i],b=controls[i+1],t=(x-a[0])/(b[0]-a[0]);let bottom=a[1]+(b[1]-a[1])*t
  for(const wheel of [-1.4,1.4]){const dx=x-wheel;if(Math.abs(dx)<.385)bottom=Math.max(bottom,.335+Math.sqrt(.385*.385-dx*dx))}
  sections.push([x,bottom,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t])
 }
 const points=[],tris=[]
 for(const [x,b,t,w]of sections)for(const [z,y]of [[w*.96,b],[w,Math.min(b+.055,t-.15)],[w*.98,t-.12],[w*.76,t],[-w*.76,t],[-w*.98,t-.12],[-w,Math.min(b+.055,t-.15)],[-w*.96,b]])points.push([x,y,z])
 for(let i=0;i<sections.length-1;i++)for(let j=0;j<8;j++){const a=i*8+j,b=i*8+(j+1)%8,c=b+8,d=a+8;tris.push([a,b,c],[a,c,d])}
 for(const end of [0,sections.length-1])for(let j=1;j<7;j++)tris.push(end===0?[0,j+1,j]:[end*8,end*8+j,end*8+j+1])
 parts.push({name:'Contoured body shell',geometry:surface(points,tris),mat:0})
 // Curved laminated windscreen and shallow crowned roof, not a flat cabin box.
 const wp=[],wt=[];for(let j=0;j<=8;j++)for(let i=0;i<=12;i++){const u=i/6-1,v=j/8;wp.push([-1.08+.65*v-.07*(1-u*u)*Math.sin(Math.PI*v),1.02+(roof-1.02)*v,u*(.73-.09*v)])}
 for(let j=0;j<8;j++)for(let i=0;i<12;i++){const a=j*13+i;wt.push([a,a+1,a+14],[a,a+14,a+13])}parts.push({name:'Curved windscreen',geometry:surface(wp,wt),mat:3})
 const rp=[],rt=[];for(let j=0;j<=6;j++)for(let i=0;i<=12;i++){const u=i/6-1,v=j/6;rp.push([-.43+1.48*v,roof+.045*(1-u*u)*Math.sin(Math.PI*v),u*.64])}for(let j=0;j<6;j++)for(let i=0;i<12;i++){const a=j*13+i;rt.push([a,a+1,a+14],[a,a+14,a+13])}parts.push({name:'Crowned roof',geometry:surface(rp,rt),mat:0})
 quad('Rear screen',[[1.05,roof,-.64],[1.05,roof,.64],[1.73,1.05,.73],[1.73,1.05,-.73]],3)
 for(const sign of [-1,1]){
  quad('Side glazing',[[-1.03,1.04,sign*.76],[-.4,roof-.04,sign*.65],[1.02,roof-.04,sign*.65],[1.67,1.08,sign*.76]],3)
  // Slender painted window surround follows each sloping pillar.
  for(const [a,b]of [[[-1.08,1.02,sign*.75],[-.43,roof,sign*.65]],[[1.05,roof,sign*.65],[1.73,1.05,sign*.75]]]){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),direction=end.clone().sub(start);const g=new THREE.CylinderGeometry(.025,.025,direction.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray());g.clearGroups();parts.push({name:'Painted pillar',geometry:g,mat:0})}
  block('B pillar',.1,roof-1.03,.035,[.32,(roof+1.03)/2,sign*.71],4)
  block('Door chrome belt',2.75,.035,.045,[.3,1.035,sign*.83],7)
  for(const x of [-.2,1.1])block('Door handle',.19,.045,.065,[x,.94,sign*.89],7)
  block('Mirror housing',.27,.15,.2,[-.77,1.09,sign*1.02],0)
  block('Lower sill',1.95,.07,.045,[0,.27,sign*.93],4)
  for(const x of [-1.4,1.4]){
   const tyre=new THREE.CylinderGeometry(.335,.335,.22,24).rotateX(Math.PI/2).translate(x,.335,sign*.87);tyre.clearGroups();parts.push({name:'Tyre',geometry:tyre,mat:1})
   const rim=new THREE.CylinderGeometry(.235,.235,.235,20).rotateX(Math.PI/2).translate(x,.335,sign*.875);rim.clearGroups();parts.push({name:'Wheel rim',geometry:rim,mat:4})
   for(let k=0;k<5;k++){const angle=k*Math.PI*2/5;const spoke=box(.035,.4,.025,[0,0,0]);spoke.rotateZ(angle);spoke.translate(x,.335,sign*1.001);spoke.clearGroups();parts.push({name:'Wheel spoke',geometry:spoke,mat:2})}
  }
  block('Headlight',.08,.14,.42,[-2.095,.79,sign*.55],5)
  block('Tail light',.07,.19,.3,[2.09,.78,sign*.54],6)
 }
 block('Front grille',.06,.23,.88,[-2.23,.62,0],4)
 for(const y of [.55,.62,.69])block('Grille slat',.065,.018,.85,[-2.265,y,0],7)
 block('Front lower bumper',.07,.13,1.35,[-2.23,.34,0],4)
 block('Blank front plate',.08,.12,.3,[-2.28,.55,0],5)
 console.log(asset('assets/models/vehicles/photo-parked/'+name,parts,mats,{name:'Original '+name,provenance:'Author-created approximation; silhouette and materials inferred from photo; not make-specific'}))
}
