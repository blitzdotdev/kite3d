// Original silhouette study from HCS Figure 128. Not surveyed tower geometry.
import {asset, box, material} from './mesh.mjs'
export function grantBackground(){
  const parts=[],mats=[material('Distant blue grey concrete','#98a3ae',.9),material('Tower recessed glazing','#8797a5',.55),material('Tower light edge','#a1acb5',.85)]
  const add=(name,x,y,z,w,h,d,mat)=>parts.push({name,geometry:box(w,h,d,[x,y+h/2,z]),mat})
  add('Photo estimated tower body',0,0,0,4,15.1,3,0)
  add('Stepped tower crown',0,15.1,0,3.5,.5,2.6,0)
  // The reference resolves slender vertical ribs and alternating recessed slots.
  // Only a distant silhouette/tonal approximation, not an invented exact facade.
  for(const x of [-1.8,-1.44,-1.08,-.72,-.36,0,.36,.72,1.08,1.44,1.8]){
    add('Tower recessed vertical bay',x,8,1.51,.19,7.05,.025,1)
    add('Tower vertical pier',x-.13,8,1.55,.055,7.05,.06,2)
  }
  for(const z of [-1.3,-.94,-.58,-.22,.14,.5,.86,1.22]){
    add('Tower return recessed bay',-2.01,8,z,.025,7.05,.19,1)
    add('Tower return vertical pier',-2.05,8,z-.13,.06,7.05,.055,2)
  }
  for(let y=8.4;y<15.05;y+=.72){
    add('Tower narrow floor course',0,y,1.55,4,.025,.05,0)
    add('Tower return floor course',-2.05,y,0,.05,.025,3,0)
  }
  return asset('assets/models/architecture/grant-background',parts,mats,{name:'Grant study / inferred distant tower',provenance:'HCS Figure 128 silhouette estimate; identity, scale and placement unverified; no survey or photo pixels'})
}
