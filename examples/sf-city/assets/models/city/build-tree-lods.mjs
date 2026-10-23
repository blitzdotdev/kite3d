// Opt-in offline candidates. This does not change scene registrations/placements.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,dirname,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {asset} from './mesh.mjs'
import {broadleafGeometry} from './tree-geometry.mjs'
import {write,root} from '../../../scene/data.mjs'
const entries=[]
for(let variant=0;variant<3;variant++){
  const suffix=variant?'-'+variant:'',source=new URL(`./trees/broadleaf${suffix}/f.gltf`,import.meta.url)
  const sourceBytes=readFileSync(source),doc=JSON.parse(sourceBytes)
  const paths=[fileURLToPath(source),...[...(doc.buffers||[]),...(doc.images||[])].map(({uri})=>{
    if(typeof uri!=='string'||/^(?:data:|https?:|blob:)/.test(uri))throw new Error('LOD source must use local immutable resources')
    return uri.startsWith('/kite3d/')?resolve(root,uri.slice('/kite3d/'.length)):resolve(dirname(fileURLToPath(source)),uri)
  })]
  const nearDependencies=Object.fromEntries([...new Set(paths)].map(path=>{
    const key=relative(root,path)
    if(key.startsWith('..'))throw new Error('LOD source escaped project')
    return[key,createHash('sha256').update(readFileSync(path)).digest('hex')]
  }))
  for(const detail of ['mid','far']){
    const geometry=broadleafGeometry(variant,detail)
    const built=asset(`assets/models/city/trees/lod-${detail}/broadleaf${suffix}`,[
      {name:'Connected simplified trunk and branches',geometry:geometry.wood,mat:1},
      {name:'Preserved terminal foliage sprays',geometry:geometry.leaves,mat:0},
    ],doc.materials,{name:`Broadleaf ${variant} ${detail} candidate`,detail},
    {images:doc.images,textures:doc.textures,samplers:doc.samplers})
    entries.push({variant,detail,...built,nearAsset:`assets/models/city/trees/broadleaf${suffix}/f.gltf`,
      nearSourceSHA256:createHash('sha256').update(sourceBytes).digest('hex'),nearDependencies})
  }
}
write('assets/models/city/trees/lod-manifest.json',{version:1,status:'offline-candidate',runtimeEnabled:false,
  method:'Simplified internal wood; exact near foliage positions, normals, colors, UVs and indices retained.',
  limitations:'No distance switching or browser silhouette validation yet. Stored triangles do not measure alpha overdraw or GPU frame time.',entries})
console.log(JSON.stringify(entries.map(({variant,detail,triangles,bytes})=>({variant,detail,triangles,bytes})),null,2))
