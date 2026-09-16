import {useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {Button} from '@blueprintjs/core'
import {useCallback, useEffect} from "react";
import {useProject} from "../utils/UseProject.ts";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";
import {useDocuments} from "../documents/UseDocuments.ts";

export function useSaveProjectFile() {
    const {store} = useDocuments()
    const saveProjectFile = useCallback(async ()=>{
        const path = store.activeId
        if (!path) return
        const res = await store.save(path).catch(e=>{
            console.error(e)
            return {error: 'Unable to save file: ' + (e.message || e.toString())}
        })
        return showSuccessErrorToast(`Saved ${path} successfully.`, 'Unable to save file.', res as any)
    }, [store])
    return {saveProjectFile}
}

export function SaveProjectButton() {
    const {loadingState, updateLoading} = useLoadingState()
    const {project} = useProject()
    const {saveProjectFile} = useSaveProjectFile()
    const {store} = useDocuments()
    const active = store.active

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault()
                updateLoading('save-scene', saveProjectFile())
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [saveProjectFile, updateLoading])

    return !active || !project ? null : <Button
        variant={"minimal"} size={"small"}
        icon="git-repo" text={active.kind === 'scene' ? 'Save Scene' : 'Save File'}
        loading={loadingState['save-scene']}
        disabled={!active.dirty}
        onClick={() => updateLoading('save-scene', saveProjectFile())}/>
}
