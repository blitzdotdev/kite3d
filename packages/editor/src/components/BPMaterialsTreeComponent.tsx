import {
    Event2,
    IGeometry,
    IMaterial,
    IObject3D,
    ISceneEventMap,
    PickingPlugin,
    ThreeViewer,
    UiObjectConfig
} from "threepipe";
import {UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {sceneMaterials} from "../utils/three/sceneResources.ts";
import {selectResource} from "../utils/three/selectResource.ts";
import {iconForMaterial} from "../utils/icons.tsx";
import React, {useMemo} from "react";
import {useObjContextMenu} from "./UseObjContextMenu.tsx";
import {HandleContextMenuCallback, MenuItem2} from "../utils/ContextMenuUtils.ts";
import {canMakeAsset} from "../utils/projectUtils.ts";
import {BPTreeComponent} from "./BPTreeComponent.tsx";
import {TreeNodeInfo} from "./treeTypes.ts";
import {useManager} from "../utils/UseManager.ts";
import {useMakeAsset} from "../utils/UseMakeAsset.ts";

interface BPMaterialsTreeComponentPropsExtras extends HandleContextMenuCallback<IMaterial>{

}
export class BPMaterialsTreeComponent<T extends IMaterial = IMaterial> extends BPTreeComponent<T, IObject3D, BPMaterialsTreeComponentPropsExtras> {
    declare context: UiConfigRendererContextType&{viewer: ThreeViewer}

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            // secondaryLabel: (<VisibilityIcon obj={obj}/>),
            draggable: false,
            droppable: false,
            hasCaret: false,
        } as Partial<TreeNodeInfo<T>>);
    }

    protected _getNodeId(obj: T) {
        return obj.uuid;
    }

    protected _updateNodeInfo(node: TreeNodeInfo<T>, obj: T) {
        node.label = obj.name ? obj.name : obj.type ? `(${obj.type})` : 'unnamed';
        // if(!obj.isMesh && !obj.isLine && !obj.isPoints && !obj.isScene && !obj.isCamera && !obj.isLight)
        //     node.childNodes = ((obj.children as T[]) || []).reduce<any[]>((...args) => this.buildData(...args), [])
        node.isSelected = this._selectedIds?.includes(node.id as string) ?? false
        node.icon = iconForMaterial(obj)
        return node;
    }

    protected _getRootNodes(): T[] {
        return sceneMaterials(this.context.viewer) as T[]
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        selectResource(this.context.viewer, node.nodeData!, value)
    }

    protected async _onNodeDoubleClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        // node.nodeData!.dispatchEvent({
        //     type: 'select',
        //     value: node.nodeData!,
        //     material: node.nodeData!,
        //     ui: true,
        //     focusCamera: true
        // })
    }


    protected async _onNodeContextMenu(_id:string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>){
        // console.log(_id, _e)
        _e.preventDefault()
        _e.stopPropagation()

        const items: MenuItem2[] = []
        const node = this._infoMap.get(_id)
        if(!node) return
        const obj = node.nodeData!

        if(canMakeAsset(obj)){
            items.push({
                props: {
                    text: 'Make Asset',
                },
                key: 'makeAsset',
                action: 'makeAsset',
                data: {obj}
            })
        }

        this.props.handleContextMenu?.(_e, items, obj)

    }

    // refreshSelected(){
    //     if(!this.context.viewer) this.setSelected(undefined)
    //     this.context.viewer?.doOnce('postFrame', () => {
    //         const selected = this.context.viewer?.getPlugin(PickingPlugin)?.getSelectedObject()
    //         // source?.dispatchEvent({type: 'select', value: source, object: source, ui: true})
    //         this.setSelected(selected?.uuid, true)
    //     })
    // }

    private _selectedIds: string[] = []
    private selectedObjectChanged = (e: any) => {
        const mats = e.material ? Array.isArray(e.material) ? e.material : [e.material] : /*e.object?.materials ||*/ []
        this._selectedIds = mats?.map((m: IMaterial) => m.uuid)
        this.setSelected(this._selectedIds, false)
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
    private materialUpdate = (e: Event2<'materialUpdate', ISceneEventMap, IObject3D>) => {
        // private materialUpdate = (e: any) => {
        if (e.refreshUi !== false && (e.change === 'name' || e.key === 'name')) {
            this.props.config.uiRefresh?.(true, 'postFrame')
            // @ts-ignore
            // hierarchyConfig.children![0]!.uiRefresh?.()
        }
    }

    componentDidMount() {
        super.componentDidMount();
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPMaterialsTreeComponent: viewer not found in context', this.context)
            return
        }
        // A closed Resources section is not mounted, so it missed every selection event while it was
        // shut. The tree reads what is picked now, or its row opens unhighlighted.
        const picked = viewer.getPlugin(PickingPlugin)?.getSelectedObject<IMaterial>()
        if(picked?.isMaterial) {
            this._selectedIds = [picked.uuid]
            this.setSelected(this._selectedIds, false)
        }
        viewer.getPlugin(PickingPlugin)?.addEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.addEventListener('sceneUpdate', this.sceneUpdate) // todo: subscribe only to the material in the config instead of the whole scene
        viewer.scene.addEventListener('materialUpdate', this.materialUpdate) // todo: subscribe only to the material in the config instead of the whole scene
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPMaterialsTreeComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        viewer.scene.removeEventListener('materialUpdate', this.materialUpdate)
        super.componentWillUnmount();
    }

}

export function MaterialHierarchyComponent({className, treeRef}: {className: string, treeRef?: React.Ref<BPMaterialsTreeComponent>}){
    const {makeAsset} = useMakeAsset()
    const actions = {makeAsset: makeAsset}
    const {handleContextMenu} = useObjContextMenu(actions)
    const config: UiObjectConfig = useMemo(()=>({
        type: 'hierarchy',
        uuid: Math.random().toString(36).substring(2, 15),
        value: null
    }), [])
    const manager = useManager()
    const viewer = manager.get()

    return <BPMaterialsTreeComponent
        key={viewer.scene.modelRoot.uuid} // this is required because viewer can be destroyed and recreated
        ref={treeRef}
        config={config} handleContextMenu={handleContextMenu} className={className}/>
}
