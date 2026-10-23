// Original landmark silhouette, based on the church's published dimensions and facade
// photograph. Ornament, hidden sides and opening depths are estimated, not scanned.
import{THREE,box,surface}from'./mesh.mjs'
export function churchParts(feature,base,ground){
 const ring=feature.polygons[0][0],a=ring[4],b=ring[3],l=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/l,uz=(b[1]-a[1])/l,nx=-uz,nz=ux,cx=(a[0]+b[0])/2,cz=(a[1]+b[1])/2,y0=ground(cx,cz)-base
 const transform=new THREE.Matrix4().makeBasis(new THREE.Vector3(ux,0,uz),new THREE.Vector3(0,1,0),new THREE.Vector3(nx,0,nz));transform.setPosition(cx-feature.center[0],y0,cz-feature.center[1])
 const parts=[],add=(name,g,mat=0)=>{g.applyMatrix4(transform);parts.push({name,geometry:g,mat})},block=(name,x,y,z,w,h,d,mat=0)=>add(name,box(w,h,d,[x,y+h/2,z]),mat)
 // Genuine openings and thick surrounds, not painted arch silhouettes.
 const arch=(w,h)=>{const p=new THREE.Shape();p.moveTo(-w/2,0);p.lineTo(w/2,0);p.lineTo(w/2,h-w/2);p.absarc(0,h-w/2,w/2,0,Math.PI,false);p.lineTo(-w/2,0);return p}
 function arcadeFace(x,y,z,yaw=0){
  const wall=new THREE.Shape();wall.moveTo(-3.25,0);wall.lineTo(3.25,0);wall.lineTo(3.25,8);wall.lineTo(-3.25,8);wall.closePath()
  const opening=arch(4.7,7.3);wall.holes.push(new THREE.Path(opening.getPoints(32)))
  const g=new THREE.ExtrudeGeometry(wall,{depth:.48,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:1,steps:1,curveSegments:20});g.rotateY(yaw);g.translate(x,y,z);add('Arched belfry masonry',g)
  const rim=new THREE.EllipseCurve(0,4.95,2.54,2.54,0,Math.PI,false,0).getPoints(24).map(p=>new THREE.Vector3(p.x,p.y,.56))
  const molding=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim),24,.16,6,false);molding.rotateY(yaw);molding.translate(x,y,z);add('Belfry arch molding',molding,3)
 }
 function gable(x,y,z,width,rise){
  add('Stepped stone pediment',surface([[x-width/2,y,z],[x+width/2,y,z],[x,y+rise,z]],[[0,1,2]]),0)
  for(const side of [-1,1]){const a=new THREE.Vector3(x,y+rise,z+.16),b=new THREE.Vector3(x+side*width/2,y,z+.16),d=b.clone().sub(a),g=new THREE.BoxGeometry(.28,d.length(),.38);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate(...a.add(b).multiplyScalar(.5).toArray());add('Gable coping',g,3)}
 }
 // Main mass and footprint remain the mapped building. Only its facade/roof kit changes.
 add('Church nave pitched roof',surface([[-10,22,-46],[10,22,-46],[0,29,-46],[-10,22,0],[10,22,0],[0,29,0]],[[0,3,5],[0,5,2],[2,5,4],[2,4,1],[3,4,5]]),1)
 add('Central gabled facade',surface([[-8,20,.22],[8,20,.22],[0,29,.22]],[[0,1,2]]),0)
 for(const x of [-10.9,10.9]){
  block('Tower shaft',x,0,-2.8,6.5,32,6.5)
  for(const y of [10,21,30.5,39.3,43])block('Tower stone belt',x,y,-2.8,7,.5,7,3)
  arcadeFace(x,32,.1);arcadeFace(x+3.25,32,-3.15,Math.PI/2);arcadeFace(x-3.25,32,-3.15,-Math.PI/2)
  gable(x,40,.6,7.1,4.2)
  // Open belfry with substantial columns and arch surrounds.
  for(const dx of [-2.8,2.8])for(const z of [-5.6,0])block('Belfry corner pier',x+dx,32,z,.65,7.3,.65,3)
  for(const dx of [-1,1])block('Belfry front column',x+dx,32,.2,.35,7.3,.35,3)
  block('Belfry lintel',x,39,-2.8,6.5,.65,6.5,3)
  for(const dx of [-1,1]){add('Belfry column capital',new THREE.CylinderGeometry(.34,.22,.35,8).translate(x+dx,39,.2),3);add('Belfry column base',new THREE.CylinderGeometry(.25,.35,.35,8).translate(x+dx,32.2,.2),3)}
  block('Upper tower drum',x,39.6,-2.8,4.6,4.5,4.6)
  for(let i=0;i<8;i++){const t=i*Math.PI/4;add('Octagonal lantern column',new THREE.CylinderGeometry(.15,.2,5,8).translate(x+Math.sin(t)*1.8,46.5,-2.8+Math.cos(t)*1.8),3)}
  add('Octagonal lantern cornice',new THREE.CylinderGeometry(2.25,2.35,.65,8).translate(x,49.3,-2.8),3)
  add('Stone spire',new THREE.ConeGeometry(1.95,6.7,8).translate(x,52.95,-2.8),0)
  block('Spire cross upright',x,56.2,-2.8,.14,2,.14,3);block('Spire cross arm',x,57.3,-2.8,1,.13,.14,3)
  for(const dx of [-3.3,3.3]){
   block('Corner pinnacle stem',x+dx,29,-.15,.6,5,.6,3)
   add('Corner pinnacle roof',new THREE.ConeGeometry(.65,2.8,4).rotateY(Math.PI/4).translate(x+dx,35.4,-.15),0)
  }
 }
 for(const x of [-10.9,0,10.9]){
  gable(x,21.5,.6,x===0?16:7.8,x===0?7.5:4.5)
  const w=x===0?3.5:2.4,h=x===0?7.2:5.6,shape=new THREE.Shape();shape.moveTo(-w,0);shape.lineTo(w,0);shape.lineTo(w,h-w);shape.absarc(0,h-w,w,0,Math.PI,false);shape.lineTo(-w,0)
  add('Arched entrance shadow',new THREE.ShapeGeometry(shape,20).translate(x,.15,.52),2)
  for(const side of [-1,1]){block('Portal stone jamb',x+side*(w+.24),.1,.6,.42,h-w,.58,3);block('Recessed timber door',x+side*w*.48,.15,.56,w*.9,h-w-.2,.08,4);for(const yy of [.6,2,3.4])if(yy<h-w-.5)block('Door recessed panel',x+side*w*.48,yy,.62,w*.65,.9,.045,4)}
  const arc=new THREE.EllipseCurve(x,h-w+.15,w+.18,w+.18,0,Math.PI,false,0).getPoints(24).map(p=>new THREE.Vector3(p.x,p.y,.6));add('Portal stone archivolt',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc),24,.22,6,false),3)
 }
 add('Rose window dark opening',new THREE.CircleGeometry(2.13,32).translate(0,17,.35),2)
 add('Rose window stone ring',new THREE.TorusGeometry(2.25,.19,8,32).translate(0,17,.48),3)
 for(let i=0;i<12;i++){const t=i*Math.PI/6,g=box(.1,2,.13,[0,1,0]);g.rotateZ(t);g.translate(0,17,.5);add('Rose window tracery',g,3)}
 for(let x=-7;x<=7;x+=1.15){block('Facade arcade column',x,10,.55,.18,2,.25,3);add('Facade arcade head',new THREE.TorusGeometry(.48,.09,5,12,Math.PI).translate(x+.57,12,.55),3)}
 return parts
}
