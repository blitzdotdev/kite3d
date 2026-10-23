"""Offline adaptation of BMW's CC-BY-4.0 G05 model; source path is explicit.
Reconstruct closed-car hierarchy from Ramses Composer, preserve selectable parts,
and translate custom source shading into portable glTF PBR materials.
"""
import base64, copy, hashlib, json, pathlib, sys, tarfile, tempfile
from scipy.spatial.transform import Rotation
out = pathlib.Path(__file__).parent
cache = tempfile.TemporaryDirectory(prefix='kite-bmw-source-')
source = pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(cache.name)
if len(sys.argv)==1:
 with tarfile.open(out/'source.tar.xz') as archive: archive.extractall(source, filter='data')
objects = json.loads((source/'G05_main.rca').read_text())['instances']
by_id = {o['properties']['objectID']: o for o in objects}
gltf = dict(asset={'version':'2.0','generator':'Kite3D BMW G05 offline adaptation','copyright':'BMW Car IT; CC BY 4.0'},scene=0,scenes=[{'nodes':[0]}],nodes=[],meshes=[],materials=[],accessors=[],bufferViews=[],buffers=[])
data = bytearray()
mesh_maps = {}
material_ids = {}
def material(name):
 if name in material_ids:return material_ids[name]
 lower=name.lower();pbr={'baseColorFactor':[.035,.035,.035,1],'metallicFactor':0,'roughnessFactor':.5};m={'name':name,'pbrMetallicRoughness':pbr}
 if 'paint' in lower and 'rim' not in lower:
  pbr.update(baseColorFactor=[.024,.052,.09,1],metallicFactor=.65,roughnessFactor=.22);m['extensions']={'KHR_materials_clearcoat':{'clearcoatFactor':1,'clearcoatRoughnessFactor':.12}}
 elif any(k in lower for k in ['chrome','aluminum','rim','brake']):pbr.update(baseColorFactor=[.42,.44,.46,1],metallicFactor=1,roughnessFactor=.22 if 'chrome' in lower else .4)
 elif 'glass' in lower or 'lens' in lower:
  pbr.update(baseColorFactor=[.15,.19,.21,.25],metallicFactor=0,roughnessFactor=.07);m.update(alphaMode='BLEND',doubleSided=True);m['extensions']={'KHR_materials_ior':{'ior':1.5},'KHR_materials_specular':{'specularFactor':1}}
  if 'red' in lower:pbr['baseColorFactor']=[.3,.008,.008,.8]
  if 'glass_1sided' in lower or 'glass_2sided' in lower:
   pbr.update(baseColorFactor=[.88,.92,.91,1],roughnessFactor=.005);m.pop('alphaMode',None);m['extensions']['KHR_materials_transmission']={'transmissionFactor':.92}
 elif 'tire' in lower:pbr.update(baseColorFactor=[.012,.013,.014,1],roughnessFactor=.88)
 elif 'light' in lower:pbr.update(baseColorFactor=[.6,.64,.65,1],metallicFactor=.35,roughnessFactor=.2)
 elif 'licenseplate' in lower:pbr.update(baseColorFactor=[.7,.72,.7,1],roughnessFactor=.5)
 elif 'general' in lower:pbr.update(baseColorFactor=[.025,.025,.022,1],roughnessFactor=.85)
 material_ids[name]=len(gltf['materials']);gltf['materials'].append(m);return material_ids[name]
for path in sorted(source.glob('*.gltf')):
 g=json.loads(path.read_text());offset=len(data);raw=base64.b64decode(g['buffers'][0]['uri'].split(',')[1]);data.extend(raw);data.extend(b'\0'*((-len(data))%4))
 bv_start=len(gltf['bufferViews']);acc_start=len(gltf['accessors']);mm=[]
 for bv in g['bufferViews']:
  bv=copy.deepcopy(bv);bv['buffer']=0;bv['byteOffset']=bv.get('byteOffset',0)+offset;gltf['bufferViews'].append(bv)
 for a in g['accessors']:
  a=copy.deepcopy(a);a['bufferView']+=bv_start;gltf['accessors'].append(a)
 for mesh in g['meshes']:
  mesh=copy.deepcopy(mesh)
  for p in mesh['primitives']:
   p['attributes']={k:v+acc_start for k,v in p['attributes'].items()};p['indices']+=acc_start;p['material']=material(g['materials'][p['material']]['name'] if 'material' in p else 'M_none')
  mm.append(len(gltf['meshes']));gltf['meshes'].append(mesh)
 mesh_maps[path.name]=mm

def node(identifier):
 obj=by_id[identifier];p=obj['properties'];name=p['objectName']
 if obj['typeName'] not in ['Node','MeshNode']:return None
 if p.get('visibility') is False:return None
 n={'name':name,'extras':{'sourceObjectID':identifier}}
 for src,dst,default in [('translation','translation',0),('scaling','scale',1)]:n[dst]=[p.get(src,{}).get(a,{}).get('value',default) for a in 'xyz']
 angles=[p.get('rotation',{}).get(a,{}).get('value',0)for a in 'xyz'];n['rotation']=Rotation.from_euler('xyz',angles,degrees=True).as_quat().tolist()
 if obj['typeName']=='MeshNode':
  md=by_id[p['mesh']]['properties'];path=pathlib.Path(md['uri']).name
  if path not in mesh_maps:return None
  n['mesh']=mesh_maps[path][md['meshIndex']]
 index=len(gltf['nodes']);gltf['nodes'].append(n)
 children=[node(c['value'])for c in p.get('children',{}).get('properties',[])];children=[c for c in children if c is not None]
 if children:n['children']=children
 return index
root=next(o['properties']['objectID']for o in objects if o['properties']['objectName']=='G05_full')
gltf['nodes'].append({'name':'BMW X5 2018, closed, metres','scale':[.01,.01,.01],'translation':[-1.5177,0,0],'children':[1]});node(root)
gltf['buffers']=[{'uri':'geometry.bin','byteLength':len(data)}];gltf['extensionsUsed']=['KHR_materials_clearcoat','KHR_materials_ior','KHR_materials_specular','KHR_materials_transmission']
(out/'geometry.bin').write_bytes(data);(out/'f.gltf').write_text(json.dumps(gltf,separators=(',',':'))+'\n')
(out/'LICENSE.txt').write_bytes((source/'LICENSE.txt').read_bytes())
(out/'provenance.json').write_text(json.dumps({'creator':'BMW Car IT','source':'https://github.com/bmwcarit/digital-car-3d','commit':'6261f53b5ac63c6686039d106fbbbfb693339d72','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','modifications':'Closed-car hierarchy assembled; centimetres converted to metres; portable PBR materials authored. Different model from the Honda-like vehicle in the reference photo.','sourceHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in source.glob('*')if p.is_file()}},indent=2)+'\n')
print(json.dumps({'nodes':len(gltf['nodes']),'meshes':len(gltf['meshes']),'bytes':len(data)}))
