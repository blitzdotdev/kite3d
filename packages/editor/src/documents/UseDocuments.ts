import {createContext, createElement, useEffect, useState} from 'react'
import {useSafeContext} from '../utils/useSafeContext.ts'
import {DocumentStore} from './DocumentStore.ts'
import {EditorDocument} from './EditorDocument.ts'

export const DocumentStoreContext = createContext<DocumentStore | undefined>(undefined)

export function DocumentStoreProvider({store, children}: {store: DocumentStore, children: any}) {
    // The browser owns the page's close, and its own close shortcut never reaches the editor. This
    // ask is all that stands between that key and an unsaved document.
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!store.documents.some(d => d.dirty)) return
            event.preventDefault()
            event.returnValue = ''       // the browser writes its own text; a page cannot choose it
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [store])

    return createElement(DocumentStoreContext.Provider, {value: store}, children)
}

export const useDocumentStore = () => useSafeContext(DocumentStoreContext)

/** The tab strip and anything else that draws the whole list re-renders from here. */
export function useDocuments(): {documents: EditorDocument[], activeId: string | null, store: DocumentStore} {
    const store = useDocumentStore()
    const [, forceUpdate] = useState(0)
    useEffect(() => {
        const l = () => forceUpdate(v => v + 1)
        store.addEventListener('change', l)
        return () => store.removeEventListener('change', l)
    }, [store])
    return {documents: [...store.documents], activeId: store.activeId, store}
}
