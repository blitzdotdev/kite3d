import {Icon} from '@blueprintjs/core'
import {fileToIcon} from '../utils/icons.tsx'
import {EditorDocument} from './EditorDocument.ts'

/** One tab: the kind icon the Files panel uses, the file name, a dot when dirty, and a close cross. */
export function DocumentTab({doc, canClose, onClose}: {
    doc: EditorDocument
    canClose: boolean
    onClose: ()=>void
}) {
    return <span className="document-tab">
        <Icon icon={fileToIcon({path: doc.path, type: 'file'})} size={14} className="document-tab-kind"/>
        <span className="document-tab-name">{doc.name}</span>
        {doc.dirty ? <span className="document-tab-dot"/> : null}
        {canClose ? <span
            className="document-tab-close"
            role="button"
            aria-label={`Close ${doc.name}`}
            onClick={e => {
                e.stopPropagation()        // the cross closes the tab, it does not select it
                onClose()
            }}><Icon icon="small-cross" size={12}/></span> : null}
    </span>
}
