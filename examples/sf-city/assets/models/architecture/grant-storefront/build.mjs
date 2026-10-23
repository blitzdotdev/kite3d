const {RoundedBoxGeometry} = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js')
import {surfaceMaps} from './materials.mjs'
// Offline reconstruction study of Figure 128, North Beach Historic Context Statement.
// Dimensions are photo estimates, not survey measurements. See scene/photo-study.json.
import {THREE, material, surface, asset, box} from '../../city/mesh.mjs'
const mats = [
  material('Warm grey painted siding', '#a19a92'), material('Ivory timber trim', '#c7c3b6'),
  material('Sage bay spandrels', '#969a7e'), material('Burgundy sash', '#68433d'),
  material('Deep turquoise shop frame', '#174f61'), material('Window interior shadow', '#293536', .48),
  material('Muted reflected sky', '#97a6aa', .3), material('Burgundy canvas', '#632b36'),
  material('Charcoal canvas', '#1c2227'), material('Glazed tile base', '#233e3c', .24),
  material('Pavement', '#aaa79f'), material('Asphalt', '#535657'), material('Interior plaster', '#11120f'),
]
mats.push({...material('Shop glass', '#708486', .12, .7),alphaMode:'BLEND'})
mats[13].pbrMetallicRoughness.baseColorFactor[3]=.42
mats.push(material('Dark tile grout','#47504c'),material('Parking meter metal','#727b78',.38,.55),material('Distant grey facade','#727d8b'))
const roomMat=mats.push(material('Recessed room', '#60635b'))-1
const shopWallMat=mats.push(material('Unobserved shop interior plaster', '#858275',.95))-1
const shelfMat=mats.push(material('Shop worn timber', '#514335',.88))-1
const curtainMat=mats.push(material('Aged linen blinds', '#b3afa1',.96))-1
const clearGlass=mats.push({...material('Dielectric window glass','#ffffff',.004),extensions:{KHR_materials_transmission:{transmissionFactor:1},KHR_materials_ior:{ior:1.5}}})-1
mats[13]={...mats[clearGlass],name:'Shop dielectric glazing'}
const stockMats=['#253725','#59462b','#813f2c','#c8b782','#4e7075'].map((color,i)=>mats.push(material('Shop merchandise '+i,color,.5))-1)
const paperMat=mats.push(material('Aged paper signs','#c5c2a9'))-1
const gateMat=mats.push(material('Painted shop security grille','#28312f',.72))-1
const resources=surfaceMaps()
const roughnessTextures=resources.roughnessTextures;delete resources.roughnessTextures
resources.extensionsUsed=['KHR_materials_transmission','KHR_materials_ior']
for(const [mat,index]of [[0,0],[1,0],[2,0],[10,4],[11,2]]){mats[mat].pbrMetallicRoughness.baseColorTexture={index};mats[mat].normalTexture={index:index+1,scale:.35}}
for(const [mat,name]of [[0,'paint'],[1,'paint'],[2,'paint'],[10,'concrete'],[11,'asphalt']])mats[mat].pbrMetallicRoughness.metallicRoughnessTexture={index:roughnessTextures[name]}
const signMats={}
for(const name of ['lettering','notice','awning-ornament','small-notice','display-0','display-1','display-2','display-3']){
 const texture=resources.textures.length;resources.textures.push({source:resources.images.length,sampler:0});resources.images.push({uri:'/kite3d/assets/models/architecture/grant-storefront/textures/'+name+'.png'})
 const m=material('Inferred original sign '+name,'#ffffff',.9);m.pbrMetallicRoughness.baseColorTexture={index:texture};m.alphaMode='BLEND';signMats[name]=mats.push(m)-1
}
const parts=[]
function sign(name,x,y,z,w,h,key){const geometry=surface([[x-w/2,y,z],[x+w/2,y,z],[x+w/2,y+h,z],[x-w/2,y+h,z]],[[0,1,2],[0,2,3]]);geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));parts.push({name,geometry,mat:signMats[key],preserveUV:true})}

