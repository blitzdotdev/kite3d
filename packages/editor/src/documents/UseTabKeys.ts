import {useEffect} from 'react'
import {useManager} from '../utils/UseManager.ts'
import {useDocuments} from './UseDocuments.ts'
import {useCloseDocument} from './UseCloseDocument.tsx'
import {showErrorToast} from '../utils/Toaster.tsx'

/**
 * The tab strip's keys. Alt+W closes the active tab through the same prompt its cross uses, and
 * Alt+] and Alt+[ cycle the strip. Both are dead while a game runs, the way the strip itself is.
 *
 * Alt is the only modifier a page can have here. A browser keeps its own window and tab shortcuts
 * and never sends them to the page. The match is on `event.code`, because Option+W and Option+] type
 * other characters on macOS.
 */
export function useTabKeys() {
    const {store} = useDocuments()
    const {closeDocument} = useCloseDocument()
    const manager = useManager()

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
            if (!event.altKey || event.ctrlKey || event.metaKey) return
            // Decision 5: a switch during Play would detach the scene the run is playing.
            if (manager.playMode.isRunningMode) return

            if (event.code === 'KeyW') {
                event.preventDefault()
                const path = store.activeId
                // The main scene tab is refused, the way its missing cross already says.
                if (path && path !== store.mainScenePath) void closeDocument(path)
                return
            }

            if (event.code === 'BracketRight' || event.code === 'BracketLeft') {
                const paths = store.documents.map(d => d.path)
                if (!paths.length) return
                event.preventDefault()
                const step = event.code === 'BracketRight' ? 1 : -1
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
