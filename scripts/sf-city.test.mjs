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
        doc.scenes[doc.scene || 0].nodes.push(added)
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
        assert.ok(result.scenes[0].nodes.includes(added))
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
