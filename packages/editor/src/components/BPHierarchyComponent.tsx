import {
    Event2,
    IMaterial,
    IObject3D,
    ISceneEventMap,
    ObjectPickerEventMap,
    PickingPlugin,
    RootScene,
    ThreeViewer
} from "threepipe";
import {bpUiConfigIcons, UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {VisibilityIcon} from "./VisibilityIcon";
import React from "react";
import {canMakeAsset, isExternalObject} from "../utils/projectUtils.ts";
import {HandleContextMenuCallback, MenuItem2} from "../utils/ContextMenuUtils.ts";
import {Icon, IconName, Intent} from "@blueprintjs/core";
import {hasObjectReferences, ObjectReference, objectReferences} from "../utils/three/objectReferences.ts";
import {SceneResource, selectResource} from "../utils/three/selectResource.ts";
import {resourceReveal} from "../utils/resourceReveal.ts";
import {componentIcon, geometryIcon, iconForMaterial, textureIcon} from "../utils/icons.tsx";
import {BPTreeComponent, BPTreeComponentState} from "./BPTreeComponent.tsx";
import {TreeNodeInfo} from "./treeTypes.ts";
import {canDropNode, CanvasFileDropHandler, isDraggableDroppableNode} from "../utils/CanvasFileDropHandler.tsx";
import {uiConfigToMenuItem} from "../utils/ContextMenuUtils.ts";
import {EditModePlugin} from "../utils/EditModePlugin.ts";

interface BPHierarchyComponentPropsExtras extends HandleContextMenuCallback<IObject3D>{
    /**
     * The document path a row's object opens as, or null for a row with no file of its own. A row
     * that answers a path gets "Open in New Tab" on its menu.
     */
    documentPath?: (object: IObject3D) => string | null
}

const referenceKindIcons: Record<Exclude<ObjectReference['kind'], 'material'>, IconName> = {
    geometry: geometryIcon,
    texture: textureIcon,
    component: componentIcon,
}

/**
 * A reference row wears the icon of what it points at, with a link glyph in front of it. The kind
 * is never spelled out: the icon says it, and the tooltip on the label says the slot.
 */
function referenceIcon(reference: ObjectReference) {
    const kindIcon = reference.kind === 'material'
        ? iconForMaterial(reference.resource as IMaterial) ?? 'style'
        : referenceKindIcons[reference.kind]
    return <span className={'tree-node-reference-icon'}>
        <Icon icon={'link'} size={10}/>
        {typeof kindIcon === 'string' ? <Icon icon={kindIcon} size={14}/> : kindIcon}
    </span>
}
export class BPHierarchyComponent<T extends IObject3D = IObject3D> extends BPTreeComponent<T, IObject3D, BPHierarchyComponentPropsExtras> {
    declare context: UiConfigRendererContextType&{viewer: ThreeViewer}

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            secondaryLabel: (<VisibilityIcon obj={obj}/>),
            draggable: true,
            droppable: true,
        })
    }

    protected _getNodeId(obj: T) {
        return obj.uuid;
    }

    protected _updateNodeInfo(node: TreeNodeInfo<T>, obj: T) {
        node.label = obj.name ? obj.name : obj.type ? `(${obj.type})` : 'unnamed';
        const children: TreeNodeInfo<T>[] = []
        if(!obj.isMesh && !obj.isLine && !obj.isPoints && !obj.isScene && !obj.isCamera && !obj.isLight)
            // todo _sChildren
            children.push(...((obj.children as T[]) || []).reduce<any[]>((...args) => this.buildData(...args), []))
        // What the object points at goes under its real children, and only while the row is open:
        // a closed row builds nothing. Every tree refresh rebuilds these rows with the rest.
        if(node.isExpanded) children.push(...objectReferences(obj).map(r => this._referenceNode(r)))
        node.childNodes = children
        node.isSelected = this._selectedId === node.id
        // A preview light belongs to the document view, not to the file, so its row is dimmed.
        node.className = obj.userData?.excludeFromExport ? 'tree-node-excluded' : undefined

        // node.hasCaret = (node.childNodes?.length||0) > 0
        node.icon = undefined
        if(obj.isLight){
            if((obj as any).isAmbientLight) {
                node.icon = bpUiConfigIcons['shape-diamond-filled-mono-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                // node.icon = 'flash';
            }else if((obj as any).isPointLight) {
                // node.icon = bpUiConfigIcons['shape-diamond-filled-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                // node.icon = bpUiConfigIcons['shape-diamond-filled-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                node.icon = 'flash';
            }else if((obj as any).isDirectionalLight) {
                node.icon = 'torch';
            }else if((obj as any).isSpotLight) {
                node.icon = bpUiConfigIcons['shape-cone-filled-2']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
            }else if((obj as any).isRectAreaLight) {
                node.icon = 'rectangle';
            }else if((obj as any).isHemisphereLight){
                node.icon = bpUiConfigIcons['shape-sphere-cut-filled-1']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
            }
        }
        if(obj.isMesh){
            node.icon = bpUiConfigIcons['shape-cube-transparent-filled-mono']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
        }
        if(obj.isCamera){
            node.icon = /*(obj as any).isPerspectiveCamera ?
                bpUiConfigIcons['shape-trapezium-filled-mono-2']({style: {color: 'transparent'}}) :
                (obj as any).isOrthographicCamera ?
                    bpUiConfigIcons['shape-cuboid-filled-mono-1']({style: {color: 'transparent'}}) :*/
                'camera'
        }
        if(obj.isLine){
            node.icon = 'flows'
        }
        if(obj.isScene){
            node.icon = 'cubes'
        }
        // node.icon = 'layer-outline'

        if((obj as any as RootScene).isRootScene){
            node.icon = 'layers'
            node.label = 'Scene'
            node.intent = 'none'
            node.hasCaret = false
            node.droppable = false
            node.draggable = false
        }else {
            const {isComponent, isExternal, draggable, droppable} = isDraggableDroppableNode(obj)
            node.droppable = droppable
            node.draggable = draggable
            node.intent = isComponent ? Intent.WARNING : isExternal ? Intent.PRIMARY : Intent.NONE
            node.hasCaret = !node.icon || hasObjectReferences(obj)
        }

        return node;
    }

    protected _getRootNodes(): T[] {
        const root = this.context.viewer.scene.modelRoot
        const scene = this.context.viewer.scene
        const camera = this.context.viewer.scene.defaultCamera
        return [scene, camera, ...root.children] as T[]
        // return getValue(this.props.config)
        // return (this.props.config.children || []).map(c => getOrCall(c) || {}).flat(2)
    }

    /**
     * The reference rows on the tree right now, by row id. A row that is not built is not here.
     * The base class builds the first state from its constructor, before a field of this class is
     * set, so every reader creates it if it has to, the way the base class does with its own map.
     */
    private _refRows!: Map<string | number, ObjectReference>

    /**
     * Turns one reference into a row. The row keeps its own open state across refreshes, the way an
     * object row does, because the same node object is updated in place.
     */
    private _referenceNode(reference: ObjectReference): TreeNodeInfo<T> {
        if (!this._refRows) this._refRows = new Map()
        const node: TreeNodeInfo<T> = this._infoMap.get(reference.id) ?? {
            id: reference.id,
            label: '',
            childNodes: [],
            isExpanded: false,
            isSelected: false,
        }
        node.label = <span className={'tree-node-reference-label'} title={reference.tooltip}>{reference.name}</span>
        node.icon = referenceIcon(reference)
        node.className = 'tree-node-reference'
        node.intent = Intent.NONE
        node.isSelected = false // the row is a pointer; the resource highlights in the Resources tab
        node.draggable = false  // a reference cannot be moved, only followed
        node.droppable = false
        node.secondaryLabel = undefined
        node.hasCaret = !!reference.children?.length
        node.childNodes = node.isExpanded ? (reference.children ?? []).map(c => this._referenceNode(c)) : []
        this._infoMap.set(reference.id, node)
        this._refRows.set(reference.id, reference)
        this.nSet?.add(reference.id)
        return node
    }

    /** A reference row puts its resource in the Inspector, the same as the Resources tab does. */
    private _selectReference(reference: ObjectReference) {
        if(reference.kind === 'component') {
            // A component has no row of its own anywhere else: the Inspector shows it under its object.
            const owner = reference.owner
            owner.dispatchEvent({type: 'select', value: owner, object: owner, ui: true, bubbleToParent: true})
            return
        }
        const resource = reference.resource as SceneResource
        selectResource(this.context.viewer, resource, resource)
    }

    protected async _onNodeExpandCollapse(_id: string | number, expanded?: boolean) {
        await super._onNodeExpandCollapse(_id, expanded)
        const node = this._infoMap.get(_id)
        if(!node?.isExpanded) return
        // Opening a row is what builds the reference rows under it.
        const reference = this._refRows?.get(_id)
        const references = reference ? reference.children : node.nodeData ? objectReferences(node.nodeData) : undefined
        if(!references?.length) return
        const realChildren = (node.childNodes ?? []).filter(c => !this._refRows?.has(c.id))
        node.childNodes = [...realChildren, ...references.map(r => this._referenceNode(r))]
        await this.setStatePromise({...this.state, nodes: this._cloneNodes()})
    }

    getUpdatedState(_state: BPTreeComponentState<T>): BPTreeComponentState<T> {
        if (!this._refRows) this._refRows = new Map()
        const state = super.getUpdatedState(_state)
        // A row the rebuild did not keep is off the tree, so its reference goes with it.
        for (const id of [...this._refRows.keys()]) if (!this._infoMap.has(id)) this._refRows.delete(id)
        return state
    }

    protected async _onNodeClick(_id: string) {
        const reference = this._refRows?.get(_id)
        if(reference) return this._selectReference(reference)
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        node.nodeData!.dispatchEvent({type: 'select', value: value ?? null, object: node.nodeData!, ui: true, bubbleToParent: true})
    }

    protected async _onNodeDoubleClick(_id: string) {
        const reference = this._refRows?.get(_id)
        if(reference) {
            this._selectReference(reference)
            // The second click follows the pointer: the Resources tab opens on that row.
            if(reference.kind !== 'component')
                resourceReveal.reveal({kind: reference.kind, uuid: reference.resource.uuid})
            return
        }
        const node = this._infoMap.get(_id)
        if(!node) return
        const obj = node.nodeData!
        const isScene = obj === this.context.viewer.scene as any
        obj.dispatchEvent({
            type: 'select',
            value: obj,
            object: obj,
            ui: true,
            focusCamera: !isScene,
            bubbleToParent: true,
        })
        if(isScene){
            this.context.viewer.getPlugin(PickingPlugin)?.focusObject(this.context.viewer.scene.modelRoot)
        }
    }

    protected async _onNodeContextMenu(_id:string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>){
        // console.log(_id, _e)
        _e.preventDefault()
        _e.stopPropagation()

        // A reference row has no menu: nothing under it can be renamed, reordered or deleted.
        if(this._refRows?.has(_id)) return this._onNodeClick(_id as string)

        const items: MenuItem2[] = []
        const node = this._infoMap.get(_id)
        if(!node) return
        const obj = node.nodeData!

        // A row that came from a file opens that file as a tab, the way the Files panel does.
        const path = this.props.documentPath?.(obj)
        if (path) {
            items.push({
                props: {text: 'Open in New Tab'},
                key: 'openInNewTab',
                action: 'openDocument',
                data: {path},
            })
        }

        const editMode = this.context.viewer.getPlugin(EditModePlugin)
        const selected = this.context.viewer.getPlugin(PickingPlugin)?.getSelectedObjects<IObject3D>() ?? []
        // Isolating a node that is not in the selection isolates that node alone.
        const isolateObjects = selected.includes(obj) ? [...selected] : [obj]
        if (editMode?.isIsolated || editMode?.canIsolate(isolateObjects)) {
            items.push({
                props: {text: editMode?.isIsolated ? 'Exit Isolate' : 'Isolate'},
                key: 'isolate',
                action: () => editMode?.toggleIsolate(isolateObjects),
            })
        }

        // todo disable only editable options for external objects(using some uiconfig tags.), right now its all.
        const isExternal = isExternalObject(obj)

        if(!isExternal) {

            if (canMakeAsset(obj)) {
                items.push({
                    props: {
                        text: 'Make Asset',
                    },
                    key: 'makeAsset',
                    action: 'makeAsset',
                    data: {obj}
                })
            }

            items.push({
                props: {
                    text: 'Move Up',
                },
                key: 'moveUp',
                action: 'moveInParent',
                data: {obj, delta: -1}
            }, {
                props: {
                    text: 'Move Down',
                },
                key: 'moveDown',
                action: 'moveInParent',
                data: {obj, delta: 1}
            })

            // todo use uiconfig methods to find buttons
            obj.uiConfig?.children
                ?.filter(c => typeof c === 'object' && c.tags?.includes('context-menu'))
                .map(btn => uiConfigToMenuItem(btn, this.context))
                .forEach(menuItem => {
                    if (menuItem) items.push(menuItem)
                })

        }

        this.props.handleContextMenu?.(_e, items, obj)

        return this._onNodeClick(_id as string) // select on right click
    }

    protected _canDropNode(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], targetNode: TreeNodeInfo<T>, _targetPath: number[], index?: number) {
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if (!target || !source) return false
        if (sourceNode.id === targetNode.id) return false

        // const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        return canDropNode(source, target, index) ?? false
    }

    protected _onDropNode(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], targetNode: TreeNodeInfo<T>, _targetPath: number[], _e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData || !sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if(source === target || sourceNode.id === targetNode.id) return // same object
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.setDraggedItem(source)
        drop?.setDropTarget(target, true, {index})
        return
    }

    protected _onNodeDragStart(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], e?: React.DragEvent) {
        if(!sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.setDraggedItem(source)

        if(e) {
            try {
                e.dataTransfer.clearData();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/json', JSON.stringify({uuid: source.uuid, name: source.name})); // todo put the json of obj or file blob here
            } catch {
                // ignore
            }
        }
        return
    }

    protected _onNodeDragEnd(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], e?: React.DragEvent) {
        if(!sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.clearDraggedItem(false, source)
        e?.dataTransfer.clearData();
        return
    }

    protected _onNodeDragOver(targetNode: TreeNodeInfo<T>, _targetPath: number[], e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData) return
        const target = targetNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.setDropTarget(target, false, {index})
        e?.dataTransfer.clearData();
        return
    }

    protected _onNodeDragLeave(targetNode: TreeNodeInfo<T>, _targetPath: number[], e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData) return
        const target = targetNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        if(target === drop?.dropTarget)
            drop?.setDropTarget(null, false, {index})
        e?.dataTransfer.clearData();
        return
    }

    // refreshSelected(){
    //     if(!this.context.viewer) this.setSelected(undefined)
    //     this.context.viewer?.doOnce('postFrame', () => {
    //         const selected = this.context.viewer?.getPlugin(PickingPlugin)?.getSelectedObject()
    //         // source?.dispatchEvent({type: 'select', value: source, object: source, ui: true})
    //         this.setSelected(selected?.uuid, true)
    //     })
    // }

    // getUpdatedState(_state: BPTreeComponentState<T>): BPTreeComponentState<T> {
    //     console.log('update', _state)
    //     return super.getUpdatedState(_state);
    // }

    private _selectedId: string|undefined = undefined
    private selectedObjectChanged = (e: ObjectPickerEventMap['selectedObjectChanged']) => {
        this._selectedId = e.object?.uuid
        this.setSelected(this._selectedId, true)
        // this.props.config.uiRefresh?.(true, 'postFrame')
        // this.refreshSelected()
    }
    private sceneUpdate = (e: any) => {
        if (e.hierarchyChanged) {
            this.props.config.uiRefresh?.(true, 'postFrame')
            // @ts-ignore
            // hierarchyConfig.children![0]!.uiRefresh?.()
        }
    }
    private objectUpdate = (e: Event2<'objectUpdate', ISceneEventMap, IObject3D>) => {
        // private objectUpdate = (e: any) => {
        if (e.refreshUi !== false && (e.change === 'name' || e.key === 'name' || e.change === 'indexInParent')) {
            this.props.config.uiRefresh?.(true, 'postFrame')
            // @ts-ignore
            // hierarchyConfig.children![0]!.uiRefresh?.()
        }
    }

    componentDidMount() {
        super.componentDidMount();
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPHierarchyComponent: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.addEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.addEventListener('sceneUpdate', this.sceneUpdate) // todo: subscribe only to the object in the config instead of the whole scene
        viewer.scene.addEventListener('objectUpdate', this.objectUpdate) // todo: subscribe only to the object in the config instead of the whole scene
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPHierarchyComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        viewer.scene.removeEventListener('objectUpdate', this.objectUpdate)
        super.componentWillUnmount();
    }

}
