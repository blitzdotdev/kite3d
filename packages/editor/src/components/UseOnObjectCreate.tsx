import {IObject3D, UndoManagerPlugin} from "threepipe";
import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";
import {useManager} from "../utils/UseManager.ts";
import {useDocuments} from "../documents/UseDocuments.ts";
import {ObjectDocument} from "../documents/ObjectDocument.ts";

export function useOnObjectCreate() {
    const manager = useManager()
    const {store} = useDocuments()
    const active = store.active
    const canCreate = !active || active.kind === 'scene' || active.kind === 'object'
    const onObjectCreate = canCreate ? (obj: IObject3D, root?: IObject3D) => {
        const viewer = manager.get()
        const scene = viewer.scene
        if (!scene || !obj) return undefined

        let parent = null

        if (active instanceof ObjectDocument) {
            if (root) {
                let p = root
                while (p && p !== scene.modelRoot && p !== active.object) {
                    p = p.parent as IObject3D
                }
                if (p !== active.object) {
                    AppToaster().show({
                        message: 'The selected root is not part of the loaded asset',
                        intent: 'warning',
                        icon: 'warning-sign',
                        timeout: 2000,
                        isCloseButtonShown: true,
                    });
                } else {
                    parent = (obj)
                }
            } else {
                parent = active.object
            }
        } else {
            if (root && root !== scene.modelRoot)
                parent = root
            else
                parent = scene
        }

        const cmd = {
            redo: ()=>parent === scene ? scene.addObject(obj) : parent?.add(obj),
            undo: ()=>obj.dispose ? obj.dispose(true) : obj.removeFromParent(),
        }
        const undo = viewer.getPlugin(UndoManagerPlugin)?.undoManager
        undo?.record(cmd)
        cmd.redo()

        obj?.parent && obj.dispatchEvent({type: 'select', value: obj, object: obj, ui: true, trackUndo: false})
        return obj?.parent
    } : null
    return onObjectCreate;
}
