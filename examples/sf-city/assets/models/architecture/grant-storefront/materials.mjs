// Original procedural surface maps; no third-party or reference-photo pixels.
import {png} from '../../city/png.mjs'
import {write} from '../../../../scene/data.mjs'
export function surfaceMaps(){
 const size=512,names=['paint','asphalt','concrete'],images=[],textures=[],roughMaps=[]
 for(const [index,name]of names.entries()){
  const pixels=Buffer.alloc(size*size*4),normals=Buffer.alloc(size*size*4),rough=Buffer.alloc(size*size*4),heights=new Float32Array(size*size)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const h=(((x*374761393+y*668265263)^(x*y*1274126177))>>>0)/4294967295
   const mottling=Math.sin(x*.041)*Math.sin(y*.027)+Math.sin(x*.013+y*.023)
   heights[y*size+x]=name==='asphalt'?h*.7:name==='paint'?h*.07:h*.2
   const value=name==='asphalt'?165+h*55+mottling*5:name==='paint'?237+h*10+mottling*2:218+h*16+mottling*4
   const i=(y*size+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255
   // The same broad coat/aggregate signal changes both color and roughness.
   // Restrained variation, not unrelated noise or a copied regional weathering style.
   rough[i]=255;rough[i+1]=name==='paint'?224+mottling*5+h*5:238+mottling*3+h*6;rough[i+2]=0;rough[i+3]=255
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const h=heights[y*size+x],dx=heights[y*size+(x+1)%size]-h,dy=heights[((y+1)%size)*size+x]-h,inv=1/Math.hypot(dx,dy,1),i=(y*size+x)*4
   normals[i]=127.5-dx*inv*127.5;normals[i+1]=127.5-dy*inv*127.5;normals[i+2]=127.5+inv*127.5;normals[i+3]=255
  }
  for(const [suffix,bytes]of [['color',pixels],['normal',normals]]){
   const path=`assets/models/architecture/grant-storefront/textures/${name}-${suffix}.png`;write(path,png(size,bytes));textures.push({source:images.length,sampler:0});images.push({uri:'/kite3d/'+path})
  }
  roughMaps.push([name,rough])
 }
 const roughnessTextures={}
 for(const [name,bytes]of roughMaps){
  const path=`assets/models/architecture/grant-storefront/textures/${name}-roughness.png`;write(path,png(size,bytes));roughnessTextures[name]=textures.length;textures.push({source:images.length,sampler:0});images.push({uri:'/kite3d/'+path})
 }
 return {images,textures,samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],roughnessTextures}
}
