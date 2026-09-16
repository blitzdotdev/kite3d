import {
    EntityComponentPlugin,
    IGeometry,
    iMaterialCommons,
    IMaterial,
    IObject3D,
    ITexture,
    Object3DComponent,
} from "threepipe";

export type ObjectReferenceKind = 'geometry' | 'material' | 'texture' | 'component'

export interface ObjectReference {
    /** Unique per row. A material used by two objects gets one row under each of them. */
    id: string
    kind: ObjectReferenceKind
    /** What the row points at. A shared resource is the same instance under every object using it. */
    resource: IMaterial | ITexture | IGeometry | Object3DComponent
    /** The object the row hangs under, which is what a component row selects. */
    owner: IObject3D
    /** The row's only text. The kind is the icon, never a word. */
    name: string
    /** The row's tooltip. A texture names its slot here, which is the only place the slot shows. */
    tooltip: string
    /** A material's assigned texture slots. */
    children?: ObjectReference[]
}

/** The same label the Materials, Textures and Geometries trees give a resource. */
function resourceName(resource: {name?: string, type?: string | number}): string {
    return resource.name ? resource.name : resource.type ? `(${resource.type})` : 'unnamed'
}

/** The texture slots a material has something in, in the order the material declares them. */
export function materialTextureReferences(owner: IObject3D, prefix: string, material: IMaterial): ObjectReference[] {
    const maps: Map<string, ITexture> = iMaterialCommons.getMapsForMaterial.call(material)
    const rows: ObjectReference[] = []
    for (const [slot, texture] of maps) {
        if (!texture?.isTexture) continue
        rows.push({
            id: `${prefix}|${slot}|${texture.uuid}`,
            kind: 'texture',
            resource: texture,
            owner,
            name: resourceName(texture),
            tooltip: `${slot}: ${resourceName(texture)}`,
        })
    }
    return rows
}

/**
 * What an object points at: its geometry, each of its materials with that material's texture slots
 * under it, and each component the entity component plugin has on it. These are references, not
 * children: the same resource appears under every object that uses it, and nothing here can be
 * dragged, reordered or deleted.
 */
export function objectReferences(object: IObject3D): ObjectReference[] {
    const rows: ObjectReference[] = []

    const geometry = (object as {geometry?: IGeometry}).geometry
    if (geometry?.isBufferGeometry) rows.push({
        id: `${object.uuid}|geometry|${geometry.uuid}`,
        kind: 'geometry',
        resource: geometry,
        owner: object,
        name: resourceName(geometry),
        tooltip: `Geometry: ${resourceName(geometry)}`,
    })

    const material = (object as {material?: IMaterial | IMaterial[]}).material
    const materials = Array.isArray(material) ? material : material ? [material] : []
    materials.forEach((mat, i) => {
        if (!mat?.isMaterial) return
        // An array material names its index, because two rows would otherwise read the same.
        const slot = Array.isArray(material) ? `Material ${i}` : 'Material'
        const prefix = `${object.uuid}|material|${i}|${mat.uuid}`
        rows.push({
            id: prefix,
            kind: 'material',
            resource: mat,
            owner: object,
            name: resourceName(mat),
            tooltip: `${slot}: ${resourceName(mat)}`,
            children: materialTextureReferences(object, prefix, mat),
        })
    })

    for (const component of EntityComponentPlugin.ObjectToComponents.get(object) || []) {
        const type = component.constructor?.ComponentType || 'Component'
        rows.push({
            id: `${object.uuid}|component|${component.uuid}`,
            kind: 'component',
            resource: component,
            owner: object,
            name: type,
            tooltip: `Component: ${type}`,
        })
    }

    return rows
}

/** Whether a row needs a caret, answered without building the rows behind it. */
export function hasObjectReferences(object: IObject3D): boolean {
    if ((object as {geometry?: IGeometry}).geometry?.isBufferGeometry) return true
    const material = (object as {material?: IMaterial | IMaterial[]}).material
    if (Array.isArray(material) ? material.length > 0 : !!material) return true
    return (EntityComponentPlugin.ObjectToComponents.get(object)?.length ?? 0) > 0
}
