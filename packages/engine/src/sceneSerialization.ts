import {PropertyBinding, type IObject3D, type ThreeViewer} from 'threepipe'
import {assetUrlPrefix} from './runtime/projectFormat.ts'

export interface SerializeSceneGltfOptions {
    scenePath?: string
    /**
     * The base the viewer resolved project URLs against, the one `createProjectAssetURLModifier` was
     * given. Strings that point into the project through it are written back as project paths.
     */
    base?: URL
    /**
     * The name the scene carries in its file, from `sceneGltfName`. threepipe names the model root
     * 'Scene' for the UI, so the exporter would write that name over the file's own. A scene with no
     * name of its own is written without one.
     */
    sceneName?: string | null
}

export interface SerializedSceneFile {
    path: string
    bytes: Uint8Array
}

export interface SerializedSceneGltf {
    gltf: Uint8Array
    files: SerializedSceneFile[]
}

interface GltfBuffer {
    byteLength?: number
    uri?: string
    [key: string]: unknown
}

interface GltfBufferView {
    buffer: number
    byteOffset?: number
    byteLength: number
    [key: string]: unknown
}

interface GltfAccessor {
    bufferView?: number
    [key: string]: unknown
}

interface GltfPrimitive {
    attributes?: Record<string, number>
    targets?: Record<string, number>[]
    indices?: number
    [key: string]: unknown
}

interface GltfMesh {
    primitives?: GltfPrimitive[]
    [key: string]: unknown
}

interface GltfSkin {
    inverseBindMatrices?: number
    [key: string]: unknown
}

interface GltfAnimation {
    samplers?: {input: number, output: number}[]
    [key: string]: unknown
}

interface GltfImage {
    uri?: string
    mimeType?: string
    [key: string]: unknown
}

interface GltfNode {
    name?: string
    extras?: Record<string, unknown>
    [key: string]: unknown
}

interface GltfScene {
    name?: string
    [key: string]: unknown
}

interface GltfDocument extends Record<string, unknown> {
    scene?: number
    scenes?: GltfScene[]
    buffers?: GltfBuffer[]
    bufferViews?: GltfBufferView[]
    accessors?: GltfAccessor[]
    images?: GltfImage[]
    nodes?: GltfNode[]
    meshes?: GltfMesh[]
    skins?: GltfSkin[]
    animations?: GltfAnimation[]
}

const encoder = new TextEncoder()

/** Export a viewer scene as deterministic text glTF plus external resources. */
export async function serializeSceneGltf(
    viewer: Pick<ThreeViewer, 'exportScene'>,
    options: SerializeSceneGltfOptions = {},
): Promise<SerializedSceneGltf> {
    const blob = await viewer.exportScene({
        exportExt: 'gltf',
        preserveUUIDs: true,
        viewerConfig: true,
        embedUrlImages: false,
        onlyVisible: false,
        shouldExportObject: isAuthoredSceneObject,
        jsonSpaces: 2,
    }, false)
    if (!blob) throw new Error('The scene exporter returned no glTF data')
    return serializeSceneGltfDocument(JSON.parse(await blob.text()), options)
}

function isAuthoredSceneObject(object: IObject3D): boolean {
    return object.userData?.excludeFromExport !== true
        && object.userData?.isWidgetRoot !== true
        && object.isWidget !== true
        && object.assetType !== 'widget'
}

/** Canonicalize JSON glTF and extract every embedded resource. */
async function serializeSceneGltfDocument(
    input: unknown,
    options: SerializeSceneGltfOptions = {},
): Promise<SerializedSceneGltf> {
    if (!isRecord(input) || !isRecord(input.asset)) {
        throw new Error('The scene is not a JSON glTF document')
    }
    const document = cloneJson(input) as GltfDocument
    applySceneName(document, options.sceneName)
    restoreAuthoredNames(document)
    removeVolatileViewerIds(document)
    removeUnreferencedUuids(document)
    sortExtensionLists(document)
    canonicalizeAccessorOrder(document)
    const scenePath = normalizeProjectPath(options.scenePath || 'assets/main.scene.gltf')
    const sceneDirectory = directoryName(scenePath)
    const files: SerializedSceneFile[] = []

    extractBuffers(document, sceneDirectory, fileStem(scenePath), files)
    await extractImages(document, sceneDirectory, files)

    const canonical = canonicalizeJson(document, projectPathRewriter(options.base)) as GltfDocument
    return {
        gltf: encoder.encode(`${JSON.stringify(canonical, null, 2)}\n`),
        files: files.sort((left, right) => left.path.localeCompare(right.path)),
    }
}

