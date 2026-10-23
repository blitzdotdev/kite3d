import assert from 'node:assert/strict'
import {test} from 'node:test'
import {cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'

// Guards PR #53's reported loss of user asset registrations and unknown light extensions on regeneration.
test('SF composer preserves editor assets, light extensions and repeated regeneration', () => {
    const root = mkdtempSync(resolve('examples', '.sf-regression-'))
    try {
        cpSync('examples/sf-city', root, {recursive: true, filter: p => !p.includes('node_modules') && !p.includes('.kite3d')})
        const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'))
        const write = (p, value) => writeFileSync(resolve(root, p), JSON.stringify(value))
        const doc = read('assets/main.scene.gltf')
        const node = doc.nodes.find(n => n.extras?.cityGenerated?.rootPath)
        const sun = doc.nodes.find(n => n.extras?.cityId === 'sf-light:sun')
        const assets = read('assets.json')
        assets.ownerMetadata = {keep: true}
        assets.files.custom = {...Object.values(assets.files)[0], metadata: {keep: true}}
        const replacedId = Object.keys(assets.files)[1]
        assets.files[replacedId] = {...assets.files.custom, path: 'assets/owner-replacement.gltf'}
        node.extras.rootPath = '/kite3d/@custom/f.gltf'
        node.name = 'Owner replacement'
        node.extras.ownerNote = 'Keep this'
        const added = doc.nodes.push({name: 'Owner addition', extras: {rootPath: '/kite3d/@custom/f.gltf'}}) - 1
        const tile = doc.nodes.find(n => n.extras?.cityId?.startsWith('sf-tile:'))
        tile.children.push(added)
        sun.extensions.OWNER_extension = {keep: true}
        sun.extensions.KHR_lights_punctual.ownerKey = 42
        doc.extensions.KHR_lights_punctual.lights[0].extras = {keep: true}
        doc.extensions.KHR_lights_punctual.lights[0].extensions = {OWNER_extension: {keep: true}}
        write('assets/main.scene.gltf', doc); write('assets.json', assets)
        const run = () => execFileSync(process.execPath, ['scene/compose.mjs'], {cwd: root})
        run()
        const result = read('assets/main.scene.gltf')
        assert.deepEqual(read('assets.json').files.custom, assets.files.custom)
        assert.deepEqual(read('assets.json').files[replacedId], assets.files[replacedId])
        assert.deepEqual(read('assets.json').ownerMetadata, {keep: true})
        assert.equal(result.nodes.find(n => n.name === 'Owner replacement').extras.rootPath, '/kite3d/@custom/f.gltf')
        assert.equal(result.nodes.find(n => n.name === 'Owner replacement').extras.ownerNote, 'Keep this')
        assert.ok(result.nodes.find(n => n.extras?.cityId === tile.extras.cityId).children.includes(added))
        assert.deepEqual(result.nodes.find(n => n.extras?.cityId === 'sf-light:sun').extensions, sun.extensions)
        assert.deepEqual(result.extensions.KHR_lights_punctual.lights[0].extras, {keep: true})
        assert.deepEqual(result.extensions.KHR_lights_punctual.lights[0].extensions, {OWNER_extension: {keep: true}})
        const before = readFileSync(resolve(root, 'assets/main.scene.gltf'))
        run()
        assert.deepEqual(readFileSync(resolve(root, 'assets/main.scene.gltf')), before)
    } finally { rmSync(root, {recursive: true, force: true}) }
})

// Guards PR #53's reported bare threepipe import without a standalone project dependency.
test('SF runtime declares its direct threepipe dependency', () => {
    const pkg = JSON.parse(readFileSync('examples/sf-city/package.json'))
    assert.equal(pkg.dependencies.threepipe, '0.5.1')
    assert.equal(pkg.devDependencies.kite3d, '0.21.0-alpha.8')
})

// Guards the manually observed sidewalks across junctions and terrain poking through roads (park-edge screenshots).
test('street clipping removes crossing corridors and lowers their sidewalk approaches', async () => {
    const {strip, corridors, clipped, crossingLift} = await import('../examples/sf-city/assets/models/city/streets.mjs')
    const masks = corridors([{id: 'crossing', width: 4, points: [[0, -10], [0, 10]]}])
    const pieces = clipped(strip([-10, 0], [10, 0], 2, 4), masks)
    const area = polygon => Math.abs(polygon.reduce((sum, a, i) => {
        const b = polygon[(i + 1) % polygon.length]
        return sum + a[0] * b[1] - b[0] * a[1]
    }, 0)) / 2
    assert.ok(Math.abs(pieces.reduce((sum, p) => sum + area(p), 0) - 32) < 1e-8)
    for (const p of pieces) assert.ok(p.every(v => v[0] <= -2 + 1e-8) || p.every(v => v[0] >= 2 - 1e-8))
    assert.equal(crossingLift([2, 3], masks), 0.07)
    assert.ok(Math.abs(crossingLift([3.8, 3], masks) - 0.22) < 1e-8)
    assert.deepEqual(clipped(strip([-1, 0], [1, 0], -1, 1), masks), [])
})

// Guards PR #53 review r4346966230: editor replacements lost lights/animation and textured materials in Play.
test('batching accepts only current references and registrations for the generated kit', async () => {
    const {isGeneratedPlacement, bakedMeshes} = await import('../examples/sf-city/lib/generated-placement.js')
    const placement = {baked: true, asset: 'assets/models/city/buildings/example/f.gltf'}
    const rootPath = '/kite3d/@generated/f.gltf'
    const node = {visible: true, userData: {rootPath, cityGenerated: {rootPath}}}
    const registry = {files: {generated: {path: placement.asset, files: {'f.gltf': placement.asset}}}}
    assert.equal(isGeneratedPlacement(node, placement, registry), true)
    // Reviews r4347541802/r4347541815: moving placements froze and hidden tiles reappeared in Play.
    assert.equal(isGeneratedPlacement({...node, parent: {visible: false}}, placement, registry), false)
    assert.equal(isGeneratedPlacement({...node, parent: {visible: true, parent: {visible: false}}}, placement, registry), false)
    assert.equal(isGeneratedPlacement({...node, userData: {...node.userData, EntityComponentPlugin: {motion: {type: 'Move'}}}}, placement, registry), false)
    assert.equal(isGeneratedPlacement({...node, parent: {userData: {EntityComponentPlugin: {motion: {type: 'Move'}}}}}, placement, registry), false)
    assert.equal(isGeneratedPlacement({...node, animations: [{}]}, placement, registry), false)

    // Review r4347070699: an authored override inside city/ is still not baked.
    assert.equal(isGeneratedPlacement(node, {...placement, baked: false}, registry), false)
    // Review r4347070695: owner-added lights/meshes must not be hidden with the baked parent.
    const mesh = {isMesh: true, visible: true, userData: {cityBakedPart: true}, children: []}
    const authored = {isMesh: true, visible: true, userData: {}, children: []}
    const lightParent = {...mesh, children: [{isLight: true}]}
    const root = {userData: {cityBakedAsset: placement.asset}, children: [mesh, authored, lightParent]}
    assert.deepEqual(bakedMeshes({traverse: visit => visit(root)}, placement), [mesh])
    assert.equal(isGeneratedPlacement({...node, userData: {...node.userData, rootPath: '/kite3d/@owner/f.gltf'}}, placement, registry), false)
    assert.equal(isGeneratedPlacement(node, placement, {files: {generated: {path: 'assets/owner/f.gltf'}}}), false)
    assert.equal(isGeneratedPlacement(node, placement, {files: {generated: {path: placement.asset, files: {'f.gltf': 'assets/owner/f.gltf'}}}}), false)
    assert.equal(isGeneratedPlacement({visible: true, userData: {}}, placement, registry), false)
})

// Guards PR #53 review r4346966246: centerline dashes extended into earlier-owned crossing streets.
test('baked center markings stay outside earlier road corridors', async () => {
    const {loadCity} = await import('../examples/sf-city/scene/data.mjs')
    const {corridors, clipped} = await import('../examples/sf-city/assets/models/city/streets.mjs')
    const masks = corridors(loadCity().roads)
    let checked = 0
    for (const road of loadCity().roads) {
        const base = `examples/sf-city/assets/models/city/roads/${road.id.replace(':', '-')}`
        const doc = JSON.parse(readFileSync(`${base}/f.gltf`))
        const paint = doc.meshes.find(m => m.name === 'Inferred center markings')
        if (!paint) continue
        const data = readFileSync(`${base}/geometry.bin`)
        const access = index => {
            const a = doc.accessors[index], v = doc.bufferViews[a.bufferView]
            const start = (v.byteOffset || 0) + (a.byteOffset || 0)
            return {a, start}
        }
        const earlier = masks.slice(0, masks.findIndex(m => m.id === road.id))
        for (const primitive of paint.primitives) {
            const pos = access(primitive.attributes.POSITION), ind = access(primitive.indices)
            for (let i = 0; i < ind.a.count; i += 3) {
                const triangle = [0, 1, 2].map(j => {
                    const index = data.readUInt32LE(ind.start + (i + j) * 4)
                    return [data.readFloatLE(pos.start + index * 12), data.readFloatLE(pos.start + index * 12 + 8)]
                })
                const area = p => Math.abs(p.reduce((n, a, j) => {const b = p[(j + 1) % p.length]; return n + a[0] * b[1] - b[0] * a[1]}, 0)) / 2
                const remaining = clipped(triangle, earlier).reduce((n, p) => n + area(p), 0)
                assert.ok(area(triangle) - remaining < 1e-4, `Crossing paint: ${road.name}`)
                checked++
            }
        }
    }
    assert.ok(checked > 100)
})

// Guards review r4347070692: unused registered private assets leaked into the public export.
// Guards review r4347070706: hidden overrides whose source disappeared were never reported.
test('public export excludes unused registrations and reconciliation reports stale hidden IDs', () => {
    const root = mkdtempSync(resolve('examples', '.sf-regression-'))
    try {
        cpSync('examples/sf-city', root, {recursive: true, filter: p => !p.includes('node_modules') && !p.includes('.kite3d') && !p.includes('/dist')})
        const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'))
        const write = (p, v) => writeFileSync(resolve(root, p), JSON.stringify(v))
        const registry = read('assets.json')
        registry.files.private = {path: 'assets/private.gltf'}
        write('assets.json', registry)
        execFileSync(process.execPath, ['scene/export.mjs'], {cwd: root})
        assert.equal(read('dist/assets.json').files.private, undefined)
        assert.equal(read('.kite3d/release.json').files['assets/private.gltf'], undefined)
        const overrides = read('scene/overrides.json')
        const valid = read('scene/generated.json').placements.find(p => p.kind === 'building').id
        overrides.features[valid] = {hidden: true}
        overrides.features['sf-building:removed'] = {hidden: true}
        write('scene/overrides.json', overrides)
        const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import {loadCity} from './scene/data.mjs'; console.log(JSON.stringify(loadCity()))"], {cwd: root, encoding: 'utf8'}))
        assert.ok(result.unmatchedOverrides.includes('sf-building:removed'))
        assert.ok(!result.unmatchedOverrides.includes(valid))
        assert.ok(!result.buildings.some(b => b.id === valid))
    } finally { rmSync(root, {recursive: true, force: true}) }
})

// Guards the manually inspected Grant render: inward retained-wall normals caused
// diamond-shaped self-shadow acne even with normal maps disabled.
test('photo facade retained walls face away from solid building volume', async () => {
    const {retainedWalls} = await import('../examples/sf-city/assets/models/city/photo-facade.mjs')
    for (const reverse of [false, true]) {
        const outer = [[0, 0], [10, 0], [10, 10], [0, 10]]
        const hole = [[3, 3], [3, 7], [7, 7], [7, 3]]
        if (reverse) { outer.reverse(); hole.reverse() }
        const parts = retainedWalls({center: [5, 5], polygons: [[outer, hole]]}, {edge: -1}, 0, 0, 8)
        for (const [i, part] of parts.entries()) {
            const position = part.geometry.getAttribute('position'), normal = part.geometry.getAttribute('normal')
            const mx = (position.getX(0) + position.getX(1)) / 2
            const mz = (position.getZ(0) + position.getZ(1)) / 2
            const away = mx * normal.getX(0) + mz * normal.getZ(0)
            assert.ok(i < 4 ? away > 0 : away < 0, `Wrong solid-facing normal at wall ${i}`)
            part.geometry.dispose()
        }
    }
})
