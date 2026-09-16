import {createContext, createElement, useEffect, useState} from 'react'
import {useSafeContext} from '../utils/useSafeContext.ts'
import {DocumentStore} from './DocumentStore.ts'
import {EditorDocument} from './EditorDocument.ts'

export const DocumentStoreContext = createContext<DocumentStore | undefined>(undefined)

export function DocumentStoreProvider({store, children}: {store: DocumentStore, children: any}) {
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
