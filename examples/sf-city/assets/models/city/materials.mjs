import {png} from './png.mjs'
import {material} from './mesh.mjs'
import {write} from '../../../scene/data.mjs'
// Original tileable colour swatches. Grain and slab seams are authored approximations.
export function bakeGroundMaterials() {
  const size=256
  for(const name of ['asphalt','concrete','lawn']) {
    const pixels=Buffer.alloc(size*size*4)
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const i=(y*size+x)*4,n=((x*374761393+y*668265263)^(x*y*1274126177))>>>0
      const grain=(n%31)-15
      const seam=name==='concrete'&&(x%128<2||y%128<2)?-24:0
      const base=name==='asphalt'?[175,177,178]:name==='concrete'?[221,219,211]:[150,169,116]
      for(let c=0;c<3;c++)pixels[i+c]=base[c]+grain+seam
      pixels[i+3]=255
    }
    write(`assets/models/city/materials/${name}.png`,png(size,pixels))
  }
}
export function groundMaterial(name,color,index) {
  const m=material(name,color);m.pbrMetallicRoughness.baseColorTexture={index};return m
}
export function groundResources(names) {
  return {images:names.map(name=>({uri:`/kite3d/assets/models/city/materials/${name}.png`})),textures:names.map((_,source)=>({source,sampler:0})),samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}]}
}
