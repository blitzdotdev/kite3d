import {
    Color,
    IGeometry,
    IMaterial,
    IObject3D,
    ITexture,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    UndoManagerPlugin,
    Vector3Tuple,
    Vector4Tuple
} from 'threepipe'
import type {JSUndoManagerCommand} from 'ts-browser-helpers'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {EditorDocument} from './EditorDocument.ts'
import {SceneDocument} from './SceneDocument.ts'
import {EditModePlugin} from '../utils/EditModePlugin.ts'

/** What the viewport gives back to a document when it comes back on screen. */
export interface ViewportState {
    camera: {
        position: Vector3Tuple
        quaternion: Vector4Tuple
        target: Vector3Tuple
        mode: 'perspective' | 'orthographic'
    }
    /** The picked object's uuid. Picking holds one object at a time. */
    selection: string | null
    /**
     * The scene settings the documents differ in. They are references, not a serialized copy, because
     * an open document stays in memory and so does everything it points at.
     */
    scene: {
        environment: ITexture | null
        background: ITexture | Color | null
        backgroundColor: Color | null
    }
    undo: {stack: JSUndoManagerCommand[], sp: number}
}

/**
 * The one 3D viewer. It shows one document at a time: switching detaches the current tree from the
 * model root, attaches the next one and gives that document its camera, selection, scene settings
 * and undo ledger back.
 */
export class Viewport {
    current: EditorDocument | null = null

    constructor(readonly viewer: ThreeViewer, readonly session: ViewerInstanceManager) {
        this.installDirtyListeners()
    }

    /**
     * Switches run one after another. A first show awaits the file's config and its settle, and a
     * second click inside that window would find nothing attached and attach a second document.
     */
    private queue: Promise<void> = Promise.resolve()

    show(doc: EditorDocument): Promise<void> {
        this.queue = this.queue.then(() => this.showNow(doc), () => this.showNow(doc))
        return this.queue
    }

    private async showNow(doc: EditorDocument) {
        if (this.current === doc) return
        this.hide()
        await this.attach(doc)
    }

    /** Takes the current document off the viewport. Nothing is attached after this. */
    hide() {
        const doc = this.current
        if (!doc) return
        this.viewer.getPlugin(EditModePlugin)?.exitIsolate()
        doc.state = this.capture()
        this.clearHolders()
        // The captured ledger holds commands over the tree that is leaving. The next attach installs
        // its own; until then the manager is empty, so nothing can undo into a detached document.
        this.installLedger({stack: [], sp: -1})
        // Nothing is on the viewport from here on, so the update events the detach raises are nobody's
        // edits. A document that stayed current through its own detach would be marked dirty by it.
        this.current = null
        this.detach(doc)
    }

    /**
     * Frees the document's tree and loads it again in place. Play swaps its snapshot in this way, and
     * so does a file that changed on disk.
     */
    async reload(doc: EditorDocument, load: () => Promise<void>) {
        const attached = this.current === doc
        if (attached) {
            this.viewer.getPlugin(EditModePlugin)?.exitIsolate()
            this.clearHolders()
            this.current = null
            this.detach(doc)
        }
        doc.unload()
        await load()
        if (attached) await this.attach(doc)
    }

    capture(): ViewportState {
        const editMode = this.viewer.getPlugin(EditModePlugin)!
        const mode = editMode.cameraMode === 'orthographic' ? 'orthographic' : 'perspective'
        const camera = mode === 'orthographic' ? editMode.cameraOrtho : editMode.cameraPerspective
        const undo = this.viewer.getPlugin(UndoManagerPlugin)?.undoManager
        const scene = this.viewer.scene
        return {
            camera: {
                position: camera.position.toArray(),
                quaternion: camera.quaternion.toArray() as Vector4Tuple,
                target: camera.target.toArray(),
                mode,
            },
            selection: this.viewer.getPlugin(PickingPlugin)?.getSelectedObject()?.uuid ?? null,
            scene: {
                environment: scene.environment,
                background: scene.background as ITexture | Color | null,
                backgroundColor: scene.backgroundColor,
            },
            undo: {stack: undo?.stack ?? [], sp: undo?.sp ?? -1},
        }
    }

