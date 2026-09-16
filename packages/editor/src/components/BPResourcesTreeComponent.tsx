import React, {useCallback, useEffect, useRef, useState} from "react";
import {Icon, Tag} from "@blueprintjs/core";
import {ThreeViewer} from "threepipe";
import {BPMaterialsTreeComponent, MaterialHierarchyComponent} from "./BPMaterialsTreeComponent.tsx";
import {BPTexturesTreeComponent, TextureHierarchyComponent} from "./BPTexturesTreeComponent.tsx";
import {BPGeometriesTreeComponent, GeometryHierarchyComponent} from "./BPGeometriesTreeComponent.tsx";
import {sceneGeometries, sceneMaterials, sceneTextures} from "../utils/three/sceneResources.ts";
import {ResourceKind, resourceReveal, ResourceRevealRequest} from "../utils/resourceReveal.ts";
import {useManager} from "../utils/UseManager.ts";

export type ResourceSectionCounts = Record<ResourceKind, number>

/** The sections, in the order they are drawn. The title and the kind are the whole model. */
export const resourceSections: {kind: ResourceKind, title: string}[] = [
    {kind: 'material', title: 'Materials'},
    {kind: 'texture', title: 'Textures'},
    {kind: 'geometry', title: 'Geometries'},
]

/** What each badge says. The lists under the badges come from the same three calls. */
export function resourceSectionCounts(viewer: ThreeViewer): ResourceSectionCounts {
    return {
        material: sceneMaterials(viewer).length,
        texture: sceneTextures(viewer).length,
        geometry: sceneGeometries(viewer).length,
    }
}

export type ResourceSectionsOpen = Record<ResourceKind, boolean>

const openSectionsKey = 'kite3dResourcesSectionsOpen'
const allOpen: ResourceSectionsOpen = {material: true, texture: true, geometry: true}

export function rememberedSections(): ResourceSectionsOpen {
    try {
        const read = JSON.parse(localStorage.getItem(openSectionsKey) || 'null')
        if (read && typeof read === 'object') return {...allOpen, ...read}
    } catch {
        // localStorage outlives the build that wrote it, and a key this build cannot read must not
        // stop the panel from drawing. The sections open instead.
    }
    return allOpen
}

function rememberSections(open: ResourceSectionsOpen) {
    try {
        localStorage.setItem(openSectionsKey, JSON.stringify(open))
    } catch {
        // A browser with storage turned off still gets a working panel, it just forgets.
    }
}

/**
 * The Resources tab: one list of what the current document holds, in three sections that each hold
 * the tree that tab used to be. Selection, the Inspector, drag and the context menus are the trees'
 * own, unchanged. A double click on a reference row in the Objects tree lands here, on that row.
 */
export function ResourcesHierarchyComponent({className}: {className: string}) {
    const manager = useManager()
    const viewer = manager.get()

    const [open, setOpen] = useState<ResourceSectionsOpen>(rememberedSections)
    const [counts, setCounts] = useState<ResourceSectionCounts>(() => resourceSectionCounts(viewer))

    const trees = {
        material: useRef<BPMaterialsTreeComponent>(null),
        texture: useRef<BPTexturesTreeComponent>(null),
        geometry: useRef<BPGeometriesTreeComponent>(null),
    }

    const toggle = useCallback((kind: ResourceKind) => {
        setOpen(prev => {
            const next = {...prev, [kind]: !prev[kind]}
            rememberSections(next)
            return next
        })
    }, [])

    // The badges follow the same events the three trees refresh on, so a count cannot disagree with
    // the list under it. Several events land on one frame, so the recount waits for the frame.
    useEffect(() => {
        let queued = 0
        const recount = () => {
            if (queued) return
            queued = requestAnimationFrame(() => {
                queued = 0
                setCounts(resourceSectionCounts(viewer))
            })
        }
        const scene = viewer.scene
        scene.addEventListener('sceneUpdate', recount)
        scene.addEventListener('materialUpdate', recount)
        scene.addEventListener('geometryUpdate', recount)
        scene.addEventListener('textureUpdate', recount)
        scene.addEventListener('texturesChanged', recount)
        recount()
        return () => {
            if (queued) cancelAnimationFrame(queued)
            scene.removeEventListener('sceneUpdate', recount)
            scene.removeEventListener('materialUpdate', recount)
            scene.removeEventListener('geometryUpdate', recount)
            scene.removeEventListener('textureUpdate', recount)
            scene.removeEventListener('texturesChanged', recount)
        }
    }, [viewer])

    // A reveal arrives from a reference row in the Objects tree. This tab is not mounted while that
    // tab is showing, so the request is also waiting when it mounts.
    useEffect(() => {
        const scrollWhenReady = (request: ResourceRevealRequest, tries: number) => {
            if (trees[request.kind].current?.scrollToNode(request.uuid)) return
            if (tries > 0) requestAnimationFrame(() => scrollWhenReady(request, tries - 1))
        }
        const apply = (request: ResourceRevealRequest) => {
            setOpen(prev => {
                if (prev[request.kind]) return prev
                const next = {...prev, [request.kind]: true}
                rememberSections(next)
                return next
            })
            // The section may be opening this frame, so the scroll waits for the row to exist.
            requestAnimationFrame(() => scrollWhenReady(request, 30))
        }
        const pending = resourceReveal.take()
        if (pending) apply(pending)
        const listener = (e: ResourceRevealRequest) => apply({kind: e.kind, uuid: e.uuid})
        resourceReveal.addEventListener('reveal', listener)
        return () => resourceReveal.removeEventListener('reveal', listener)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const body = (kind: ResourceKind) => {
        if (kind === 'material') return <MaterialHierarchyComponent className={''} treeRef={trees.material}/>
        if (kind === 'texture') return <TextureHierarchyComponent className={''} treeRef={trees.texture}/>
        return <GeometryHierarchyComponent className={''} treeRef={trees.geometry}/>
    }

    return <div className={'resources-panel ' + (className || '')}>
        {resourceSections.map(section => <div key={section.kind} className={'resources-section'}>
            <div
                className={'resources-section-header'}
                role={'button'}
                tabIndex={0}
                onClick={() => toggle(section.kind)}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') toggle(section.kind)
                }}
            >
                <Icon icon={open[section.kind] ? 'chevron-down' : 'chevron-right'} size={12}/>
                <span className={'resources-section-title'}>{section.title}</span>
                <Tag minimal={true} round={true} className={'resources-section-count'}>{counts[section.kind]}</Tag>
            </div>
            {open[section.kind] && <div className={'resources-section-body'}>{body(section.kind)}</div>}
        </div>)}
    </div>
}
