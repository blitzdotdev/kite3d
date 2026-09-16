import {BoxGeometry, IGeometry, IMaterial, IObject3D, ITexture, Mesh2} from 'threepipe'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {Viewport} from './Viewport.ts'
import {EditorDocument, SaveResult} from './EditorDocument.ts'
import {EditModePlugin} from '../utils/EditModePlugin.ts'
import {previewLights, setPreviewEnvironment} from './previewRig.ts'

/** A `.mat` file: the material on a box, under the preview lights. */
export class MaterialDocument extends EditorDocument {
    material!: IMaterial

    constructor(path: string, session: ViewerInstanceManager, viewport: Viewport) {
        super(path, 'material', session, viewport)
    }

    protected async read() {
        const res = await this.importAsset()
        if (!(res as IMaterial).isMaterial) throw new Error('Not a material: ' + this.path)
        this.material = res as IMaterial
        const box = new Mesh2(new BoxGeometry(1, 1, 1) as any, this.material) as unknown as IObject3D
        box.userData.excludeFromExport = true       // the preview, not the file
        this.nodes = [box, ...previewLights()]
    }

    get asset() {
        return this.material
    }

    async settle() {
        await setPreviewEnvironment(this.viewer)
        this.viewer.getPlugin(EditModePlugin)?.resetView()
        this.dirty = false
    }

    owns(item: IObject3D | IMaterial | ITexture | IGeometry) {
        return item === this.material
    }

    save(): Promise<SaveResult> {
        return this.session.saveProjectAsset(this.session.loadedProject!, null, this.material, this.path)
    }
}