function block(name,x,y,z,w,h,d,mat) {const geometry=new RoundedBoxGeometry(w,h,d,1,Math.min(.009,w*.15,h*.15,d*.15)).translate(x,y+h/2,z);geometry.clearGroups();parts.push({name,geometry,mat})}
function quad(name,p,mat) {parts.push({name,geometry:surface(p,[[0,1,2],[0,2,3]]),mat})}
// Deliberately continuous frontage, not individually floating facade boxes.
block('Upper timber facade',12,4.25,-.2,24,7.31,.4,0)
block('Rear wall',12,.16,-6,24,11.4,.3,0)
for(const x of [0,24])block('Side return',x,.16,-3,.24,11.4,6,0)
block('Shop floor',12,.08,-3,24,.08,6,10)
block('Shop ceiling',12,4.2,-3,24,.15,6,shopWallMat)
block('Walkway to continuous facade',12,0,.5,32,.16,1,10)
block('Road below curb',12,-.12,8,40,.12,14,11)
for(let x=-4;x<28;x+=1.5)block('Pavement joint',x,.16,.5,.008,.002,.98,11)
block('Curb coping',12,.12,.98,32,.05,.15,1)
for(const [y,h,d] of [[4.25,.14,.24],[4.44,.12,.18],[11.05,.17,.24],[11.26,.12,.38],[11.43,.14,.5]])
  block('Continuous cornice',12,y,d/2,24,h,d,1)
