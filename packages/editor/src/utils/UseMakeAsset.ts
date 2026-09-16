import {useProject} from "./UseProject.ts";
import {useManager} from "./UseManager.ts";
import {useDocuments} from "../documents/UseDocuments.ts";
import {SceneDocument} from "../documents/SceneDocument.ts";
import {useState} from "react";
import {IMaterial, IObject3D} from "threepipe";
import {showSuccessErrorToast} from "./Toaster.tsx";

export function useMakeAsset() {
    const {project} = useProject()
    const manager = useManager()
    const {store} = useDocuments()
    const [isMaking, setIsMaking] = useState(false)

    const makeAsset = async (data: { obj: IObject3D | IMaterial }) => {
        const active = store.active
        if (!project || !active) return false
        if (isMaking) return
        setIsMaking(true)

        // A new asset is cut out of the scene it was made in, so that scene is saved with it.
        const res = await manager.saveNewProjectAsset(project, active instanceof SceneDocument ? active : null, data.obj)
        setIsMaking(false)
        // @ts-ignore
        const r = showSuccessErrorToast(res.path ? `Created ${res.path} successfully` : 'Unknown Error', 'Unable to create asset', res)
        return (res as any).result ?? null

    }
    return {makeAsset}
}
