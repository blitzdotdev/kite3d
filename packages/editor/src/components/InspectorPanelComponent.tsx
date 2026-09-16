import {PanelActions} from "@blueprintjs/core/lib/esnext/components/panel-stack2/panelTypes";
import {getFileByPath, useAssets} from "../utils/AssetsProvider.ts";
import {
    generateUUID,
    getOrCall,
    IGeometry,
    IMaterial,
    IObject3D,
    ITexture,
    UiObjectConfig
} from "threepipe";
import {
    isExternalGeometry,
    isExternalMaterial,
    isExternalTexture,
} from "../utils/projectUtils.ts";
import {ConfigObject, FolderHeadCard, useLoadingState} from "uiconfig-blueprint/lib/esm/lib";
import {Button, Divider, Icon, Intent} from "@blueprintjs/core";
import {RefSelectionObjectComponent} from "./RefSelectionObjectComponent.tsx";
import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import React, {ReactElement, useCallback, useEffect, useState} from "react";
import {TexturePreview} from "./BPTextureFileComponent.tsx";
import {showErrorToast, showSuccessErrorToast} from "../utils/Toaster.tsx";
import {assetUrlPrefix, ExternalPlugin, ExternalScript} from "../utils/project.ts";
import {useListenProperty} from "./UseListenProperty.tsx";
import {useAsyncMemo} from "./UseAsyncMemo.tsx";
import {fileToIcon, iconForSelectionObject} from "../utils/icons.tsx";
import {refreshTexturePreview} from "../utils/three/refreshTexturePreview.ts";
import {isGeomEditable, isTexEditable} from "../utils/three/assetEditorChecks.ts";
import {useProject} from "../utils/UseProject.ts";
import {useManager} from "../utils/UseManager.ts";
import {useDocuments} from "../documents/UseDocuments.ts";
import {SceneDocument} from "../documents/SceneDocument.ts";
import {MaterialInstanceIns, ObjectInspectorUI} from "./ObjectInspectorUI.tsx";
import {InsSectionItem} from "./InsSectionItem.tsx";
import {UnkObjComponent} from "./UnkObjComponent.tsx";
import {InsSectionHeader} from "./InsSectionHeader.tsx";

export type InspectorPanelProps = {}

