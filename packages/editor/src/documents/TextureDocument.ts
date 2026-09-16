import {IGeometry, IMaterial, IObject3D, ITexture, Mesh2, PlaneGeometry, UnlitMaterial} from 'threepipe'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {Viewport} from './Viewport.ts'
import {EditorDocument, SaveResult} from './EditorDocument.ts'
import {EditModePlugin} from '../utils/EditModePlugin.ts'

/** An image file: the texture on a plane, read flat. View only. */
export class TextureDocument extends EditorDocument {
    texture!: ITexture

    constructor(path: string, session: ViewerInstanceManager, viewport: Viewport) {
        super(path, 'texture', session, viewport)
    }

    async load() {
        const res = await this.importAsset()
        if (!(res as ITexture).isTexture) throw new Error('Not a texture: ' + this.path)
        this.texture = res as ITexture
        const plane = new Mesh2(new PlaneGeometry(1, 1) as any, new UnlitMaterial({map: this.texture}) as any) as unknown as IObject3D
        plane.userData.excludeFromExport = true     // the preview, not the file
        this.nodes = [plane]
    }

    get asset() {
        return this.texture
    }

    async settle() {
        this.viewer.getPlugin(EditModePlugin)?.resetView()
        this.dirty = false
    }

    owns(item: IObject3D | IMaterial | ITexture | IGeometry) {
        return item === this.texture
    }

    async save(): Promise<SaveResult> {
        return {error: 'Texture Save not implemented yet.'}
    }
}
