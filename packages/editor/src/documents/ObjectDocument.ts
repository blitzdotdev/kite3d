import {IGeometry, IMaterial, IObject3D, ITexture} from 'threepipe'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {Viewport} from './Viewport.ts'
import {EditorDocument, SaveResult} from './EditorDocument.ts'
import {EditModePlugin} from '../utils/EditModePlugin.ts'
import {previewLights, setPreviewEnvironment} from './previewRig.ts'

/** A `.glb`, `.asset.glb` or non-scene `.gltf` file: one asset, alone, under the preview lights. */
export class ObjectDocument extends EditorDocument {
    object!: IObject3D

    constructor(path: string, session: ViewerInstanceManager, viewport: Viewport) {
        super(path, 'object', session, viewport)
    }

    async load() {
        const res = await this.importAsset()
        if (!(res as IObject3D).isObject3D) throw new Error('Not a 3D object: ' + this.path)
        this.object = res as IObject3D
        this.nodes = [this.object, ...previewLights()]
    }

    get asset() {
        return this.object
    }

    async settle() {
        await setPreviewEnvironment(this.viewer)
        this.viewer.getPlugin(EditModePlugin)?.resetView()
        this.dirty = false
    }

    owns(item: IObject3D | IMaterial | ITexture | IGeometry) {
        return (item as {_tpRootPath?: string})._tpRootPath === this.rootPath
    }

    save(): Promise<SaveResult> {
        // No scene goes with it: the asset is the document, it is not placed in a scene here.
        return this.session.saveProjectAsset(this.session.loadedProject!, null, this.object, this.path)
    }
}
