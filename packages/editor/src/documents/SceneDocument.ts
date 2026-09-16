import {CanvasSnapshotPlugin, IGeometry, IMaterial, ImportResult, IObject3D, ITexture} from 'threepipe'
import {sceneGltfName, serializeSceneGltf} from '@kite3d/engine/sceneSerialization'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {Viewport} from './Viewport.ts'
import {EditorDocument, SaveResult} from './EditorDocument.ts'
import {EditModePlugin} from '../utils/EditModePlugin.ts'
import {
    backupPath,
    isExternalGeometry,
    isExternalMaterial,
    isExternalObject,
    isExternalTexture,
    sha256Hex,
    thumbPath
} from '../utils/projectUtils.ts'

/** A `.scene.gltf` file: the project's own nodes, saved as text glTF with its sidecars. */
export class SceneDocument extends EditorDocument {
    /** The name the file carries. threepipe names the model root 'Scene' for the UI, so it is kept here. */
    sceneName: string | null = null
    /** sha256 of the text this tab last loaded or saved. */
    savedHash: string | null = null

    constructor(path: string, session: ViewerInstanceManager, viewport: Viewport) {
        super(path, 'scene', session, viewport)
    }

    async load() {
        const saved = await this.session.getLoadedFile(this.session.loadedProject!, this.path)
        if (!saved) throw new Error('File not found: ' + this.path)
        const url = this.session.source.fileUrl(this.path, this.session.manifest.files.get(this.path)?.sha256)
        await this.importTree(saved.file, url)
    }

    /**
     * Reads one glTF into this document's tree. The scene loads from its own URL, so its .bin and its
     * textures resolve next to it. Play's snapshot is held in memory and never on disk, so its bytes
     * come along in `file`.
     */
    async importTree(file: File, url: string) {
        const viewer = this.viewer
        const editMode = viewer.getPlugin(EditModePlugin)
        await this.session.scriptUtil.scriptsRefreshing
        if (file.name === 'dummy' || file.size === 0) {   // a scene the Files panel has just created
            this.sceneName = null
            this.dirty = true
            return
        }
        editMode?.disable('loadImport')
        try {
            // viewer.import, not viewer.load: adding the result to the scene would move the file's
            // children and its animations into the permanent model root, where the next document
            // would find them. The document takes them instead.
            const res = await viewer.import<ImportResult & IObject3D>(url, {importedFile: file})
            if (!res) throw new Error('Failed to load file ' + this.path)
            if (res._loadingPromise) await res._loadingPromise
            this.takeRootPath(res)
            this.importedViewerConfig = res.importedViewerConfig
            this.rootMeta = {gltfAsset: res.userData.gltfAsset, gltfExtras: res.userData.gltfExtras}
            this.animations = res.animations ?? []
            this.nodes = (res._childrenCopy ?? [...res.children]) as IObject3D[]
            for (const node of this.nodes) node.removeFromParent()
            this.sceneName = sceneGltfName(await file.text()) ?? null
        } finally {
            editMode?.enable('loadImport')
        }
    }

    async settle() {
        this.restoreEditCamera()
        // Loading the scene and placing the edit camera raise update events of their own, so the flag
        // is cleared once the scene is settled, against the text it serializes to now.
        this.savedHash = await sha256Hex((await this.serialize()).gltf)
        this.dirty = false
    }

    owns(item: IObject3D | IMaterial | ITexture | IGeometry) {
        // The scene file saves everything but a placed asset's own clone children, which is what
        // isExternal* tests.
        if ((item as IObject3D).isObject3D) return !isExternalObject(item as IObject3D)
        if ((item as IMaterial).isMaterial) return !isExternalMaterial(item as IMaterial)
        if ((item as ITexture).isTexture) return !isExternalTexture(item as ITexture)
        return !isExternalGeometry(item as IGeometry)
    }

    /** A scene's dirty flag can be stale, so the text decides whether there is anything to lose. */
    protected async confirmDiscard() {
        if (this.dirty && !await this.differsFromSaved()) return true
        return super.confirmDiscard()
    }

    /** The edit camera takes the scene's own camera, so a scene opens where it was authored. */
    private restoreEditCamera() {
        const editMode = this.viewer.getPlugin(EditModePlugin)
        if (!editMode) return
        const saved = this.viewer.scene.defaultCamera
        editMode.cameraMode = saved.isPerspectiveCamera ? 'perspective' : 'orthographic'
        const camera = editMode.cameraMode === 'orthographic' ? editMode.cameraOrtho : editMode.cameraPerspective
        camera.position.copy(saved.position)
        camera.quaternion.copy(saved.quaternion)
        camera.target.copy(saved.target)
        camera.setDirty({change: 'transform'})
    }

    /** The scene as the text that goes to disk. The save, the dirty check and the load all read it here. */
    private serialize() {
        return serializeSceneGltf(this.viewer, {
            scenePath: this.path,
            base: this.session.filesBase,
            assets: this.session.loadedProject?.assetsManifest,
            sceneName: this.sceneName,
        })
    }

