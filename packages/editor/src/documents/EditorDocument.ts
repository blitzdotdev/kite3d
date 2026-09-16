import {
    AnimationClip,
    EventDispatcher,
    IGeometry,
    IMaterial,
    ImportResult,
    ImportResultExtras,
    IObject3D,
    ISerializedViewerConfig,
    ITexture,
    ThreeViewer
} from 'threepipe'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {Viewport, ViewportState} from './Viewport.ts'
import type {AssetRegistryItem} from '../utils/AssetTracker.ts'
import {traverseTpAsset} from '../utils/assetTrackerUtils.ts'
import {EditModePlugin} from '../utils/EditModePlugin.ts'
import {ask} from '../utils/AskDialog.tsx'

export type DocumentKind = 'scene' | 'object' | 'material' | 'texture'

/** What a save answers. `warn` is a save that did not happen and is not an error, a conflict the user resolved. */
export interface SaveResult {
    error: string | null
    warn?: string
}

/**
 * One open file. It owns its root nodes, its view state and its dirty flag, and it stays in memory
 * until it is closed. Only the active document sits under the viewer's model root.
 */
export abstract class EditorDocument extends EventDispatcher<{change: object}> {
    /** The file's root nodes, attached directly under `modelRoot` while this document is active. */
    nodes: IObject3D[] = []
    /** The file's animations. The viewport hands them to the model root while this document is active. */
    animations: AnimationClip[] = []
    /** The WEBGI_viewer extension the file carried. The first show applies it. */
    importedViewerConfig?: ISerializedViewerConfig
    /** Camera, selection, scene settings and undo ledger, captured on detach and applied on attach. */
    state?: ViewportState
    /** The key the import registered this file under in the asset registry. The close removes it. */
    rootPath: string | null = null
    /** The glTF asset and extras blocks the file carried. The viewport puts them on the model root. */
    rootMeta: {gltfAsset?: any, gltfExtras?: any} = {}
    /** False until the viewport has shown this document once. */
    shownOnce = false

    protected constructor(
        readonly path: string,
        readonly kind: DocumentKind,
        readonly session: ViewerInstanceManager,
        readonly viewport: Viewport,
    ) {
        super()
    }

    /** The tab label. */
    get name() {
        return this.path.split('/').pop() || this.path
    }

    /** The file's own object. A scene has none: it is the whole model root. */
    get asset(): IObject3D | IMaterial | ITexture | null {
        return null
    }

    private _dirty = false

    /**
     * Play borrows the main scene, reloads a snapshot into it and puts the scene back at Stop. Those
     * loads are not the user's edits, so nothing is dirty while a game runs.
     */
    get dirty() {
        if (this.session.playMode.isRunningMode) return false
        return this._dirty
    }
    set dirty(v: boolean) {
        if (this.session.playMode.isRunningMode) return
        if (this._dirty === v) return
        this._dirty = v
        this.dispatchEvent({type: 'change'})
    }

    protected get viewer(): ThreeViewer {
        return this.session.get()
    }

    /** Disk to memory. No viewer involved: the nodes come out detached. */
    abstract load(): Promise<void>

    /** Memory to disk, through the handle with the base sha. A 412 asks. */
    abstract save(): Promise<SaveResult>

    /** True when this update belongs to the file, so it makes the document dirty. */
    abstract owns(item: IObject3D | IMaterial | ITexture | IGeometry): boolean

    /** Runs with the document on the viewport, right after it came from disk. */
    abstract settle(): Promise<void>

    /** The file changed on disk. A clean document takes the disk copy, a dirty one asks first. */
    async reloadFromDisk(): Promise<void> {
        if (!await this.confirmDiscard()) return
        await this.reload()
    }

    /**
     * Takes the copy on disk. Unsaved edits are lost, so the caller has already asked. The unload
     * makes the next show a first show, so the attach settles the new tree; a document that is not
     * showing settles when it comes back.
     */
    async reload(): Promise<void> {
        await this.viewport.reload(this, () => this.load())
        this.dirty = false                  // the tree came from disk, so there is nothing to save
    }

