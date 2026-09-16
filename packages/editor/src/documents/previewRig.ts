import {DirectionalLight2, HemisphereLight2, IObject3D, ThreeViewer} from 'threepipe'

const previewEnvironment = 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr'

/**
 * The lights an asset document is looked at under. They belong to the preview, not to the file, so
 * they are excluded from every export.
 */
export function previewLights(): IObject3D[] {
    const lights = [
        new HemisphereLight2(0xffffff, 0x444444, 1) as unknown as IObject3D,
        new DirectionalLight2(0xffffff, 0.5) as unknown as IObject3D,
    ]
    for (const light of lights) light.userData.excludeFromExport = true
    return lights
}

/** The environment the preview lights sit in. It reaches the document through the viewport state. */
export async function setPreviewEnvironment(viewer: ThreeViewer) {
    await viewer.setEnvironmentMap(previewEnvironment).catch(e => {
        console.error('Unable to load the preview environment', e)
        return null
    })
}