    /**
     * The dirty flag follows scene events, and a load or a save can leave one queued for the next
     * frame. Serializing is the answer that cannot be wrong, so it settles the cases that discard work.
     */
    async differsFromSaved(): Promise<boolean> {
        if (!this.savedHash) return true
        return await sha256Hex((await this.serialize()).gltf) !== this.savedHash
    }

    /**
     * The scene as the project's text glTF. The sidecars, its buffer and any embedded image, are
     * written next to it; the `.gltf` itself is returned so the save writes it with its own base sha.
     */
    private async exportScene(takePreview = true) {
        if (this.session.playMode.isRunningMode) return {error: 'cannot export scene while running/playing'}
        const handle = this.session.loadedProject?.handle
        if (!handle) return {error: 'no project to export the scene into'}

        const exported = await this.session.withEditorHidden(async (viewer) => {
            // An isolated view hides objects that are visible in the scene. The file keeps the scene's own.
            const serialized = await viewer.getPlugin(EditModePlugin)!.withIsolateVisibilityRestored(() =>
                this.session.whileNotRendering(viewer, () => this.serialize()))
            // The thumbnail is taken while the grid and the gizmos are still hidden.
            const snapshot = takePreview && viewer.renderEnabled
                ? await viewer.getPlugin(CanvasSnapshotPlugin)!.getFile('snapshot.jpeg', {
                    mimeType: 'image/jpeg',
                    quality: 0.85,
                    waitForProgressive: false,
                })
                : null
            return {serialized, preview: snapshot ? new File([snapshot], 'preview.jpg', {type: 'image/jpeg'}) : ''}
        }).catch(e => {
            console.error('Failed to export scene', e)
            return undefined
        })
        if (!exported) return {error: 'failed to export scene'}

        for (const sidecar of exported.serialized.files) {
            const bytes = sidecar.bytes as Uint8Array<ArrayBuffer>   // every producer allocates a plain ArrayBuffer
            await this.session.fsHelper.writeFile(handle, sidecar.path, new File([bytes], sidecar.path.split('/').pop()!))
        }
        // A scene whose last mesh went away has no buffer left, so its .bin would be stale bytes on disk.
        const binPath = this.path.replace(/\.gltf$/i, '.bin')
        if (!exported.serialized.files.some(f => f.path === binPath) && this.session.manifest.files.has(binPath)) {
            await this.session.source.delete(binPath)
            this.session.manifest.files.delete(binPath)
            this.session.manifest.based.delete(binPath)
        }

        return {
            file: new File([exported.serialized.gltf as Uint8Array<ArrayBuffer>], this.path.split('/').pop()!, {type: 'model/gltf+json'}),
            preview: exported.preview,
        }
    }

    async save(): Promise<SaveResult> {
        const project = this.session.loadedProject
        const handle = project?.handle
        if (!project || !handle) return {error: 'Cannot get project directory handle'}

        this.session.savingScene = true
        try {
            const res = await this.exportScene()
            if (!res.file) return res as SaveResult

            const listed = this.session.manifest.files.get(this.path)
            if (listed) {
                // The backup keeps the copy that is on disk now. It reads through the transport, not
                // through the handle, so the save below still carries the base this tab loaded.
                const original = await this.session.source.read(this.path, listed.sha256)
                this.session.fsHelper.writeFile(handle, backupPath(this.path, Date.now().toFixed()), new File([original.bytes], listed.path.split('/').pop()!)).catch(e => {
                    console.error('Failed to create backup of scene file.', e)
                })
            }
            const saved = await this.session.writeResolvingConflict(this, handle, this.path, res.file).catch(e => {
                console.error(e)
                return null
            })
            if (saved !== 'written') {
                if (!saved) return {error: 'Failed to save scene file.'}
                return saved === 'reloaded'
                    ? {error: null, warn: `Reloaded ${this.path} from disk. The editor copy is gone.`}
                    : {error: null, warn: `${this.path} changed on disk. Nothing was saved.`}
            }

            if (res.preview) {
                await this.session.fsHelper.writeFile(handle, thumbPath(this.path), res.preview as File).catch(e => {
                    console.error('Unable to save scene thumbnail')
                    console.error(e)
                    return false
                })
            }

            project.lastModified = Date.now()
            this.savedHash = await sha256Hex(await res.file.arrayBuffer())
            this.dirty = false
            return {error: null}
        } finally {
            this.session.savingScene = false
        }
    }

    /** A scene update is also raised by the editor settling around a change, so the flag is re-checked. */
    private recheck?: ReturnType<typeof setTimeout>
    private lastRecheckHash: string | null = null

    recheckDirty() {
        clearTimeout(this.recheck)
        this.recheck = setTimeout(async () => {
            if (!this.dirty || this.session.savingScene || this.session.playMode.isRunningMode) return
            const hash = await sha256Hex((await this.serialize()).gltf).catch(() => null)
            if (!hash) return
            if (hash === this.savedHash) {
                this.dirty = false
                this.lastRecheckHash = null
                return
            }
            // The asset refreshes that follow a load settle over several seconds, so a text that is
            // still moving is no answer. A text that has stopped moving is the user's own edit, and
            // the flag stays true until they save it.
            const settling = hash !== this.lastRecheckHash
            this.lastRecheckHash = hash
            if (settling) this.recheckDirty()
        }, 300)
    }
}
