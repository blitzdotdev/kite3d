"""Opt-in geometry-only BMW derivative. Original glTF materials/hierarchy retained.
blender -b --python prepare-lod-blender.py -- /tmp/NEW_CANDIDATE [ratio=.07] [weld-local=.00001]
"""
import bpy
import json
import struct
import sys
import hashlib
from pathlib import Path

source = Path(__file__).resolve().parent
args = sys.argv[sys.argv.index('--') + 1:]
output = Path(args[0]).resolve()
ratio = float(args[1]) if len(args) > 1 else .07
weld_distance = float(args[2]) if len(args) > 2 else .00001
planar_degrees = float(args[3]) if len(args) > 3 else 0
if not str(output).startswith('/tmp/') or output.exists() or not 0 < ratio < 1 or not 0 < weld_distance <= .01:
    raise ValueError('Require fresh /tmp output and ratio (0,1)')
sha = lambda b: hashlib.sha256(b).hexdigest()
source_hashes = {p: sha((source/p).read_bytes()) for p in ['f.gltf', 'geometry.bin', 'LICENSE.txt', 'provenance.json']}
doc = json.loads((source/'f.gltf').read_text())
original_nodes, original_materials = json.dumps(doc['nodes']), json.dumps(doc['materials'])
accessors, views = doc['accessors'], doc['bufferViews']
binary = (source/'geometry.bin').read_bytes()
components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
formats = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}
def read(index):
    a = accessors[index]; v = views[a['bufferView']]
    if v.get('byteStride') or a.get('sparse'):
        raise ValueError('Unsupported storage')
    return list(struct.unpack_from('<' + formats[a['componentType']] * a['count'] * components[a['type']], binary, v.get('byteOffset', 0) + a.get('byteOffset', 0)))
if doc.get('images') or doc.get('skins') or doc.get('animations'):
    raise ValueError('Unsupported dynamic/textured source')
