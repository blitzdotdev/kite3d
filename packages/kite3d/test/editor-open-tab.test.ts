import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, expect, it} from 'vitest'
import {createDevServer} from '../src/server.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

// Guards the owner's report: "newly opened tabs viewport remain empty until i switch to another
// viewport tab and then switch back to the newly opened one". The centre strip draws the active
// tab's panel alone, so the tab an open adds mounts a new canvas container, and the viewer's canvas
// has to move into it on that same commit.
it('leaves the viewer canvas mounted in the tab an open adds', async (context) => {
    const chromium = await browserLauncher()
    if (!chromium) {
        context.skip('Playwright is not installed. Run npx playwright install chromium.')
        return
    }
    const root = await temporaryProject()
    const server = await createDevServer({projectRoot: root, port: 0})
    cleanup.push(() => server.close())
    const browser = await chromium.launch({headless: true})
    cleanup.push(() => browser.close())

    const page = await browser.newPage({viewport: {width: 1280, height: 800}})
    await page.goto(server.url, {waitUntil: 'domcontentloaded', timeout: 60_000})
    await page.waitForFunction('window.kite3dProjectLoaded === true', undefined, {timeout: 60_000})
    await page.waitForSelector('.editorCanvasContainer canvas', {timeout: 30_000})
    expect(await viewportOnScreen(page)).toEqual({mounted: true, drawn: true})

    // The Files panel double click, the way a user opens a file.
    await page.dblclick('button.file-item-button[title="pixel.png"]', {timeout: 30_000})
    await page.waitForSelector('[role="tab"][aria-selected="true"] .document-tab-name:text-is("pixel.png")', {
        timeout: 60_000,
    })

    // No tab switch, no second render: the canvas is in the panel that is on screen, or it is not.
    expect(await viewportOnScreen(page)).toEqual({mounted: true, drawn: true})
})

/**
 * Whether the viewer's canvas is in the container the page shows, and has a size. A query finds
 * mounted elements alone, so a canvas left behind in the panel that closed answers false.
 */
function viewportOnScreen(page: {evaluate: (script: string) => Promise<unknown>}): Promise<unknown> {
    return page.evaluate(`(() => {
        const mount = document.querySelector('.editorCanvasContainer')
        const canvas = window.viewer.canvas
        return {mounted: Boolean(mount && mount.contains(canvas)), drawn: canvas.clientWidth > 0}
    })()`)
}

async function browserLauncher() {
    try {
        const {chromium} = await import('playwright')
        return chromium
    } catch {
        return undefined
    }
}

async function temporaryProject(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-open-tab-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await writeFile(resolve(root, 'package.json'), `${JSON.stringify({
        name: 'open-tab-test',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'kite3d': KITE3D_VERSION},
    })}\n`)
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}\n')
    await writeFile(resolve(root, 'main.js'), 'export async function main() {}\n')
    // The second openable document. An image reads without the network, where an object or a
    // material document fetches the preview environment before its first show settles.
    await writeFile(resolve(root, 'pixel.png'), Buffer.from(ONE_PIXEL_PNG, 'base64'))
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'assets/main.scene.gltf'), `${JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: 'Authored triangle', mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
        accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0]}],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}],
        buffers: [{byteLength: 36, uri: 'data:application/octet-stream;base64,AAAAAAAAgD8AAAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAA='}],
    })}\n`)
    await mkdir(resolve(root, 'node_modules/@kite3d/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/package.json'), JSON.stringify({version: KITE3D_VERSION}))
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/dist/runtime.js'), 'installed runtime')
    return root
}

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
