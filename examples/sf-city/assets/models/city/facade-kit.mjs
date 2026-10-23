// Authored North Beach-inspired modules, fitted heuristically to mapped footprints.
// These are reusable architectural shapes, not reconstructions of observed facades.
import {surface} from './mesh.mjs'
export function facadeKit(feature, roads, ground, base, skipEdge = -1) {
  const [cx, cz] = feature.center, height = feature.height
  const buckets = new Map()
  function quad(mat, corners) {
    if (!buckets.has(mat)) buckets.set(mat, {points: [], triangles: []})
    const b = buckets.get(mat), i = b.points.length
    b.points.push(...corners);b.triangles.push([i,i+1,i+2],[i,i+2,i+3])
  }
  for (const polygon of feature.polygons) {
    const ring = polygon[0]
    const signed = ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1]},0)
    for (let i=0;i<ring.length;i++) {
      if(polygon===feature.polygons[0] && i===skipEdge)continue
      const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1])
      if(length<2.4)continue
      const ux=(b[0]-a[0])/length,uz=(b[1]-a[1])/length,nx=uz*Math.sign(signed),nz=-ux*Math.sign(signed)
      const mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2
      let street=false,commercial=false
      for(const road of roads) for(let j=1;j<road.points.length;j++) {
        const p=road.points[j-1],q=road.points[j],dx=q[0]-p[0],dz=q[1]-p[1],ll=dx*dx+dz*dz
        if(ll<0.01)continue
        const t=Math.max(0,Math.min(1,((mx-p[0])*dx+(mz-p[1])*dz)/ll))
        const vx=p[0]+t*dx-mx,vz=p[1]+t*dz-mz,d=Math.hypot(vx,vz)
        if(d<road.width/2+road.sidewalk+12 && (vx*nx+vz*nz)/Math.max(d,0.01)>0.45) {
          street=true
          if(/COLUMBUS|STOCKTON|UNION|GREEN/.test(road.name))commercial=true
        }
      }
      const point=(s,y,d)=>[a[0]+ux*s+nx*d-cx,y,a[1]+uz*s+nz*d-cz]
      function panel(s,y,w,h,d,mat){quad(mat,[point(s-w/2,y,d),point(s+w/2,y,d),point(s+w/2,y+h,d),point(s-w/2,y+h,d)])}
      function block(s,y,w,h,d0,d1,mat){
        panel(s,y,w,h,d1,mat)
        quad(mat,[point(s-w/2,y,d0),point(s-w/2,y,d1),point(s-w/2,y+h,d1),point(s-w/2,y+h,d0)])
        quad(mat,[point(s+w/2,y,d1),point(s+w/2,y,d0),point(s+w/2,y+h,d0),point(s+w/2,y+h,d1)])
        quad(mat,[point(s-w/2,y+h,d0),point(s-w/2,y+h,d1),point(s+w/2,y+h,d1),point(s+w/2,y+h,d0)])
      }
      function window(s,y,w,h,d=0.035){
        panel(s,y,w,h,d,2)
        if (!street) return
        const variant=(Math.floor(s*13)+Math.floor(y*7)+feature.sourceId.length)%5
        if(variant<3)panel(s,y+h*(.72-variant*.15),w*.9,h*(.23+variant*.15),d+.012,6)
        panel(s,y+h*0.58,w*0.92,h*0.38,d+0.008,5)
        for(const x of [s-w/2-0.055,s+w/2+0.055])block(x,y-0.08,0.11,h+0.16,d,d+0.12,3)
        for(const yy of [y-0.08,y+h])block(s,yy,w+0.22,0.1,d,d+0.16,3)
        block(s,y+h*0.5,w,0.065,d,d+0.07,3)
        block(s,y,0.055,h,d,d+0.075,3)
        block(s,y-0.15,w+0.34,0.1,d,d+0.25,3)
      }
      // Roof parapet and a two-step projecting cornice define the street silhouette.
      block(length/2,height-0.15,length,0.5,0,0.12,0)
      if(street&&feature.family!=='stucco'){
        block(length/2,height-0.32,length+0.12,0.14,0,0.32,3)
        block(length/2,height-0.08,length+0.3,0.18,0,0.52,3)
        for(let s=0.5;s<length-0.4;s+=0.8)block(s,height-0.64,0.16,0.3,0,0.3,3)
      }
      const floors=Math.max(1,Math.round(height/3.25)),floorH=height/floors
      const bays=Math.max(1,Math.floor(length/(street?3.1:3.4)))
      for(let k=0;k<bays;k++) {
        const s=length*(k+0.5)/bays,w=Math.min(1.45,length/bays*0.5)
        const groundY=ground(a[0]+ux*s,a[1]+uz*s)-base
        for(let f=0;f<floors;f++) {
          const y=f*floorH+0.75,h=Math.min(1.9,floorH-1.05)
          if(y<groundY+0.25||h<0.4)continue
          if(f===0&&street&&commercial){
            const storeW=Math.min(length/bays-0.38,2.6),storeY=Math.max(groundY+0.2,0.15),storeH=Math.max(0.8,floorH-storeY-0.6)
            window(s,storeY,storeW,storeH)
            block(s,storeY+storeH+0.12,storeW+0.22,0.38,0.02,0.18,4)
            // Canvas awning; authored profile, inferred placement.
            quad(4,[point(s-storeW/2,storeY+storeH,0.16),point(s+storeW/2,storeY+storeH,0.16),point(s+storeW/2,storeY+storeH-0.35,1.05),point(s-storeW/2,storeY+storeH-0.35,1.05)])
            panel(s,storeY+storeH-0.55,storeW,0.2,1.05,4)
          }else if(f>0&&street&&height<26&&bays>=2&&k%2===0&&feature.style!=='plain'&&feature.family==='timber'){
            // Projecting three-sided bay with opaque spandrel and framed front glazing.
            const bw=Math.min(2.25,length/bays*0.78),deep=0.72,sy=f*floorH+0.08
            const frontW=bw*.7
            panel(s,sy,frontW,floorH-.12,deep,0)
            for(const side of [-1,1]){
              const back=s+side*bw/2,front=s+side*frontW/2
              quad(0,[point(back,sy,0),point(front,sy,deep),point(front,sy+floorH-.12,deep),point(back,sy+floorH-.12,0)])
              const q=(t,yy)=>point(back+(front-back)*t,yy,deep*t+.012)
              quad(2,[q(.15,y),q(.85,y),q(.85,y+h),q(.15,y+h)])
            }
            quad(1,[point(s-bw/2,sy+floorH-.12,0),point(s-frontW/2,sy+floorH-.12,deep),point(s+frontW/2,sy+floorH-.12,deep),point(s+bw/2,sy+floorH-.12,0)])
            window(s,y,frontW-0.22,h,deep+0.025)
            block(s,sy+floorH-0.15,bw+0.18,0.12,deep,deep+0.14,3)
          }else window(s,y,w,h)
        }
      }
      if(street){
        // An entrance module sits on local ground, rather than floating at the footprint centre height.
        const s=Math.min(length-0.8,0.85),y=ground(a[0]+ux*s,a[1]+uz*s)-base+0.12
        if(y+2.5<height){block(s,y,1.1,2.35,0.025,0.11,4);panel(s,y+0.75,0.65,1.25,0.12,2);block(s,y-0.12,1.35,0.12,0,0.65,3)}
        block(length/2,Math.max(0.2,height/floors-0.12),length,0.12,0,0.18,3)
      }
    }
  }
  return [...buckets].map(([mat,b])=>({name:['Facade bay volumes','Roof','Inset glazing','Cornices and window frames','Storefronts and doors','Sky reflection panels','Interior blind variation'][mat],geometry:surface(b.points,b.triangles),mat}))
}