export function InspectorPanelComponent({...props}: PanelActions & InspectorPanelProps){
    // useEffect(()=>{
    //     console.log('mount inspector')
    //     return ()=>{
    //         console.log('unmount inspector')
    //     }
    // }, [])

    const {selectedInspectorItems, selectedFiles, fileManifest} = useAssets()
    // console.log({selectedInspectorItems})
    let selObject = selectedInspectorItems.length === 1 ? selectedInspectorItems[0] : null
    const selFile = !selObject && selectedFiles.length === 1 ? selectedFiles[0] : null
    const manager = useManager()
    const viewer = manager.get()
    // const objectSelUiConfig = useMemo<UiObjectConfig[]|undefined>(()=>object ? picking?.objectSelectionUiConfig(object) : undefined, [object])
    // const objectMatManageUiConfig = useMemo<UiObjectConfig[]|undefined>(()=>object ? picking?.objectMaterialManageUiConfig(object) : undefined, [object])
    const {project} = useProject()
    const {store} = useDocuments()

    // todo inspector based on select, but this loadAsset will reload the file everytime from scratch, use getAssetFromPath
    // const selectedFileLoaded = useAsyncMemo(async ()=>project && selFile ? manager.loadAsset(selFile, project) : null, [manager, selFile, project])

    // useEffect(()=>{
    //     if(!selObject && selectedFileLoaded && picking && !picking.getSelectedObject() && (selectedFileLoaded.isObject3D || selectedFileLoaded.isMaterial || selectedFileLoaded.isTexture || selectedFileLoaded.isBufferGeometry)){
    //         picking.setSelectedObject(selectedFileLoaded as any)
    //     }
    // }, [selObject, selectedFileLoaded, picking])

    const loadedAssetMain = store.active?.asset ?? null
    // let selObjectPath: string | null = null
    if(loadedAssetMain && !(loadedAssetMain as IObject3D).isObject3D){
        selObject = loadedAssetMain as any
    }

    // if(object?.userData.tpAssetId) object = null
    // else if(object?._tpAssetId) object = null
    const material = (selObject as IMaterial)?.isMaterial ? selObject as IMaterial : null//object?.material
    // const materials = material_s ? (Array.isArray(material_s) ? material_s : [material_s]) : []
    let geometry = (selObject as IGeometry)?.isBufferGeometry ? selObject as IGeometry : null//object?.geometry
    let texture = (selObject as ITexture)?.isTexture ? selObject as ITexture : null

    // const isAsset = !!selObject?.userData?.rootPath?.startsWith(assetUrlPrefix)
    // const isLoadedAsset = isAsset && selObject === loadedObject // its an .glb or .mat file with asset id set
    // const canConvertToAsset = selObject === loadedObject && !isAsset && selFile?.path.endsWith('.glb')
    // const isLoadedAssetMain = isAsset && selObject === loadedAssetMain // main loaded scene/asset

    // const isAssetChild = object?._tpAssetId && !isAsset // child of an asset
    // const isLoadedAssetChild = isAssetChild && object?._tpAssetId === manager.loadedAssetId

    const {loadingState, updateLoading} = useLoadingState()

    // console.log(object, materials, material_s)
    // todo
    //  unselect button
    //  lock button

    const [needsSave, setNeedsSave] = useState(false)

    const isPackageJson = selFile?.path === 'package.json'
    // console.log(loadedPackageJson)


    // const texturePreview = texture ? refreshTexturePreview(texture, viewer, (p)=>{
    //     console.log('todo refresh')
    // }) : undefined
    const [texturePreview, setTexturePreview] = useState('')
    const refreshTexPreview = useCallback(()=>{
        if(!texture || !viewer) {
            setTexturePreview('')
            return
        }
        let cancelled = false
        const preview = refreshTexturePreview(texture, viewer, (p1)=>{
            if(!cancelled) setTexturePreview(p1)
        })
        setTexturePreview(preview)
        return ()=>{
            cancelled = true
        }
    }, [texture, viewer])

    useEffect(()=>{
        refreshTexPreview()
    }, [refreshTexPreview])

    // const isMatFile = isLoadedAsset && selObject && selObjectPath && (selObject as IMaterial).isMaterial
    // useEffect(()=>{
    //     if(isMatFile){
    //         const listener = ()=>{
    //             setNeedsSave(true)
    //         }
    //         const mat = selObject as IMaterial
    //         mat.addEventListener('materialUpdate', listener)
    //         return ()=>{
    //             mat.removeEventListener('materialUpdate', listener)
    //         }
    //     } else {
    //         setNeedsSave(false)
    //     }
    // }, [selObject, isMatFile])

    // todo autosave on needssave

    const inspectingScene = !selObject && !selFile

    const assetRootPath1_ = (selObject as IObject3D|IMaterial|ITexture|IGeometry)?._tpRootPath || (selObject as any)?.__rootPath || null
    let assetRootUid = (selObject as IObject3D)?._tpRootUid || null // if this is set, this object is a clone of a child of an asset

    const instanceRootPath = !assetRootPath1_ ? selObject?.userData?.rootPath : null
    const isAssetInstance = instanceRootPath && selObject?.userData?.rootPath?.startsWith(assetUrlPrefix)

    const assetRootPathFull  = assetRootPath1_ && !assetRootPath1_.startsWith(assetUrlPrefix) ? null : assetRootPath1_
    const assetRootPath2 = assetRootPathFull ? assetRootPathFull.replace(assetUrlPrefix, '') : assetRootPathFull

    const assetRootPath1 = manager.resolveAssetIdPath(assetRootPath2)

    const assetRootPathAsset = useAsyncMemo(async ()=>assetRootPathFull ? manager.getAssetFromPath(assetRootPathFull) : null, [manager, assetRootPathFull])

    // An open object or material tab is the asset itself, so editing it and saving it are the point
    // of the tab. A texture tab stays view only, which is the decision its save toast already says.
    const openDocumentIsEditable = store.active?.kind === 'object' || store.active?.kind === 'material'
    const assetRootPathCanEdit = !!assetRootPathAsset && !assetRootUid &&
        (loadedAssetMain !== assetRootPathAsset || openDocumentIsEditable)
    const buttons: ReactElement[] = []

    // saves selObject

    if(selObject && assetRootPathAsset && assetRootPathCanEdit) {
        const resetAsset = async ()=>{
            if(!assetRootPath1 || !project || !assetRootPathAsset) return
            // The open tab owns its tree, and loadAsset would hand back the copy it already shows.
            if (store.active?.asset === assetRootPathAsset) return store.active.reload()
            const entry = getFileByPath(assetRootPath1, fileManifest)
            if(!entry) {
                console.error('Could not find file in manifest: ' + assetRootPath1, fileManifest)
                return
            }
            return await manager.loadAsset(entry, project) // this will refresh the same loaded asset
        }

        const saveAsset = async ()=>{
            if(!selObject || !project || !assetRootPathAsset || !assetRootPathCanEdit || !assetRootPath1) return

            if(!assetRootPathAsset.isObject3D && !assetRootPathAsset.isMaterial){
                console.error('Asset is not an object3D or material', assetRootPathAsset, assetRootPath1)
                return
            }
            const res = await manager.saveProjectAsset(project, store.active instanceof SceneDocument ? store.active : null, assetRootPathAsset as IObject3D|IMaterial, assetRootPath1)
            const r = showSuccessErrorToast(res ? `Saved ${assetRootPath1} successfully` : 'Unknown Error', 'Unable to save asset', res)
            if(r)
                setNeedsSave(false) // todo get needs save based on object
            return res

            // if(!isLoadedAsset || !selObject || !selObjectPath || !project) return
            // if(!isMatFile) return // todo other types
            // if(res.error){
            //     // todo apptoaster
            //     return
            // }
            // setNeedsSave(false)
            // return res
        }

        buttons.push(
            <Button key={"resetButton"} icon={<Icon icon={"reset"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Reload Asset"} intent={Intent.NONE}
                    loading={loadingState['resetAsset']}
                // todo handle error/null from fn return
                    onClick={() => updateLoading('resetAsset', resetAsset())}
            />
        )
        buttons.push(
            <Button key={"saveButton"} icon={<Icon icon={"floppy-disk"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Save Asset"} intent={Intent.SUCCESS}
                    loading={loadingState['saveAsset']}
                // disabled={!needsSave} // todo needssave based on whats being edited
                    onClick={() => selObject && updateLoading('saveAsset', saveAsset())}
            />
        )
    }

    // Edit Asset opens the asset's own file as a tab, for a placed instance and for a clone of a
    // child alike. It used to select the source object the registry holds, which sits in no scene.
    const editAssetPath = assetRootUid && assetRootPathAsset ? assetRootPath1
        : isAssetInstance ? manager.resolveAssetIdPath(instanceRootPath)
            : null

    if(selObject && editAssetPath) {
        buttons.push(
            <Button key={"editButton"} icon={<Icon icon={"edit"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Edit Asset"} intent={Intent.WARNING}
                    loading={loadingState['editAsset']}
                    onClick={() => updateLoading('editAsset', store.open(editAssetPath)
                        .catch(e => showErrorToast(`Unable to open ${editAssetPath}`, e)))}
            />
        )

    }

    let title = ''
    let icon: IconName|MaybeElement = 'cog'
    if(selFile?.path) {
        title = selFile.path
        icon = 'document'
    }
    // Nothing is picked, so the Inspector belongs to the document on the viewport. It names it the
    // way that document's tab does.
    else if(inspectingScene && store.active) {
        title = store.active.name
        icon = fileToIcon({path: store.active.path, type: 'file'})
    }
    else if(inspectingScene) title = 'Global Settings'
    else if(assetRootPathAsset && assetRootPath1) {
        const editing = assetRootPathCanEdit ? 'Editing: ' : ''
        title = editing + assetRootPath1 + (selObject !== assetRootPathAsset ? ' ⮕ ' + selObject!.name : '')
        icon = iconForSelectionObject(assetRootPathAsset)
    }else if(isAssetInstance){
        title = 'Instance: ' + instanceRootPath.replace(assetUrlPrefix, '')
        icon = iconForSelectionObject(selObject)
    }else if(instanceRootPath){
        title = 'Instance: ' + instanceRootPath
        icon = iconForSelectionObject(selObject)
    }

    // todo if isAssetInstance only allow editing sproperties

    // console.log(selFile, object, selectedInspectorItems)

    // useEffect(()=>{
    //     console.log('mount inspector')
    //     return ()=>{
    //         console.log('unmount inspector')
    //     }
    // }, [])

    // console.log({material, assetRootPath, assetRootPathAsset, assetRootPathCanEdit})
    // console.log({selObject}, isLoadedAsset, isLoadedAssetMain, object)
    return !selectedInspectorItems ? null : <div style={{
        listStyleType: "none",
        paddingLeft: "0", margin: "0",
        paddingBottom: "500px",
        overflowAnchor: "none",
    }}>
        {/*{v && (<ConfigObject {...props}/>)}*/}
        {/*{!selectedFiles.length ? null : <>*/}
        {/*    <div>Files</div>*/}
        {/*    <div>{selectedFiles.map(item=>{*/}
        {/*        return <div key={item.path}>{item.name}</div>*/}
        {/*    })}</div>*/}
        {/*</>}*/}
        <InsSectionHeader
            style={{
                position: "absolute",
                top: 0,
                left: 0,
            }}
            title={title} icon={icon}>
            {...buttons}
        </InsSectionHeader>
        {/*{!!selObject?.uiConfig && (isLoadedAssetMain) && !object && <>*/}
        {/*    /!*<div>Selected</div>*!/*/}
        {/*    /!*<div>Name - {selObject.name}</div>*!/*/}
        {/*    {selObject.uiConfig && (<ConfigObject key={'selObject'} {...props} config={selObject.uiConfig} icon={iconForSelectionObject(selObject)}/>)}*/}
        {/*</>}*/}
        {!!geometry && <>
            {/*<div>Geometry</div>*/}
            {!!geometry.uiConfig && isGeomEditable(geometry, manager) && (assetRootPathCanEdit || !isExternalGeometry(geometry) )?
                <ConfigObject key={'geometryc'} {...props} config={geometry.uiConfig} icon={iconForSelectionObject(geometry)}/> :
                    <UnkObjComponent key={'geometry'} label={`Geometry: ${geometry.name || 'Unnamed'}`} disabled={true} obj={geometry}/>
            }
            <Divider style={{margin: 0}}/>
        </>}
        {!!material && <>
            {/*<div>*/}
            {/*    <div>Materials</div>*/}
            {/*</div>*/}
            {/*{materials.map((material,i)=>*/}
            {material.uiConfig && (assetRootPathCanEdit || !isExternalMaterial(material)) ?
                isAssetInstance ? <MaterialInstanceIns key={'matsin'+material.uuid} {...props} obj={material}/> :
                <ConfigObject key={'mats'+material.uuid} {...props} config={material.uiConfig} icon={iconForSelectionObject(material)}/> :
                <UnkObjComponent key={'matsunk'+material.uuid} label={`Material: ${material.name || 'Unnamed'}`} disabled={true} obj={material}/>}
            {/*)}*/}
            {/*{!!objectMatManageUiConfig?.length && objectMatManageUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>
        </>}
        {!!texture && <>
            {/*<div>Texture</div>*/}
            {texturePreview && <TexturePreview
                preview={texturePreview}
                refreshPreview={()=>refreshTexPreview()}
                height={"240px"}
                width={"100%"}
                key={'texpreview'}
                objectFit={"contain"}
            />}
            {/*{texture.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/> :*/}
            {/*    texture._tpAssetId ? <UnkObjComponent label={`Texture: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/> :*/}
            {/*        !!texture.uiConfig && (<ConfigObject {...props} config={texture.uiConfig} icon={iconForSelectionObject(texture)}/>)}*/}

            {/*{isExternalTexture}*/}
            {!!texture.uiConfig && isTexEditable(texture, manager) && !isExternalTexture(texture) ?
                <ConfigObject key={'texturec'} {...props} config={texture.uiConfig} icon={iconForSelectionObject(texture)}/> :
                <UnkObjComponent key={'texture'} label={`Asset: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/>
            }

            <Divider style={{margin: 0}}/>
        </>}
        {(selObject as IObject3D)?.isObject3D && <ObjectInspectorUI
            object={(selObject as IObject3D)}
            isAssetInstance={isAssetInstance}
            assetRootPath={assetRootPath2}
            assetRootPathCanEdit={assetRootPathCanEdit}
            {...props}
        />}
        {/*{isPackageJson && <>*/}
        {/*    <PluginsSectionComp/>*/}
        {/*    <Divider style={{margin: 0}}/>*/}
        {/*    <ScriptsSectionComp/>*/}
        {/*</>}*/}
        {inspectingScene && <>
            {viewer.uiConfig.children?.map((c, i)=>{
                const uiConfig: UiObjectConfig|undefined = getOrCall(c) // todo use uiconfigmethods
                if(!uiConfig || typeof uiConfig !== 'object') return null
                if(uiConfig.label === 'Scene') return null // Added to hierarchy
                uiConfig.expanded = true
                return <ConfigObject key={uiConfig.uuid ?? ('scn'+i)} {...props} config={uiConfig} icon={iconForSelectionObject(selObject)}/>
            })}

        </>}
    </div>

}

