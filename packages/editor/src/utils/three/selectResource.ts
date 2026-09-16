import {IGeometry, IMaterial, ITexture, PickingPlugin, ThreeViewer} from "threepipe";

export type SceneResource = IMaterial | ITexture | IGeometry

/**
 * Puts a material, texture or geometry in the Inspector. A material carries its own select event so
 * the object holding it highlights too; the other two go straight to the picker. The Resources tab
 * and the reference rows under a mesh both call this, so one click means one thing everywhere.
 *
 * @param resource the row that was clicked, which is the event target for a material
 * @param value what to select, which is null when a click clears the row it is on
 */
export function selectResource(viewer: ThreeViewer, resource: SceneResource, value: SceneResource | null) {
    const material = resource as IMaterial
    if (material.isMaterial) {
        material.dispatchEvent({
            type: 'select', value: value ?? null, material,
            ui: true, bubbleToObject: true, bubbleToParent: true,
        } as any)
        return
    }
    viewer.getPlugin(PickingPlugin)?.setSelectedObject(value as any ?? undefined)
}
