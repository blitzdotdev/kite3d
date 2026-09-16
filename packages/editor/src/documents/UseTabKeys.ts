import {useEffect} from 'react'
import {useManager} from '../utils/UseManager.ts'
import {useDocuments} from './UseDocuments.ts'
import {useCloseDocument} from './UseCloseDocument.tsx'
import {showErrorToast} from '../utils/Toaster.tsx'

/**
 * The tab strip's keys. Cmd+W closes the active tab through the same prompt its cross uses, and
 * Ctrl+Tab cycles the strip. Both are dead while a game runs, the way the strip itself is.
 */
export function useTabKeys() {
    const {store} = useDocuments()
    const {closeDocument} = useCloseDocument()
    const manager = useManager()

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
            // Decision 5: a switch during Play would detach the scene the run is playing.
            if (manager.playMode.isRunningMode) return

            if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
                // Chrome's own Cmd+W would take the whole editor with it, so the editor answers the
                // key whether or not it has a tab to close.
                event.preventDefault()
                const path = store.activeId
                // The main scene tab is refused, the way its missing cross already says.
                if (path && path !== store.mainScenePath) void closeDocument(path)
                return
            }

            if (event.ctrlKey && event.key === 'Tab') {
                const paths = store.documents.map(d => d.path)
                if (!paths.length) return
                event.preventDefault()
                const step = event.shiftKey ? -1 : 1
                const at = paths.indexOf(store.activeId ?? '')
                const next = paths[(at + step + paths.length) % paths.length]
                // A cold tab reads its file here, and a file gone bad says so, the way a click does.
                void store.activate(next).catch(e => showErrorToast(`Unable to open ${next}`, e))
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [store, closeDocument, manager])
}