// The photograph shows large shop lights topped by a separate tall transom band.
for(let k=0;k<6;k++){
  if(k===1)continue
  const ranges=[[0,4.29],[4.29,6],[6,10.5],[10.5,15],[15,19.5],[19.5,24]]
  const [start,end]=ranges[k],x=(start+end)/2,paint=k===0?4:1,half=(end-start)/2-.08,width=half*2
  // A shallow, brightly lit wall previously filled most of each pane with gray.
  // Put the opaque rear wall deeper inside the actual room; contents remain 3D.
  block('Recessed shop back wall',x,.16,-4.8,width,4.04,.1,roomMat)
  for(const side of [-1,1])block('Shop interior partition',x+side*(half-.04),.16,-2.85,.08,4.04,3.9,roomMat)
  if(k===0){
    for(const [a,b,bottom]of [[x-half,.8,.68],[.8,2.4,.45],[2.4,x+half,.68]])block('Turquoise shop opening glass',(a+b)/2,bottom,.03,b-a,4.12-bottom,.012,13)
  }else if(k===2){
    // Leave a real opening behind the separately framed entrance: a second
    // full-width sheet here previously doubled transmission through the door.
    const doorX=start+1.16,left=x-half,right=x+half
    for(const [a,b]of [[left,doorX-.49],[doorX+.49,right]])block('Shop side glass pane',(a+b)/2,.68,.03,b-a,3.44,.012,13)
    block('Shop glass over entrance',doorX,2.665,.03,.98,1.455,.012,13)
  }else block('Shop glass pane',x,.68,.03,width,3.44,.012,13)
  if(k===0){
    // Threshold elevation is a single-photo estimate: the former grille base
    // projected about 20 pixels below the photographed sill. Not survey data.
    block('Turquoise shop raised floor',x,.16,-3,width,.29,6,10)
    block('Turquoise entry lower step',1.6,.16,.34,1.6,.145,.28,10)
    block('Turquoise entry upper tread',1.6,.305,.13,1.6,.145,.26,10)
    // Original bottle/book silhouettes: inferred merchandise, not photographed textures.
    for(let row=0;row<4;row++){
      const shelfY=.78+row*.49
      for(const [a,b]of [[.16,.72],[2.52,4.12]])block('Dark timber window shelving',(a+b)/2,shelfY,-.18,b-a,.035,.25,shelfMat)
      for(let j=0;j<19;j++){
        const seed=(j*13+row*7)%23
        if(seed<4)continue
        const px=start+.19+j*(width-.38)/19,py=shelfY+.035,h=.15+seed*.004
        if(px>.73&&px<2.48)continue
        if(seed%5===0){block('Mixed display carton',px,py,-.07,.07,h*.85,.08,stockMats[seed%5]);continue}
        const bottle=new THREE.CylinderGeometry(.017,.029,h,12).translate(px,py+h/2,-.10)
        bottle.clearGroups();parts.push({name:'Bottle in shop display',geometry:bottle,mat:stockMats[seed%5]})
        block('Bottle paper label',px,py+h*.3,-.068,.034,h*.33,.005,paperMat)
        block('Bottle neck',px,py+h,-.10,.022,.04,.022,stockMats[seed%5])
      }
    }
    // Small near-glass packages form the irregular light/dark cluster visible
    // in the reference's left display. Their labels are intentionally generic.
    for(const [px,py,w,h,mat]of [[.25,.72,.15,.34,paperMat],[.48,.78,.16,.45,stockMats[2]],[.64,.7,.13,.27,paperMat],[.31,1.2,.14,.25,stockMats[4]],[.55,1.38,.17,.29,paperMat]])block('Inferred front window package',px,py,-.075,w,h,.07,mat)
    // Receding interior rack supplies real occlusion behind the grille, rather
    // than filling the doorway with another front-facing display plane.
    for(const z of [-.5,-2.0])block('Shop return rack upright',2.65,.45,z,.055,2.15,.055,shelfMat)
    for(let row=0;row<4;row++){
      const y=.7+row*.48
      block('Shop return rack shelf',2.65,y,-1.25,.38,.035,1.58,shelfMat)
      for(let j=0;j<9;j++){
        if((j+row)%5===0)continue
        const z=-.58-j*.15,h=.18+((j*3+row)%4)*.035
        const bottle=new THREE.CylinderGeometry(.022,.032,h,8).translate(2.58,y+.035+h/2,z);bottle.clearGroups();parts.push({name:'Stock behind entrance grille',geometry:bottle,mat:stockMats[(j+row)%5]})
        block('Stock label behind grille',2.545,y+.08,z,.008,.065,.045,paperMat)
      }
    }
  }else{
    block('Interior counter',x,.16,-1.5,width*(k%2?.48:.7),.85,.5,shelfMat)
    for(let j=0;j<4;j++)block('Window notice',start+.3+j*.26,1.05+(j%3)*.18,-.025,.17,.24,.004,j%2?paperMat:stockMats[j])
  }
  if(k>=3){
    const stock=(name,px,py,pz,w,h,d,mat)=>parts.push({name,geometry:box(w,h,d,[px,py+h/2,pz]),mat})
    // Photo-visible density is reconstructed with original inferred merchandise,
    // not billboard reflections. Shelves, frames and books hold up when orbiting.
    // At this grazing camera angle, deep stock disappears behind the return
    // walls. The reference's visible displays sit close to the window itself.
    const shelfX=x+(k%2?-.55:.45),shelfZ=k===4?-.7:-.5
    for(const dx of [-.78,.78])stock('Shop shelf upright',shelfX+dx,.16,shelfZ,.055,2.48,.34,shelfMat)
    for(let row=0;row<4;row++){
      const sy=.48+row*.56
      stock('Shop shelf board',shelfX,sy,shelfZ,1.62,.045,.38,shelfMat)
      for(let j=0;j<11;j++){
        const seed=(j*7+row*3+k*11)%17
        if(seed<3)continue
        stock('Inferred varied shop stock',shelfX-.69+j*.13,sy+.045,shelfZ+.05,.07+(seed%3)*.015,.18+(seed%5)*.045,.14+(seed%2)*.06,stockMats[seed%5])
      }
    }
    stock('Low window display table',x+.35,.16,-.32,1.25,.58,.52,shelfMat)
    for(let stack=0;stack<4;stack++)for(let layer=0;layer<3+(stack%2);layer++)stock('Layered paper display',x-.12+stack*.28,.74+layer*.035,-.27,.23,.03,.29,layer%2?paperMat:stockMats[(stack+k)%5])
    for(const [dx,y,pz,w,h]of [[-.55,1.0,-.55,.36,.5],[.95,1.4,-1.05,.42,.65]]){
      stock('Display frame backing',x+dx,y,pz,w,h,.035,shelfMat)
      stock('Display paper insert',x+dx,y+.025,pz+.022,w-.05,h-.05,.008,paperMat)
    }
  }
  if(k===2){
    // The photograph shows layered notices and merchandise near this entrance.
    // Original, anonymous display objects occupy several depths behind glass.
    for(const [dx,py,pz,w,h]of [[-.98,.72,-.3,.34,.54],[-.48,1.1,-.48,.26,.7],[.18,.8,-.72,.42,.45],[1.0,1.34,-.42,.31,.6],[1.38,.9,-.65,.27,.8]]){
      block('Entrance display riser',x+dx,.16,pz,w,.38,.25,shelfMat)
      block('Entrance display book stack',x+dx,py,pz,w,h,.12,paperMat)
      for(let line=0;line<4;line++)block('Display book spine',x+dx-w*.35+line*w*.23,py,pz+.066,.018,h,.01,stockMats[(line+k)%5])
    }
  }
  const bulkheads=k===0?[[x-half,.8],[2.4,x+half]]:[[x-half,x+half]]
  for(const [a,b]of bulkheads){
    block('Shop tiled bulkhead',(a+b)/2,.16,.12,b-a,.52,.18,9)
    for(let tx=a+.03;tx<b;tx+=.16)block('Tile vertical grout',tx,.18,.215,.005,.48,.005,14)
    for(const yy of [.34,.5])block('Tile horizontal grout',(a+b)/2,yy,.216,b-a,.005,.005,14)
  }
  for(const dx of [-half,half])block('Storefront pilaster',x+dx,.16,.15,.055,4.07,.14,paint)
  for(const yy of [.68,3.02,4.12]){
    for(const [a,b]of k===0&&yy===.68?bulkheads:[[x-half,x+half]])block('Shop horizontal frame',(a+b)/2,yy,.16,b-a,.065,.16,paint)
  }
  const transomCuts=[-half]
  for(let dx=-half+(k===0?.48:.68);dx<half;dx+=(k===0?.56:k===2?.73:.92)){
    transomCuts.push(dx)
    block('Narrow transom mullion',x+dx,3.12,.15,.032,1,.08,paint)
  }
  transomCuts.push(half)
  // Pale backing is visible behind the reference transoms. Its construction is
  // inferred as recessed roller blinds, not a claim about the hidden shop fitout.
  // Keep actual room depth behind the lower plate glass rather than flattening it.
  for(let pane=0;pane<transomCuts.length-1;pane++){
    const left=transomCuts[pane],right=transomCuts[pane+1]
    const bottom=3.17+((pane*7+k*3)%3)*.015
    block('Photo estimated transom blind',x+(left+right)/2,bottom,-.12,right-left-.025,4.12-bottom,.014,curtainMat)
    block('Transom blind bottom rail',x+(left+right)/2,bottom,-.105,right-left-.025,.018,.02,1)
  }
  for(const dx of (k===0?[.8-x,2.4-x]:k===2?[-half*.62,half*.42]:[-half*.42,half*.5]))block('Plate glass mullion',x+dx,k===0?.16:.78,.14,k===0?.075:.042,k===0?3.96:2.24,.15,paint)
  if(k===0){
    // Photo-visible security grille, built as real bars at the entrance rather
    // than a view-facing texture. Pattern and dimensions remain estimates.
    for(let gx=.9;gx<2.32;gx+=.13){
      block('Entrance grille vertical',gx,.45,.22,.010,1.85,.022,gateMat)
      const tip=new THREE.ConeGeometry(.018,.065,4).translate(gx,2.33,.22);tip.clearGroups();parts.push({name:'Entrance grille finial',geometry:tip,mat:gateMat})
    }
    for(const gy of [.55,1.12,2.19])block('Entrance grille rail',1.6,gy,.22,1.46,.018,.025,gateMat)
    block('Entrance grille latch',2.18,1.05,.25,.045,.18,.045,15)
  }
  // Depth behind glazing: interior lintel and shelves avoid flat opaque blue windows.
  block('Interior lintel',x,2.73,-.4,width,.12,.12,12)

  if(k===2){
    // The photographed black canopy rises almost to the transom head, unlike
    // the shallow generic wedge used in the initial reconstruction.
    const canopyX=start+1.55
    quad('Sloped fabric canopy',[[canopyX-1,4.04,.2],[canopyX+1,4.04,.2],[canopyX+1,2.85,.95],[canopyX-1,2.85,.95]],8)
    for(const side of [-1,1]){
      const sx=canopyX+side
      const geometry=surface([[sx,4.04,.2],[sx,2.85,.2],[sx,2.85,.95]],side<0?[[0,1,2]]:[[0,2,1]])
      parts.push({name:'Black canopy end panel',geometry,mat:8})
    }
    block('Canvas valance',canopyX,2.63,.95,2,.22,.025,8)
    // Door and notice-covered surround are visible; exact joinery is estimated.
    const doorX=start+1.16
    for(const dx of [-.49,.49])block('Black canopy shop door jamb',doorX+dx,.16,.18,.075,2.43,.16,1)
    block('Black canopy shop door head',doorX,2.59,.18,1.05,.075,.16,1)
    block('Black canopy shop door lower rail',doorX,.18,.17,.91,.16,.1,1)
    block('Black canopy shop door glass',doorX,.34,.12,.9,2.25,.012,13)
    block('Black canopy shop door handle',doorX+.32,1.05,.24,.022,.32,.03,15)
  }
}
// Typography is original and inferred, not a claim about the photographed business.
sign('Inferred shop window lettering',.36,1.25,.055,.48,.72,'lettering')
for(const [x,y,key]of [[.32,.81,'notice'],[3.7,.8,'small-notice'],[6.15,1.05,'notice'],[6.4,1.5,'small-notice'],[6.2,2,'notice'],[8.95,1.12,'notice']])sign('Original community notice',x,y,.055,.28,.36,key)
{const points=[],triangles=[],uv=[];for(let v=0;v<=8;v++)for(let u=0;u<=24;u++){const dx=(u/24-.5)*1.3,y=2.53+v/8*.46;points.push([5.145+dx,y,.106+Math.sqrt(Math.max(.01,.85**2-dx**2-Math.max(0,y-2.65)**2))]);uv.push(u/24,1-v/8)}for(let v=0;v<8;v++)for(let u=0;u<24;u++){const i=v*25+u;triangles.push([i,i+1,i+26],[i,i+26,i+25])}const geometry=surface(points,triangles);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));parts.push({name:'Inferred gold canvas lettering',geometry,mat:signMats['awning-ornament'],preserveUV:true})}
// Uneven original window displays inferred from the photograph's dense shop glazing.
for(const [x,y,w,h,key]of [[6.35,.9,.35,.62,0],[6.8,1.3,.45,.67,2],[7.25,.78,.29,.45,1],[6.4,1.85,.31,.48,3],[9.8,.9,.38,.64,1],[10.9,1.0,.45,.72,0],[11.5,1.8,.32,.48,2],[14.3,.82,.35,.56,3],[15.4,1.25,.44,.67,1],[19.9,1.1,.42,.64,0]])sign('Original varied display card',x,y,.065,w,h,'display-'+key)
// Photo-inspired poster density, original artwork rather than copied notices or brands.
for(const [x,y,w,h,key]of [[.52,1.9,.32,.5,2],[1.1,.88,.42,.62,3],[2.9,1.15,.28,.4,1],[3.5,1.8,.34,.53,0],[6.3,2.25,.3,.45,2],[6.7,2.0,.34,.5,1],[7.1,1.62,.31,.45,3],[6.85,.75,.3,.43,0],[9.55,1.6,.38,.55,3],[10.8,2,.4,.6,2]])sign('Original layered shop notice',x,y,.072,w,h,'display-'+key)
// Dense entrance notice cluster follows the reference distribution. Artwork and
// text remain original generic notices, not observed business or event identities.
for(const [x,y,w,h,key]of [[6.12,.82,.18,.25,1],[6.22,1.14,.22,.31,3],[6.11,1.53,.19,.27,2],[6.26,1.86,.24,.31,0],[6.15,2.22,.19,.24,1],[6.61,.61,.22,.29,2],[6.68,.97,.18,.24,3],[6.59,1.31,.24,.33,0],[6.73,1.72,.18,.26,1],[6.63,2.09,.24,.28,3],[7.55,.67,.21,.28,0],[7.62,1.05,.26,.34,1],[7.57,1.47,.2,.29,3],[7.66,1.87,.26,.32,2],[8.2,1.42,.32,.43,1],[8.62,.88,.24,.36,0],[8.55,1.84,.26,.36,3],[9.2,1.17,.29,.42,2]])sign('Original entrance notice cluster',x,y,.135,w,h,'display-'+key)
// Rounded entry awning, visible in the photo between the turquoise shop and black awning.
const bonnetPoints=[],bonnetTriangles=[]
function bonnetQuad(p){const i=bonnetPoints.length;bonnetPoints.push(...p);bonnetTriangles.push([i,i+2,i+1],[i,i+3,i+2])}
for(let row=0;row<12;row++)for(let col=0;col<24;col++){
  const point=(i,j)=>{const p=i*Math.PI/24,t=j*Math.PI/24;return [5.145+.85*Math.sin(p)*Math.cos(t),2.65+.85*Math.cos(p),.1+.85*Math.sin(p)*Math.sin(t)]}
  bonnetQuad([point(row,col),point(row+1,col),point(row+1,col+1),point(row,col+1)])
  if(row===11){const a=point(12,col),b=point(12,col+1);bonnetQuad([a,b,[b[0],b[1]-.16,b[2]],[a[0],a[1]-.16,a[2]]])}
}
// The manually inspected render exposed flat quad normals on this curved canopy.
const bonnet=surface(bonnetPoints,bonnetTriangles),bonnetNormals=[]
for(const [x,y,z] of bonnetPoints){const n=new THREE.Vector3(x-5.145,Math.max(0,y-2.65),z-.1).normalize();bonnetNormals.push(n.x,n.y,n.z)}
bonnet.setAttribute('normal',new THREE.Float32BufferAttribute(bonnetNormals,3))
parts.push({name:'Rounded bonnet awning',geometry:bonnet,mat:7})
const seamMat=mats.push(material('Canvas sewn panel seams','#69313d',.96))-1
for(let rib=1;rib<8;rib++){
 const t=rib*Math.PI/8,points=Array.from({length:25},(_,i)=>{const p=i*Math.PI/48;return new THREE.Vector3(5.145+.854*Math.sin(p)*Math.cos(t),2.65+.854*Math.cos(p),.1+.854*Math.sin(p)*Math.sin(t))})
 const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.004,6,false);geometry.clearGroups();parts.push({name:'Canvas panel seam',geometry,mat:seamMat})
}
block('Recessed entrance shadow',5.145,.16,.17,1.12,2.5,.04,5)
for(const dx of [-.64,.64])block('Entrance ivory jamb',5.145+dx,.16,.22,.13,2.5,.18,1)
// The paired ivory entrance is directly visible beneath the reference awning.
for(const dx of [-.29,.29]){
 block('Ivory entrance door',5.145+dx,.18,.225,.53,2.35,.055,1)
 block('Narrow door glazing',5.145+dx,.94,.26,.16,1.32,.012,5)
 block('Door lower inset',5.145+dx,.32,.26,.29,.46,.015,0)
 block('Door handle',5.145+dx+(dx<0?.16:-.16),1,.28,.035,.14,.035,3)
}
// Angled bay segments with full-height windows and panelled spandrels.
for(const {centerX:x,baseY} of [{"centerX": 3.3672, "baseY": 4.50845}, {"centerX": 8.5652, "baseY": 4.62597}, {"centerX": 14.75976, "baseY": 4.55133}, {"centerX": 21.86865, "baseY": 4.469}]) {
  const half=x<4?1.45:1.5,front=x<4?.94:1.0,shift=half-1.65
  const poly=[[-half+shift,.03],[-front+shift,.45],[front+shift,.45],[half+shift,.03]]
  for(let i=0;i<3;i++){
    const a=poly[i],b=poly[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1])
    const p=(t,y,d=.0)=>[x+a[0]+(b[0]-a[0])*t,y+baseY-4.5,a[1]+(b[1]-a[1])*t+d]
    const panel=(name,t0,t1,y,h,mat,d=.01)=>quad(name,[p(t0,y,d),p(t1,y,d),p(t1,y+h,d),p(t0,y+h,d)],mat)
    panel('Angled bay wall',0,1,4.5,6.55,0)
    for(const y of [4.58,7.8]){
      panel('Sage spandrel',0,1,y,.8,2)
      // Lower spandrels read as plain sage fields in the reference, not repeated
      // outlined rectangles. Retain the observed inset treatment upstairs only.
      if(y>7){
        panel('Panel inset',.12,.88,y+.15,.49,1,.025)
        panel('Sage inset field',.135,.865,y+.17,.45,2,.03)
      }
      // Photo-visible stepped timber casings; dimensions remain estimates.
      // Keep fitted window bounds while adding real bevels and recessed edges.
      const casingRings=[
        [.105,.895,y+.885,y+3.035,.025],
        [.12,.88,y+.9,y+3.02,.08],
        [.135,.865,y+.925,y+2.995,.08],
        [.143,.857,y+.94,y+2.98,.065],
        [.143,.857,y+.98,y+2.94,.065],
        [.15,.85,y+1.0,y+2.92,.04],
      ].map(([l,r,low,high,d])=>[p(l,low,d),p(r,low,d),p(r,high,d),p(l,high,d)])
      for(let ring=0;ring<casingRings.length-1;ring++)for(let edge=0;edge<4;edge++){
        const next=(edge+1)%4
        quad('Stepped timber window casing',[casingRings[ring][edge],casingRings[ring][next],casingRings[ring+1][next],casingRings[ring+1][edge]],1)
      }
      panel('Burgundy window sash',.14,.86,y+.98,1.96,3,.04)
      for(const [bottom,height]of [[y+1.03,.86],[y+1.97,.91]]){
        panel('Dark window recess',.17,.83,bottom,height,roomMat,.041)
        const blindDrop=[.12,.35,.7,0][(Math.round(x)+i+Math.round(bottom*3))%4]
        panel('Linen blind behind glass',.18,.82,bottom+height-blindDrop,blindDrop,curtainMat,.042)
        for(let h=bottom+height-blindDrop;h<bottom+height;h+=.045)panel('Blind horizontal seam',.18,.82,h,.006,1,.043)
        panel('Reflective bay glass',.17,.83,bottom,height,clearGlass,.05)
      }
      panel('Sill',.09,.91,y+.85,.055,1,.07)
      // A continuous shallow beveled molding replaces the razor-thin flat band.
      // Profile dimensions are photo estimates; the fitted bay/window heights stay fixed.
      const profile=[[-.06,.015],[-.04,.035],[0,.075],[.025,.09],[.13,.09],[.145,.075],[.18,.075],[.18,.015]]
      const points=[...profile.map(([dy,d])=>p(0,y+dy,d)),...profile.map(([dy,d])=>p(1,y+dy,d))],triangles=[]
      for(let j=0;j<profile.length;j++){const n=(j+1)%profile.length;triangles.push([j,n+profile.length,n],[j,j+profile.length,n+profile.length])}
      const cap=THREE.ShapeUtils.triangulateShape(profile.map(([dy,d])=>new THREE.Vector2(dy,d)),[])
      for(const [a,b,c]of cap){if(i===0)triangles.push([c,b,a]);if(i===2)triangles.push([a+profile.length,b+profile.length,c+profile.length])}
      const molding=surface(points,triangles).toNonIndexed()
      // Keep planar profile faces planar; averaging cap normals across an entire
      // long strip made the first inspected render look like inflated tubes.
      molding.computeVertexNormals()
      parts.push({name:'Profiled bay floor molding',geometry:molding,mat:1})
    }
    panel('Bay cornice',-.03,1.03,10.92,.15,1,.15)
  }
}
// Narrow flat windows between the projecting bays are visible in the photograph.
for(const x of [6.4,12.4,18.4])for(const y of [5.45,8.67]){
  block('Flat window surround',x,y,.08,.92,2.1,.14,1)
  block('Flat window sash',x,y+.09,.16,.72,1.92,.035,3)
  block('Flat window lower blind',x,y+.15,.18,.6,.82,.015,curtainMat)
  block('Flat window lower glass',x,y+.15,.20,.6,.82,.008,clearGlass)
  block('Flat window upper blind',x,y+1.06,.18,.6,.83,.015,curtainMat)
  block('Flat window upper glass',x,y+1.06,.20,.6,.83,.008,clearGlass)
}
// Photo-derived context: across-street facade faces the camera across the junction.
// Depth and hidden sides are inferred; no survey identity assigned to these context pieces.
block('Neighbour across-street mass',32,.16,4.5,6,8,13,1)
for(const z of [.2,3.1,6])for(const offset of [-.36,.36]){
 block('Neighbour upper window',28.98,4.9,z+offset,.025,1.75,.45,5)
 block('Neighbour lower window',28.98,2.8,z+offset,.025,1.2,.45,5)
}
block('Neighbour ground-floor shop',28.96,.16,4.5,.035,2.25,12.6,5)
for(const z of [-1,1.5,4,6.5,9])block('Neighbour shop mullion',28.91,.16,z,.07,2.25,.06,3)
block('Neighbour sign band',28.88,2.13,4.5,.1,.26,12.6,8)
block('Neighbour cornice',28.9,7.95,4.5,.25,.12,13.2,1)
// Background tower silhouette, estimated from the photo only.
block('Distant tower',52,.16,-7,8,15,7,16)
for(let z=-10.4;z<-3.5;z+=.55)block('Tower vertical ribs',47.97,4,z,.07,10.8,.08,6)
for(let y=4;y<15;y+=.9)block('Tower floor bands',47.94,y,-7,.06,.04,6.9,0)
// Parking meter location fitted to the visible pole, not an inventory record.
const pole=new THREE.CylinderGeometry(.025,.03,1.34,10).translate(4.396,.83,.626);pole.clearGroups();parts.push({name:'Parking meter post',geometry:pole,mat:15})
block('Parking meter head',4.396,1.35,.626,.15,.29,.11,15)
block('Parking meter face',4.396,1.43,.69,.105,.13,.018,5)
// Metric UVs avoid stretching a whole swatch over each differently sized wall.
for(const part of parts){if(part.preserveUV)continue;const g=part.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=[];for(let i=0;i<p.count;i++){const ground=part.mat===10||part.mat===11;uv.push((Math.abs(n.getX(i))>.8?p.getZ(i):p.getX(i))*(ground?.5:1), (ground?p.getZ(i):p.getY(i))*(ground?.5:1))}g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))}
const out=asset('assets/models/architecture/grant-storefront',parts,mats,{name:'Grant Avenue photo reconstruction study',reference:'North Beach HCS Figure 128, Dennis Hearne',dimensions:'inferred from single photo, not surveyed',cityPhotoStudy:true},resources)
console.log(JSON.stringify(out))