doc['accessors'], doc['bufferViews'] = [], []
chunks, offset, reports = [], 0, []
def write(values, kind, component=5126):
    global offset
    padding = (-offset) % 4
    chunks.append(bytes(padding)); offset += padding
    data = struct.pack('<' + formats[component] * len(values), *values)
    vi = len(doc['bufferViews']); doc['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)})
    chunks.append(data); offset += len(data)
    a = {'bufferView': vi, 'componentType': component, 'count': len(values)//components[kind], 'type': kind}
    if kind == 'VEC3':
        a['min'] = [min(values[i::3]) for i in range(3)]; a['max'] = [max(values[i::3]) for i in range(3)]
    doc['accessors'].append(a)
    return len(doc['accessors']) - 1
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for mi, mesh in enumerate(doc['meshes']):
    for pi, primitive in enumerate(mesh['primitives']):
        if set(primitive['attributes']) != {'POSITION', 'NORMAL'} or primitive.get('mode', 4) != 4:
            raise ValueError('Unexpected attributes or topology; do not discard owner attributes')
        pos, normals, indices = read(primitive['attributes']['POSITION']), read(primitive['attributes']['NORMAL']), read(primitive['indices'])
        geometry = bpy.data.meshes.new(mesh['name'])
        geometry.from_pydata(list(zip(pos[::3], pos[1::3], pos[2::3])), [], list(zip(indices[::3], indices[1::3], indices[2::3])))
        for p in geometry.polygons: p.use_smooth = True
        geometry.normals_split_custom_set_from_vertices(list(zip(normals[::3], normals[1::3], normals[2::3])))
        obj = bpy.data.objects.new(mesh['name'], geometry); bpy.context.collection.objects.link(obj)
        weld = obj.modifiers.new('Reconnect coincident vertices within source part', 'WELD'); weld.merge_threshold = weld_distance
        if planar_degrees:
            planar = obj.modifiers.new('Dissolve near-coplanar topology', 'DECIMATE'); planar.decimate_type = 'DISSOLVE'; planar.angle_limit = planar_degrees * 3.141592653589793 / 180; planar.delimit = {'NORMAL'}
        if len(indices) > 36:
            decimate = obj.modifiers.new('Parked context simplification', 'DECIMATE'); decimate.ratio = max(ratio, 36 / len(indices)); decimate.use_collapse_triangulate = True
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()); result = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get()); result.calc_loop_triangles()
        positions_out, normals_out, indices_out, unique = [], [], [], {}
        for tri in result.loop_triangles:
            points = [result.vertices[v].co for v in tri.vertices]
            face_normal = (points[1] - points[0]).cross(points[2] - points[0])
            if face_normal.length_squared < 1e-16:
                continue
            face_normal.normalize()
            for loop in tri.loops:
                vertex = result.vertices[result.loops[loop].vertex_index]
                normal = result.corner_normals[loop].vector.copy()
                if normal.length_squared < .25:
                    normal = face_normal.copy()
                normal.normalize()
                key = tuple(vertex.co) + tuple(normal)
                if key not in unique:
                    unique[key] = len(unique); positions_out.extend(vertex.co); normals_out.extend(normal)
                indices_out.append(unique[key])
        if not indices_out:
            # Preserve tiny or degenerate named source parts instead of deleting
            # their identity or silently changing material/assembly coverage.
            positions_out, normals_out, indices_out = pos, normals, indices
        primitive['attributes'] = {'POSITION': write(positions_out, 'VEC3'), 'NORMAL': write(normals_out, 'VEC3')}
        primitive['indices'] = write(indices_out, 'SCALAR', 5125)
        reports.append({'mesh': mi, 'primitive': pi, 'name': mesh['name'], 'nearTriangles': len(indices)//3, 'triangles': len(indices_out)//3})
        evaluated.to_mesh_clear(); bpy.data.objects.remove(obj, do_unlink=True); bpy.data.meshes.remove(geometry)
assert json.dumps(doc['nodes']) == original_nodes and json.dumps(doc['materials']) == original_materials
for path, expected in source_hashes.items():
    assert sha((source/path).read_bytes()) == expected
doc['buffers'] = [{'uri': 'geometry.bin', 'byteLength': offset}]
doc['asset']['generator'] += '; opt-in Blender geometry-only weld/decimate derivative'
data = b''.join(chunks); gltf = (json.dumps(doc) + '\n').encode()
multiplicity = {}
for n in doc['nodes']:
    if 'mesh' in n: multiplicity[n['mesh']] = multiplicity.get(n['mesh'], 0) + 1
report = {'version': 1, 'status': 'isolated-opt-in-unvalidated', 'creator': 'BMW Car IT', 'license': 'CC-BY-4.0',
          'source': 'https://github.com/bmwcarit/digital-car-3d', 'sourceHashes': source_hashes,
          'derivativeHashes': {'f.gltf': sha(gltf), 'geometry.bin': sha(data)}, 'ratio': ratio, 'weldLocalDistance': weld_distance, 'planarDegrees': planar_degrees,
          'materialsAndHierarchyExact': True, 'normalHandling': 'Original custom corner normals passed through weld/decimate; evaluated corner normals exported. Normals are not byte-identical after geometry reduction.',
          'uvNote': 'Adapted near asset contains no UVs or image textures; rejects unexpected attributes.',
          'nearInstancedTriangles': sum(p['nearTriangles'] * multiplicity.get(p['mesh'], 0) for p in reports),
          'instancedTriangles': sum(p['triangles'] * multiplicity.get(p['mesh'], 0) for p in reports),
          'nearBufferBytes': len(binary), 'bufferBytes': len(data), 'parts': reports}
output.mkdir()
(output/'f.gltf').write_bytes(gltf); (output/'geometry.bin').write_bytes(data)
(output/'lod-manifest.json').write_text(json.dumps(report, indent=2)+'\n')
(output/'LICENSE.txt').write_bytes((source/'LICENSE.txt').read_bytes())
(output/'source-provenance.json').write_bytes((source/'provenance.json').read_bytes())
(output/'README.txt').write_text('BMW Car IT G05 / BMW X5 2018, CC BY 4.0. https://github.com/bmwcarit/digital-car-3d\nDerivative: Blender weld/decimate, original hierarchy/materials retained; corner normals carried through modifiers. Original near unchanged. No endorsement. Verify source hashes and inspect appearance before opt-in substitution.\n')
print(json.dumps({k:v for k,v in report.items() if k != 'parts'}, indent=2))