/** The name the scene in a glTF file carries. It survives a load and a save through `sceneName`. */
export function sceneGltfName(gltf: string): string | undefined {
    return mainScene(JSON.parse(gltf) as GltfDocument)?.name
}

/**
 * threepipe names the model root 'Scene' for the UI (RootScene.ts:250) and the exporter writes the model
 * root as the glTF scene, so the file would take the UI's name on every save. The file's own name goes
 * back in its place, and a scene without one is written without one.
 */
function applySceneName(document: GltfDocument, name: string | null | undefined): void {
    const scene = mainScene(document)
    if (!scene) return
    if (name) scene.name = name
    else delete scene.name
}

function mainScene(document: GltfDocument): GltfScene | undefined {
    return document.scenes?.[typeof document.scene === 'number' ? document.scene : 0]
}

/**
 * three's GLTFLoader sanitizes a node name into `Object3D.name`, so that animation tracks can bind to it,
 * and keeps the authored name in `userData.name` (GLTFLoader.js:4391). The exporter writes the sanitized
 * name as the node name and the authored one into `extras`, so the authored name goes back where it was
 * written, and the copy in `extras` goes. A node the editor renamed no longer carries the loader's name,
 * and keeps the new one.
 */
function restoreAuthoredNames(document: GltfDocument): void {
    for (const node of document.nodes || []) {
        const extras = node.extras
        if (!isRecord(extras) || typeof extras.name !== 'string') continue
        if (isLoaderNameOf(node.name || '', extras.name)) node.name = extras.name
        delete extras.name
        if (!Object.keys(extras).length) delete node.extras
    }
}

/** The name the loader makes from an authored one, plus the `_1` and up that a repeated name gets. */
function isLoaderNameOf(name: string, authored: string): boolean {
    const sanitized = PropertyBinding.sanitizeNodeName(authored)
    return name === sanitized || name.startsWith(sanitized) && /^_\d+$/.test(name.slice(sanitized.length))
}

function removeVolatileViewerIds(value: unknown): void {
    if (Array.isArray(value)) {
        value.forEach(removeVolatileViewerIds)
        return
    }
    if (!isRecord(value)) return
    if (value.rootSceneModelRoot === true) delete value.gltfUUID
    if (isRecord(value.WEBGI_viewer)) {
        canonicalizeViewerConfig(value.WEBGI_viewer)
        const scene = value.WEBGI_viewer.scene
        const camera = isRecord(scene) ? scene.defaultCamera : undefined
        const object = isRecord(camera) ? camera.object : undefined
        if (isRecord(object)) delete object.uuid
    }
    Object.values(value).forEach(removeVolatileViewerIds)
}

function removeUnreferencedUuids(document: GltfDocument): void {
    const uses = new Map<string, number>()
    visitJson(document, (key, value) => {
        uses.set(key, (uses.get(key) || 0) + 1)
        if (typeof value === 'string') uses.set(value, (uses.get(value) || 0) + 1)
    })
    visitJson(document, (key, value, owner) => {
        if (key === 'uuid' && typeof value === 'string' && uses.get(value) === 1) delete owner[key]
    })
}

function visitJson(
    value: unknown,
    visit: (key: string, value: unknown, owner: Record<string, unknown>) => void,
): void {
    if (Array.isArray(value)) {
        value.forEach((child) => visitJson(child, visit))
        return
    }
    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
        visit(key, child, value)
        visitJson(child, visit)
    }
}

function canonicalizeViewerConfig(value: unknown): void {
    if (Array.isArray(value)) {
        value.forEach(canonicalizeViewerConfig)
        return
    }
    if (!isRecord(value)) return
    if (value.isEuler === true) {
        if (typeof value.order !== 'string') value.order = 'XYZ'
        if (typeof value.x !== 'number') value.x = 0
        if (typeof value.y !== 'number') value.y = 0
        if (typeof value.z !== 'number') value.z = 0
    }
    if (value.autoAspect === true) {
        delete value.aspect
        if (isRecord(value.object)) delete value.object.aspect
    }
    Object.values(value).forEach(canonicalizeViewerConfig)
}

/**
 * three's exporter writes an accessor, and the bytes behind it, the first time it meets an attribute, so the
 * file follows `geometry.attributes` insertion order: a box built in the editor lists POSITION first, the same
 * box read back from its file lists NORMAL first, and the first save after a reload rewrites every accessor
 * index. That order is not part of the scene, so it goes: the accessors follow the document that names them,
 * a primitive's attributes by name, and the buffer views follow their accessors, which makes the `.bin`
 * canonical too.
 */
