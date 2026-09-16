import {IGeometry, IMaterial, ITexture, ThreeViewer} from "threepipe";
import {filterObjectsInSceneRoot} from "./filterObjectsInSceneRoot.ts";

/**
 * What the current document holds. The Resources tab lists these and counts them, and each of the
 * three trees builds its rows from the same call, so a badge can never disagree with its list.
 */
export function sceneMaterials(viewer: ThreeViewer): IMaterial[] {
    return Array.from(filterObjectsInSceneRoot(viewer.object3dManager.getMaterials()))
}

export function sceneTextures(viewer: ThreeViewer): ITexture[] {
    return viewer.object3dManager.getTextures()
}

export function sceneGeometries(viewer: ThreeViewer): IGeometry[] {
    return Array.from(filterObjectsInSceneRoot(viewer.object3dManager.getGeometries()))
}
