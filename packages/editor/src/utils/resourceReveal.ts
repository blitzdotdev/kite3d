import {EventDispatcher} from "threepipe";

export type ResourceKind = 'material' | 'texture' | 'geometry'

export interface ResourceRevealRequest {
    kind: ResourceKind
    /** The uuid of the material, texture or geometry, which is also its row id in the Resources tab. */
    uuid: string
}

/**
 * A double click on a reference row under a mesh asks for the Resources tab. Two listeners answer:
 * the editor switches the left panel, and the Resources tab opens the section and scrolls the row
 * into view. The tab is not mounted while the Objects tab is showing, so the last request is kept
 * and the tab reads it when it mounts.
 */
class ResourceRevealHub extends EventDispatcher<{reveal: ResourceRevealRequest & {type: 'reveal'}}> {
    pending: ResourceRevealRequest | null = null

    reveal(request: ResourceRevealRequest) {
        this.pending = request
        this.dispatchEvent({type: 'reveal', ...request})
    }

    /** The Resources tab takes the request, so a later mount does not scroll again. */
    take(): ResourceRevealRequest | null {
        const request = this.pending
        this.pending = null
        return request
    }
}

export const resourceReveal = new ResourceRevealHub()