function canonicalizeAccessorOrder(document: GltfDocument): void {
    const accessors = document.accessors
    if (!accessors?.length) return
    const newIndex = new Map<number, number>()
    const oldOrder: number[] = []
    const claim = (index: number) => {
        if (!newIndex.has(index)) newIndex.set(index, oldOrder.push(index) - 1)
    }
    mapAccessorReferences(document, (index) => {
        claim(index)
        return index
    })
    for (let index = 0; index < accessors.length; index++) claim(index)   // an accessor nothing names keeps its place
    document.accessors = oldOrder.map((index) => accessors[index])
    mapAccessorReferences(document, (index) => newIndex.get(index)!)
    canonicalizeBufferViewOrder(document)
}

/** The six places three's exporter makes an accessor, in one fixed order. */
function mapAccessorReferences(document: GltfDocument, map: (index: number) => number): void {
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            mapAttributes(primitive.attributes, map)
            for (const target of primitive.targets || []) mapAttributes(target, map)
            if (typeof primitive.indices === 'number') primitive.indices = map(primitive.indices)
        }
    }
    for (const node of document.nodes || []) {
        // An instanced mesh: three writes its per-instance transforms as accessors of their own.
        const instancing = isRecord(node.extensions) ? node.extensions.EXT_mesh_gpu_instancing : undefined
        if (isRecord(instancing)) mapAttributes(instancing.attributes as Record<string, number> | undefined, map)
    }
    for (const skin of document.skins || []) {
        if (typeof skin.inverseBindMatrices === 'number') skin.inverseBindMatrices = map(skin.inverseBindMatrices)
    }
    for (const animation of document.animations || []) {
        for (const sampler of animation.samplers || []) {
            sampler.input = map(sampler.input)
            sampler.output = map(sampler.output)
        }
    }
}

function mapAttributes(attributes: Record<string, number> | undefined, map: (index: number) => number): void {
    if (!attributes) return
    for (const name of Object.keys(attributes).sort()) attributes[name] = map(attributes[name])
}

/** A buffer view holds one accessor's bytes, so the views go in the order of the accessors that read them. */
function canonicalizeBufferViewOrder(document: GltfDocument): void {
    const views = document.bufferViews
    if (!views?.length) return
    const newIndex = new Map<number, number>()
    const oldOrder: number[] = []
    const claim = (index: number) => {
        if (!newIndex.has(index)) newIndex.set(index, oldOrder.push(index) - 1)
    }
    for (const accessor of document.accessors || []) {
        if (typeof accessor.bufferView === 'number') claim(accessor.bufferView)
    }
    for (let index = 0; index < views.length; index++) claim(index)
    document.bufferViews = oldOrder.map((index) => views[index])
    for (const accessor of document.accessors || []) {
        if (typeof accessor.bufferView === 'number') accessor.bufferView = newIndex.get(accessor.bufferView)!
    }
}

// three's exporter merges the scene into one buffer, so the document has one embedded buffer or none.
function extractBuffers(
    document: GltfDocument,
    sceneDirectory: string,
    baseName: string,
    files: SerializedSceneFile[],
): void {
    const embedded = document.buffers?.[0]
    if (!embedded?.uri?.startsWith('data:')) return
    const bytes = packBufferViews(document, decodeDataUrl(embedded.uri).bytes)
    const binName = `${baseName}.bin`
    document.buffers = [{byteLength: bytes.byteLength, uri: binName}]
    files.push({path: joinProjectPath(sceneDirectory, binName), bytes})
}

/** Lay the buffer out in the order the views are in now. A view starts on a four-byte boundary, as glTF asks. */
function packBufferViews(document: GltfDocument, buffer: Uint8Array): Uint8Array {
    const views = document.bufferViews || []
    const align = (offset: number) => Math.ceil(offset / 4) * 4
    let length = 0
    for (const view of views) length = align(length) + view.byteLength
    const packed = new Uint8Array(length)
    let offset = 0
    for (const view of views) {
        offset = align(offset)
        const start = view.byteOffset || 0
        packed.set(buffer.subarray(start, start + view.byteLength), offset)
        view.byteOffset = offset
        offset += view.byteLength
    }
    return packed
}

