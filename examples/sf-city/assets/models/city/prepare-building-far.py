#!/usr/bin/env python3
"""Opt-in static building detail extraction. Writes a NEW /tmp candidate only.

Usage: python3 prepare-building-far.py --source SNAPSHOT --output /tmp/NEW_DIR --mode trim-only
No registry, scene, near asset, or runtime integration is changed. A consumer must
verify every sourceContext and nearDependencies hash before substituting an asset.
Trim-only retains every mesh except the combined cornice/window-frame category.
Footprint mode preserves body silhouette only and was visually rejected as a
universal far substitute. Neither mode establishes an acceptable switch distance.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def prepare(source, output, mode='footprint'):
    source, output = source.resolve(), output.resolve()
    if not output.is_relative_to(Path('/tmp')) or output == Path('/tmp'):
        raise ValueError('Output must be a new subdirectory of /tmp')
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Output must be new and separate from source')
    def read(path):
        target = (source / path).resolve()
        if not target.is_relative_to(source):
            raise ValueError(f'Unsafe source path: {path}')
        return target.read_bytes()
    manifest_path = 'scene/coverage/runtime-candidate.json'
    manifest_bytes = read(manifest_path)
    manifest = json.loads(manifest_bytes)
    context = {manifest_path: digest(manifest_bytes)}
    for path, expected in manifest['sourceHashes'].items():
        actual = digest(read(path))
        if actual != expected:
            raise ValueError(f'Source context changed: {path}')
        context[path] = actual
    generated = {p['id']: p for p in json.loads(read('scene/generated.json'))['placements']}
    overrides = json.loads(read('scene/overrides.json')).get('features', {})
    scene = json.loads(read('assets/main.scene.gltf'))
    entries, excluded, pending = [], [], {}
    near_unique, far_unique = {}, {}
    for feature in manifest['features']:
        if not feature['id'].startswith('sf-building:'):
            continue
        fid = feature['id']
        placement = generated.get(fid, {})
        reason = None
        if fid in overrides:
            reason = 'Explicit authored building override'
        elif not placement.get('baked') or not feature.get('visible'):
            reason = 'Not visible generated baked content'
        elif placement.get('landmarkSource') or placement.get('visualSpireHeightM'):
            reason = 'Landmark silhouette requires dedicated preservation'
        node = scene['nodes'][feature['nodeIndex']]
        if node.get('extras', {}).get('cityId') != fid or node.get('children'):
            reason = 'Authored placement identity or children require inspection'
        baseline = node.get('extras', {}).get('cityGenerated', {})
        defaults = {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1]}
        if (node.get('matrix') or node.get('extensions') or node.get('extras', {}).get('EntityComponentPlugin')
                or node.get('extras', {}).get('rootPathOptions')
                or any(node.get(k, default) != baseline.get(k, default) for k, default in defaults.items())
                or node.get('extras', {}).get('rootPath') != baseline.get('rootPath')):
            reason = 'Authored placement override or executable metadata'
        asset = manifest['assets'][feature['asset']]
        if placement.get('asset') != asset['path']:
            reason = 'Generated placement asset differs'
        if reason:
            excluded.append({'id': fid, 'reason': reason})
            continue
        dependencies = {}
        for path in asset['dependencies']:
            data = read(path)
            expected = manifest['dependencies'][path]['sha256']
            if digest(data) != expected:
                raise ValueError(f'Near dependency changed: {path}')
            dependencies[path] = expected
        doc = json.loads(read(asset['path']))
        # Extraction deliberately fails closed outside the offline writer schema.
        def unsafe(value):
            if isinstance(value, dict):
                if (value.get('EntityComponentPlugin') or value.get('rootPath') or value.get('extensions')
                        or 'skin' in value or 'weights' in value or 'targets' in value):
                    return True
                return any(unsafe(v) for v in value.values())
            return isinstance(value, list) and any(unsafe(v) for v in value)
        if unsafe(doc):
            raise ValueError(f'Unsupported source metadata: {fid}')
        if doc.get('extensionsUsed') or doc.get('animations') or doc.get('skins'):
            raise ValueError(f'Unsupported dynamic/extended source: {fid}')
        root = doc['nodes'][0]
        if doc['scenes'] != [{'nodes': [0]}] or root.get('mesh') is not None:
            raise ValueError(f'Unsupported source hierarchy: {fid}')
        if any(n.get('children') or n.get('extensions') or n.get('skin') is not None
               for n in doc['nodes'][1:]):
            raise ValueError(f'Nested or dynamic source nodes: {fid}')
        selected = [i for i in root['children']
                    if (doc['nodes'][i].get('name') != 'Cornices and window frames' if mode == 'trim-only'
                        else re.fullmatch(r'Footprint \d+( / surface \d+)?', doc['nodes'][i].get('name', '')))]
        if not selected:
            excluded.append({'id': fid, 'reason': 'No generated Footprint meshes'})
            continue
        far_path = 'assets/models/city/buildings-far/' + fid.replace(':', '-') + '/f.gltf'
        out = copy.deepcopy(doc)
        out['nodes'] = [copy.deepcopy(root)]
        out['nodes'][0]['children'] = list(range(1, len(selected) + 1))
        out['nodes'][0]['extras']['cityBakedAsset'] = far_path
        out['meshes'], out['accessors'], out['bufferViews'] = [], [], []
        out['materials'], out['textures'], out['images'], out['samplers'] = [], [], [], []
        maps = {key: {} for key in ['accessors', 'bufferViews', 'materials', 'textures', 'images', 'samplers']}
        chunks, size, verified_views = [], 0, []
        def remap(kind, old):
            nonlocal size
            if old in maps[kind]:
                return maps[kind][old]
            new = len(out[kind])
            maps[kind][old] = new
            value = copy.deepcopy(doc[kind][old])
            out[kind].append(value)
            if kind == 'bufferViews':
                uri = doc['buffers'][value['buffer']]['uri']
                path = str(Path(asset['path']).parent / uri)
                if path not in dependencies:
                    raise ValueError(f'Unattested buffer: {path}')
                buffer = read(path)
                start, length = value.get('byteOffset', 0), value['byteLength']
                data = buffer[start:start + length]
                if len(data) != length:
                    raise ValueError('Buffer view outside source buffer')
                padding = (-size) % 4
                chunks.append(bytes(padding)); size += padding
                value['buffer'], value['byteOffset'] = 0, size
                chunks.append(data); size += length
                verified_views.append((new, data))
            elif kind == 'accessors':
                if 'sparse' in value or 'bufferView' not in value:
                    raise ValueError('Unsupported sparse/accessor storage')
                value['bufferView'] = remap('bufferViews', value['bufferView'])
            elif kind == 'materials':
                def walk(v):
                    if isinstance(v, dict):
                        for k, child in v.items():
                            if k.endswith('Texture') and isinstance(child, dict) and 'index' in child:
                                child['index'] = remap('textures', child['index'])
                            else:
                                walk(child)
                    elif isinstance(v, list):
                        for child in v:
                            walk(child)
                walk(value)
            elif kind == 'textures':
                value['source'] = remap('images', value['source'])
                if 'sampler' in value:
                    value['sampler'] = remap('samplers', value['sampler'])
            elif kind == 'images':
                uri = value.get('uri', '')
                path = uri[len('/kite3d/'):] if uri.startswith('/kite3d/') else str(Path(asset['path']).parent / uri)
                if path not in dependencies:
                    raise ValueError(f'Unattested image: {path}')
                value['uri'] = '/kite3d/' + path
                pending[path] = read(path)
            return new
        triangles = 0
        for old_node in selected:
            n = copy.deepcopy(doc['nodes'][old_node])
            mesh = copy.deepcopy(doc['meshes'][n['mesh']])
            n['mesh'] = len(out['meshes']); out['meshes'].append(mesh); out['nodes'].append(n)
            for primitive in mesh['primitives']:
                if primitive.get('mode', 4) != 4 or primitive.get('targets') or primitive.get('extensions'):
                    raise ValueError('Unsupported footprint primitive')
                count = doc['accessors'][primitive['indices']]['count']
                if count % 3:
                    raise ValueError('Non-triangular footprint index count')
                triangles += count // 3
                primitive['indices'] = remap('accessors', primitive['indices'])
                primitive['attributes'] = {k: remap('accessors', v) for k, v in primitive['attributes'].items()}
                primitive['material'] = remap('materials', primitive['material'])
        buffer = b''.join(chunks)
        out['buffers'] = [{'uri': 'geometry.bin', 'byteLength': len(buffer)}]
        for index, original in verified_views:
            view = out['bufferViews'][index]
            assert buffer[view['byteOffset']:view['byteOffset'] + view['byteLength']] == original
        # Node transforms and accessor metadata remain exact, including positions,
        # normals, UVs and indices. Only storage references and resource indices move.
        for kind, mapping in maps.items():
            for old, new in mapping.items():
                if kind == 'accessors':
                    a, b = copy.deepcopy(doc[kind][old]), copy.deepcopy(out[kind][new])
                    a.pop('bufferView'); b.pop('bufferView'); assert a == b
        bin_path = str(Path(far_path).parent / 'geometry.bin')
        pending[far_path], pending[bin_path] = encoded(out), buffer
        far_dependencies = {far_path: digest(pending[far_path]), bin_path: digest(buffer)}
        for image in out['images']:
            path = image['uri'][len('/kite3d/'):]
            far_dependencies[path] = digest(pending[path])
        for path in dependencies:
            near_unique[path] = len(read(path))
        for path in far_dependencies:
            far_unique[path] = len(pending[path])
        entries.append({'id': fid, 'ownerTile': feature['ownerTile'], 'nearAsset': asset['path'],
                        'path': far_path, 'detail': 'far', 'preparationMode': mode, 'worldMatrix': feature['worldMatrix'],
                        'nearDependencies': dependencies, 'farDependencies': far_dependencies,
                        'sourceNodeIndices': selected, 'nearTriangles': feature['triangles'], 'triangles': triangles,
                        'nearDependencyBytes': asset['dependencyBytes'],
                        'dependencyBytes': sum(len(pending[p]) for p in far_dependencies),
                        'nearGeometryBytes': sum(len(read(str(Path(asset['path']).parent / b['uri']))) for b in doc['buffers']),
                        'geometryBytes': len(buffer), 'verifiedBufferViews': len(verified_views)})
    # Recheck all attested bytes before writing any output.
    for path, expected in context.items():
        if digest(read(path)) != expected:
            raise ValueError(f'Source changed during preparation: {path}')
    for entry in entries:
        for path, expected in entry['nearDependencies'].items():
            if digest(read(path)) != expected:
                raise ValueError(f'Near changed during preparation: {path}')
    report = {'version': 1, 'status': 'isolated-opt-in-candidate-not-integrated',
              'sourceContext': context, 'entries': entries, 'excluded': excluded,
              'preparationMode': mode,
              'invariants': 'Selected buffer views byte-identical; accessor metadata, node transforms, material values and sampled texture bytes preserved. ' +
                            ('Only combined cornice/window-frame meshes omitted; all roof, bay and glazing meshes retained. Visual threshold unvalidated.' if mode == 'trim-only' else 'Decorative near silhouette omitted; footprint-only candidate visually rejected for universal far use.'),
              'totals': {'buildings': len(entries), 'nearTriangles': sum(e['nearTriangles'] for e in entries),
                         'farTriangles': sum(e['triangles'] for e in entries),
                         'nearGeometryBytes': sum(e['nearGeometryBytes'] for e in entries),
                         'farGeometryBytes': sum(e['geometryBytes'] for e in entries),
                         'nearUniqueDependencyBytes': sum(near_unique.values()),
                         'farUniqueDependencyBytes': sum(far_unique.values())}}
    pending['assets/models/city/buildings-far/lod-manifest.json'] = encoded(report)
    output.mkdir(parents=True)
    for path, data in pending.items():
        destination = output / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    print(json.dumps({'output': str(output), 'totals': report['totals'], 'excluded': excluded}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['footprint', 'trim-only'], default='footprint')
    args = parser.parse_args()
    prepare(args.source, args.output, args.mode)
