import {Button, Intent} from '@blueprintjs/core'
import {useDialogPrompt} from 'uiconfig-blueprint/lib/esm/lib'
import {showSuccessErrorToast} from '../utils/Toaster.tsx'
import {useDocumentStore} from './UseDocuments.ts'

/**
 * Closing a tab. A dirty document asks first: Yes saves it, No throws the edits away, Cancel keeps
 * the tab open.
 */
export function useCloseDocument() {
    const store = useDocumentStore()
    const {prompt, close} = useDialogPrompt()

    const askSaveBeforeClose = () => new Promise<boolean | null>((resolve) => {
        const buttons = [
            {label: 'Cancel', value: null},
            {label: 'No', value: false},
            {label: 'Yes', value: true},
        ]
        let resolved = false
        prompt({
            canClose: false,
            title: 'Save File',
            message: 'You have unsaved changes, do you want to save before closing?',
            showInput: false,
            actions: buttons.map((b, i) => <Button
                key={i}
                intent={b.value ? Intent.SUCCESS : b.value === false ? Intent.DANGER : Intent.NONE}
                onClick={() => {
                    resolved = true
                    close()
                    resolve(b.value)
                }}>{b.label}</Button>),
        }).finally(() => !resolved && resolve(null))
    })

    const closeDocument = async (path: string) => {
        const doc = store.find(path)
        if (!doc) return false
        if (doc.dirty) {
            const answer = await askSaveBeforeClose()
            if (answer === null) return false
            if (answer) {
                const res = await store.save(path)
                showSuccessErrorToast(`Saved ${path} successfully.`, 'Unable to save file.', res)
                if (res.error || res.warn) return false
            }
        }
        return store.close(path)
    }

    return {closeDocument}
}