async function extractImages(
    document: GltfDocument,
    sceneDirectory: string,
    files: SerializedSceneFile[],
): Promise<void> {
    const byPath = new Map<string, Uint8Array>()
    for (const image of document.images || []) {
        if (!image.uri?.startsWith('data:')) continue
        const decoded = decodeDataUrl(image.uri)
        const mimeType = decoded.mimeType || image.mimeType || 'application/octet-stream'
        const hash = await sha256(decoded.bytes)
        const path = `assets/textures/${hash.slice(0, 16)}.${imageExtension(mimeType)}`
        byPath.set(path, decoded.bytes)
        image.uri = relativeProjectPath(sceneDirectory, path)
        image.mimeType = mimeType
    }
    for (const [path, bytes] of byPath) files.push({path, bytes})
}

function decodeDataUrl(uri: string): {bytes: Uint8Array, mimeType?: string} {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri)
    if (!match) throw new Error('Invalid data URL in glTF')
    return {
        bytes: match[2] ? decodeBase64(match[3]) : encoder.encode(decodeURIComponent(match[3])),
        mimeType: match[1] || undefined,
    }
}

function decodeBase64(value: string): Uint8Array {
    const decoded = atob(value)
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function imageExtension(mimeType: string): string {
    const normalized = mimeType.toLowerCase().split(';', 1)[0]
    const extensions: Record<string, string> = {
        'image/avif': 'avif',
        'image/gif': 'gif',
        'image/jpeg': 'jpg',
        'image/ktx2': 'ktx2',
        'image/png': 'png',
        'image/svg+xml': 'svg',
        'image/webp': 'webp',
    }
    return extensions[normalized] || normalized.split('/')[1]?.replace(/[^a-z0-9.+-]/g, '') || 'bin'
}

/** The two glTF extension lists are sets: the exporter fills them in load order, which a reload changes. */
function sortExtensionLists(document: GltfDocument): void {
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
        const list = document[key]
        if (Array.isArray(list)) list.sort()
    }
}

function canonicalizeJson(value: unknown, rewrite: (text: string) => string): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item, rewrite))
    if (typeof value === 'string') return rewrite(value)
    if (typeof value === 'number') return canonicalNumber(value)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key], rewrite)]))
}

/**
 * A URL that reaches a project file through the base goes back as `/kite3d/<path>`, the form the
 * engine's URL modifier turns into that same URL again. Without this a saved scene holds the dev
 * server's port, and it loads on no other port and in no published game. The root-relative form is
 * the same address written without the origin. Query and fragment go: the server adds `?v=<sha>`
 * and `?r=<revision>` to make one load cacheable, and neither names the file. The path segments
 * keep the encoding the URL carried, because the modifier hands them straight back to `URL`.
 */
function projectPathRewriter(base: URL | undefined): (text: string) => string {
    if (!base) return (text) => text
    return (text) => {
        const rest = text.startsWith(base.href) ? text.slice(base.href.length)
            : text.startsWith(base.pathname) ? text.slice(base.pathname.length)
                : null
        if (rest === null) return text
        const path = rest.split(/[?#]/, 1)[0]
        return path ? assetUrlPrefix + path : text
    }
}

/**
 * Nine significant digits: a scene value lives as float32 in the buffers and on the GPU, and float32 round
 * trips through nine digits, so nine keeps every position, rotation, colour and animation time the engine
 * can hold, while a transform recomputed from the same inputs moves far below the ninth digit and rounds
 * back to the same text. Integers are indices, counts and byte offsets: exact, sometimes longer than nine
 * digits, never noisy. The 1e-7 floor is float32 resolution at scene scale, so a value under it cannot
 * change any sum the renderer makes. Measured on a saved scene of boxes and a light: every number is above
 * 1e-2, except the leftover of a rotation rebuilt from the file, near 1e-10, which wanders from save to save.
 */
function canonicalNumber(value: number): number {
    if (Number.isInteger(value)) return value
    if (Math.abs(value) < 1e-7) return 0
    return Number(value.toPrecision(9))
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProjectPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error(`Invalid project path: ${path}`)
    }
    return normalized
}

function directoryName(path: string): string {
    const end = path.lastIndexOf('/')
    return end < 0 ? '' : path.slice(0, end)
}

function fileStem(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const end = name.lastIndexOf('.')
    return end < 0 ? name : name.slice(0, end)
}

function joinProjectPath(directory: string, name: string): string {
    return directory ? `${directory}/${name}` : name
}

function relativeProjectPath(fromDirectory: string, target: string): string {
    const from = fromDirectory ? fromDirectory.split('/') : []
    const to = target.split('/')
    while (from.length && to.length && from[0] === to[0]) {
        from.shift()
        to.shift()
    }
    return [...from.map(() => '..'), ...to].join('/') || '.'
}