    apply(state: ViewportState) {
        const scene = this.viewer.scene
        scene.environment = state.scene.environment
        scene.background = state.scene.background as any
        scene.backgroundColor = state.scene.backgroundColor

        const editMode = this.viewer.getPlugin(EditModePlugin)!
        editMode.cameraMode = state.camera.mode
        const camera = state.camera.mode === 'orthographic' ? editMode.cameraOrtho : editMode.cameraPerspective
        camera.position.fromArray(state.camera.position)
        camera.quaternion.fromArray(state.camera.quaternion)
        camera.target.fromArray(state.camera.target)
        camera.setDirty({change: 'transform'})

        this.installLedger(state.undo)

        if (state.selection) {
            const object = this.viewer.object3dManager.getObject(state.selection)
            if (object) this.viewer.getPlugin(PickingPlugin)?.setSelectedObject(object)
        }
    }

    /** Puts the tree under the model root. Widgets, components and mixers come back with it. */
    private async attach(doc: EditorDocument) {
        const first = !doc.shownOnce
        doc.shownOnce = true
        // The project's own viewer settings are the ground a document is first shown on, the way they
        // are for a file load today. Later shows restore the document's captured state instead.
        if (first && this.session.defaultViewerSettings) await this.viewer.importConfig(this.session.defaultViewerSettings)

        const scene = this.viewer.scene
        const root = scene.modelRoot
        if (doc.rootMeta.gltfAsset) root.userData.gltfAsset = doc.rootMeta.gltfAsset
        if (doc.rootMeta.gltfExtras) root.userData.gltfExtras = doc.rootMeta.gltfExtras
        root.animations = doc.animations
        for (const node of doc.nodes) scene.addObject(node)
        this.current = doc

        if (first && doc.importedViewerConfig) await this.viewer.importConfig(doc.importedViewerConfig)
        // A document with no captured state starts with an empty ledger. Leaving the manager alone
        // would hand it the last document's commands, which hold objects that are no longer on screen.
        if (doc.state) this.apply(doc.state)
        else this.installLedger({stack: [], sp: -1})
        this.viewer.setDirty()
        if (first) await doc.settle()
    }

    /** The one undo manager, holding the ledger of the document on screen. */
    private installLedger(ledger: {stack: JSUndoManagerCommand[], sp: number}) {
        const undo = this.viewer.getPlugin(UndoManagerPlugin)?.undoManager
        if (!undo) return
        undo.stack = ledger.stack
        undo.sp = ledger.sp
    }

    /**
     * Takes the tree off the model root without freeing it. The three auto-dispose flags are off for
     * the length of it, so a detached document keeps its GPU memory and a switch back is instant.
     */
    private detach(doc: EditorDocument) {
        doc.holdAssetRefs()
        const root = this.viewer.scene.modelRoot
        const manager = this.viewer.object3dManager
        const keep = [manager.autoDisposeMaterials, manager.autoDisposeTextures, manager.autoDisposeGeometries]
        manager.autoDisposeMaterials = manager.autoDisposeTextures = manager.autoDisposeGeometries = false
        try {
            for (const node of doc.nodes) root.remove(node as any)
        } finally {
            manager.autoDisposeMaterials = keep[0]
            manager.autoDisposeTextures = keep[1]
            manager.autoDisposeGeometries = keep[2]
        }
        root.animations = []
        delete root.userData.gltfAsset
        delete root.userData.gltfExtras
        this.viewer.scene.setDirty({refreshScene: true})
    }

    /** Nothing may hold an object of the document that is leaving. */
    private clearHolders() {
        this.viewer.getPlugin(PickingPlugin)?.clearSelection()
        this.viewer.getPlugin(TransformControlsPlugin)?.transformControls?.detach()
    }

    /**
     * One set of listeners for every document. They ask the document on screen whether the update is
     * its own, which is where the scene's isExternal* rule and an asset's root path already live.
     */
    private installDirtyListeners() {
        const scene = this.viewer.scene
        const mark = (item: IObject3D | IMaterial | ITexture | IGeometry | undefined) => {
            const doc = this.current
            if (!doc || !item || doc.dirty || !doc.owns(item)) return
            doc.dirty = true
            if (doc instanceof SceneDocument) doc.recheckDirty()
        }
        scene.addEventListener('objectUpdate', ev => mark(ev.object))
        scene.addEventListener('materialUpdate', ev => mark(Array.isArray(ev.material) ? undefined : ev.material))
        scene.addEventListener('textureUpdate', ev => mark(ev.texture))
        scene.addEventListener('geometryUpdate', ev => mark(ev.geometry))
    }
}
