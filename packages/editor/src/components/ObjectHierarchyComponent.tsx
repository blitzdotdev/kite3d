import {isExternalObject} from "../utils/projectUtils.ts";
import {useContextMenu} from "./ContextMenuProvider.tsx";
import {IObject3D, UiObjectConfig} from "threepipe";
import React, {useMemo} from "react";
import {BPHierarchyComponent} from "./BPHierarchyComponent.tsx";
import {useOnObjectCreate} from "./UseOnObjectCreate.tsx";
import {Object3DGenerationMenu} from "./Object3DGenerationMenu.tsx";
import {useManager} from "../utils/UseManager.ts";
import {useMakeAsset} from "../utils/UseMakeAsset.ts";
import {useDocuments} from "../documents/UseDocuments.ts";
import {documentKind} from "../documents/DocumentStore.ts";
import {assetUrlPrefix} from "../utils/project.ts";
import {showErrorToast} from "../utils/Toaster.tsx";

export function ExtraMenuItems(props: {
    event: React.MouseEvent<HTMLElement>,
    object: IObject3D
}) {
    const obj = props.object
    const onObjectCreate = useOnObjectCreate();
    // todo after onObjectCreate is done, expand the current object if a child is added

    if(!obj?.isObject3D) return null
    const isComponent = obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
    const isExternal = isExternalObject(obj)
    const isGroup = !obj.isMesh && !obj.material && !obj.isLine && !obj.isPoints && !obj.isCamera // groups, lights, cameras, helpers, etc
    const canCreate = !isExternal && !isComponent && isGroup
    return canCreate && onObjectCreate ? <>
        <Object3DGenerationMenu onGenerate={(child)=>onObjectCreate(child, obj)}/>
    </> : null
}


export function ObjectHierarchyComponent({className}: { className: string }) {
    const manager = useManager()
    const viewer = manager.get()

    const {makeAsset} = useMakeAsset()
    const actions = {makeAsset,
        moveInParent: (data: { obj: IObject3D, delta: number }) => {
            const parent = data.obj.parent
            if (!parent) return
            const index = parent.children.indexOf(data.obj)
            if (index === -1) return
            let newIndex = index + data.delta
            newIndex = Math.max(0, Math.min(parent.children.length - 1, newIndex))
            if (newIndex === index) return
            parent.children.splice(index, 1)
            parent.children.splice(newIndex, 0, data.obj)
            data.obj?.setDirty && data.obj?.setDirty({change: 'indexInParent'})
    }}

    // const {handleContextMenu} = useObjContextMenu(actions, (ev)=>{
    //     return onObjectCreate ? <>
    //         <MenuDivider title="Create" className={"context-menu-divider"} />
    //         <Object3DGenerationMenu onGenerate={(obj)=>onObjectCreate(obj, ev.object)}/>
    //     </> : null
    // })

    const contextMenu = useContextMenu()
    const {store} = useDocuments()

    /**
     * A placed asset names the file it came from in userData.rootPath. A double click on that row
     * opens the file as a document, the same call the Inspector's Edit Asset button makes. A clone
     * of an asset child carries _tpRootPath instead, and that one stays a plain row.
     */
    const onOpenAsset = (obj: IObject3D) => {
        const rootPath = (obj as {_tpRootPath?: string})._tpRootPath ? null : obj.userData?.rootPath
        if (!rootPath || !rootPath.startsWith(assetUrlPrefix)) return false
        const path = manager.resolveAssetIdPath(rootPath)
        if (!path || path.startsWith(assetUrlPrefix) || !documentKind(path)) return false
        store.open(path).catch(e => showErrorToast(`Unable to open ${path}`, e))
        return true
    }

    const config: UiObjectConfig = useMemo(() => ({
        type: 'hierarchy',
        uuid: Math.random().toString(36).substring(2, 15),
        value: viewer.scene.modelRoot,
    }), [viewer])

    // const children = [...manager?.get().scene.modelRoot.children]

    return <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
    }}>
        <BPHierarchyComponent
            config={config}
            key={viewer.scene.modelRoot.uuid} // this is required because viewer can be destroyed and recreated
            onOpenAsset={onOpenAsset}
            handleContextMenu={(e, items, obj) => {
                contextMenu.handleContextMenu({
                    event: e,
                    actionItems: items,
                    actions: actions,
                    obj: obj,
                    Items: ExtraMenuItems,
                })
            }}
            className={className}/>
    </div>
}
