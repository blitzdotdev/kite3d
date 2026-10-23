// Inventory coordinates can land inside inferred carriageways. Preserve source positions
// and record a visual correction rather than silently changing the source snapshot.
export function siteTree(position,roads,buildings){
 const segments=roads.flatMap(r=>r.points.slice(1).map((b,i)=>({r,a:r.points[i],b})))
 const project=(p,{a,b})=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<.01)return null;const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(l*l))),x=a[0]+dx*t,z=a[1]+dz*t;return{x,z,nx:-dz/l,nz:dx/l,d:Math.hypot(p[0]-x,p[1]-z)}}
 const inside=(p,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
 const hits=segments.map(s=>({s,p:project(position,s)})).filter(v=>v.p&&v.p.d<v.s.r.width/2+.2).sort((a,b)=>a.p.d-b.p.d)
 if(!hits.length)return{position}
 const candidates=[]
 for(const{s,p}of hits)for(const side of [-1,1]){
  const offset=s.r.width/2+Math.min(.65,Math.max(.35,s.r.sidewalk*.5)),q=[p.x+p.nx*offset*side,p.z+p.nz*offset*side]
  if(segments.some(v=>{const d=project(q,v);return d&&d.d<v.r.width/2+.25}))continue
  if(buildings.some(f=>f.polygons.some(poly=>inside(q,poly[0]))))continue
  candidates.push(q)
 }
 candidates.sort((a,b)=>Math.hypot(a[0]-position[0],a[1]-position[1])-Math.hypot(b[0]-position[0],b[1]-position[1]))
 return candidates.length?{position:candidates[0],sourcePosition:position,placementCorrection:'Nearest viable sidewalk outside inferred carriageways and footprints; not surveyed'}:{position,placementWarning:'Inventory point conflicts with inferred carriageway; no unobstructed sidewalk candidate'}
}