    /** True when the editor copy may be thrown away. A clean document takes the disk copy silently. */
    protected async confirmDiscard(): Promise<boolean> {
        if (!this.dirty) return true
        return await ask('Changed on disk', `${this.path} changed on disk. Reload it and discard the editor copy?`, [
            {label: 'Keep editing', value: false},
            {label: 'Reload', value: true, intent: 'danger'},
        ])
    }

    /**
     * Frees the tree and its GPU memory. A close calls it, and so does a reload, which must free the
     * old tree before it reads the new one. The plan named close alone; the reload is the deviation.
     */
    unload() {
        const tracker = this.viewer.assetManager.tracker
        // The registry entry this file was imported under, read before the release drops it.
        const own = this.rootPath ? tracker.registry[this.rootPath] : undefined
        const shared = own?.object
        this.releaseAssetRefs()
        // Another open document may place this file; the entry belongs to the last holder.
        if (this.rootPath && own && !own.refs.size) tracker.removeFromRegistry(this.rootPath)
        // removeFromRegistry disposed the registry's own object already.
        for (const node of this.nodes) if (node !== shared) node.dispose?.(true)
        this.nodes = []
        this.animations = []
        this.state = undefined
        this.shownOnce = false
        this.rootPath = null
    }

    private heldRefs = new Set<string>()

    /**
     * The registry drops an entry when its last reference goes, and a detach unregisters every node.
     * A resident document holds one reference per placed asset instead, so the entry stays and a
     * re-attach never re-imports.
     */
    holdAssetRefs() {
        const placed = this.placedAssetPaths()
        // An asset whose last instance the user deleted is no longer placed, so the hold goes with it.
        for (const path of this.heldRefs) if (!placed.has(path)) this.release(path)
        const tracker = this.viewer.assetManager.tracker
        for (const path of placed) {
            if (this.heldRefs.has(path)) continue
            const asset: AssetRegistryItem | undefined = tracker.registry[path]
            if (!asset) continue
            asset.refs.add(this)
            this.heldRefs.add(path)
        }
    }

    private releaseAssetRefs() {
        for (const path of [...this.heldRefs]) this.release(path)
    }

    private release(path: string) {
        this.heldRefs.delete(path)
        const tracker = this.viewer.assetManager.tracker
        const asset: AssetRegistryItem | undefined = tracker.registry[path]
        if (!asset) return
        asset.refs.delete(this)
        if (!asset.refs.size) tracker.removeFromRegistry(path)
    }

    /** Every registry key this document's tree places, the same keys the tracker adds references under. */
    private placedAssetPaths(): Set<string> {
        const paths = new Set<string>()
        const add = (item: {userData?: Record<string, any>}) => {
            const path = item.userData?.rootPath
            if (typeof path === 'string') paths.add(path)
        }
        const objects: IObject3D[] = []
        for (const node of this.nodes) node.traverse(object => objects.push(object as IObject3D))
        traverseTpAsset(objects, add, add, add, add)
        return paths
    }

    /** The import result's own key, the one the asset tracker registered it under. */
    protected takeRootPath(res: ImportResult, fallback: string | null = null) {
        this.rootPath = (res as ImportResultExtras).__rootPath ?? fallback
    }

    /**
     * The asset file as the registry holds it. One import is shared with every instance that places
     * it, so a scene that already placed this asset hands over the copy it has.
     */
    protected async importAsset(): Promise<ImportResult> {
        const project = this.session.loadedProject
        if (!project) throw new Error('No project loaded, cannot open ' + this.path)
        const saved = await this.session.getLoadedFile(project, this.path)
        if (!saved) throw new Error('File not found: ' + this.path)
        const rootPath = await this.session.toAssetIdPath({path: this.path})
        const editMode = this.viewer.getPlugin(EditModePlugin)
        editMode?.disable('loadImport')
        try {
            const res = await this.viewer.assetManager.tracker
                .refreshFromRegistry(rootPath, {importedFile: saved.file}).pms
            if (!res) throw new Error('Failed to load file ' + this.path)
            if (res._loadingPromise) await res._loadingPromise
            this.takeRootPath(res, rootPath)
            return res
        } finally {
            editMode?.enable('loadImport')
        }
    }
}
