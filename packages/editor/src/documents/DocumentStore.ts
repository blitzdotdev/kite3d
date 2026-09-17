import {EventDispatcher} from 'threepipe'
import type {ViewerInstanceManager} from '../utils/ViewerInstanceManager.ts'
import type {Viewport} from './Viewport.ts'
import {DocumentKind, EditorDocument, SaveResult} from './EditorDocument.ts'
import {SceneDocument} from './SceneDocument.ts'
import {ObjectDocument} from './ObjectDocument.ts'
import {MaterialDocument} from './MaterialDocument.ts'
import {TextureDocument} from './TextureDocument.ts'
import {typesExts} from '../data/fileTypes.ts'

/** The document kind a path opens as, or null for a file the viewport has no view for. */
export function documentKind(path: string): DocumentKind | null {
    const name = path.toLowerCase()
    if (name.endsWith('.scene.gltf')) return 'scene'
    if (name.endsWith('.glb') || name.endsWith('.gltf')) return 'object'
    if (typesExts.material!.some(ext => name.endsWith(ext))) return 'material'
    if (typesExts.image!.some(ext => name.endsWith(ext))) return 'texture'
    return null
}

/** The open documents, which one is active, and every path in and out of them. It owns nothing GPU. */
export class DocumentStore extends EventDispatcher<{change: object}> {
    readonly documents: EditorDocument[] = []
    activeId: string | null = null

    constructor(readonly session: ViewerInstanceManager, readonly viewport: Viewport) {
        super()
        // The strip is dead while a game runs, so it redraws when a run starts and when it stops.
        session.playMode.addEventListener('runModeChange', this.changed)
    }

    /** The project's main scene setting, which "Set as main scene" moves. Its tab never closes. */
    get mainScenePath(): string | null {
        return this.session.loadedProject?.settings?.mainScene ?? null
    }

    get active(): EditorDocument | undefined {
        return this.documents.find(d => d.path === this.activeId)
    }

    /** The main scene document, which Play runs when the tab on screen holds no scene of its own. */
    get mainScene(): SceneDocument | undefined {
        const doc = this.documents.find(d => d.path === this.mainScenePath)
        return doc instanceof SceneDocument ? doc : undefined
    }

    /** The store redraws its strip and writes its memory. Both describe the same list of tabs. */
    changed = () => {
        this.remember()
        this.dispatchEvent({type: 'change'})
    }

    find(path: string) {
        return this.documents.find(d => d.path === path)
    }

    /** Opens a file on the viewport. A path that is already open is focused, not read again. */
    async open(path: string): Promise<EditorDocument | undefined> {
        const found = this.find(path)
        if (found) {
            await this.activate(path)
            return found
        }
        const kind = documentKind(path)
        if (!kind) return undefined
        const doc = this.create(path, kind)
        this.documents.push(doc)
        this.changed()
        await this.activate(path)      // the activate reads the file, the way it does for a cold tab
        return doc
    }

    /**
     * Brings back the tabs this project had open. Every remembered file becomes a cold tab and only
     * the active one reads its file; a cold tab reads its own when it is first shown. A remembered
     * path the project no longer has is dropped.
     */
    async restore() {
        const memory = this.remembered()
        const paths = memory.paths.filter(p => this.session.manifest.files.has(p))
        const main = this.mainScenePath
        if (main && !paths.includes(main)) paths.unshift(main)     // the main scene tab is always open
        for (const path of paths) {
            const kind = documentKind(path)
            if (kind) this.documents.push(this.create(path, kind))
        }
        this.changed()
        const active = memory.activeId && paths.includes(memory.activeId) ? memory.activeId : main
        if (active) await this.activate(active)
    }

    async activate(path: string) {
        // Decision 5: the strip is dead while a game runs, because a switch would detach the scene
        // the run is playing. Play itself goes through activateForPlay.
        if (this.session.playMode.isRunningMode) return
        await this.activateForPlay(path)
    }

    /** Activates whatever the caller names, past the gate above. Play and Stop come through here. */
    async activateForPlay(path: string) {
        const doc = this.find(path)
        if (!doc || this.activeId === path) return
        if (!doc.loaded) await doc.load()      // a cold tab reads its file the first time it is shown
        await this.viewport.show(doc)
        this.activeId = path
        this.changed()
    }

    /** Closes a tab. The caller has resolved the dirty prompt. */
    async close(path: string): Promise<boolean> {
        if (path === this.mainScenePath) return false
        const index = this.documents.findIndex(d => d.path === path)
        if (index < 0) return false
        const doc = this.documents[index]
        this.documents.splice(index, 1)
        doc.removeEventListener('change', this.changed)
        if (this.viewport.current === doc) {
            const next = this.documents[Math.min(index, this.documents.length - 1)]
            this.activeId = null
            if (next) await this.activate(next.path)
            else this.viewport.hide()
        }
        doc.unload()
        this.changed()
        return true
    }

    /**
     * Saves the active document, or the named one. A save serializes what is under the model root,
     * so an inactive document goes on the viewport for the write and the active one comes back.
     */
    async save(path?: string): Promise<SaveResult> {
        const doc = path ? this.find(path) : this.active
        if (!doc) return {error: 'No file open, nothing to save.'}
        if (this.viewport.current === doc) return doc.save()
        const showing = this.viewport.current
        await this.viewport.show(doc)
        try {
            return await doc.save()
        } finally {
            if (showing) await this.viewport.show(showing)
            else this.viewport.hide()
        }
    }

    /** A file changed on disk. A document with that path reloads; anything else is a placed asset. */
    async onFileChanged(path: string) {
        const doc = this.find(path)
        // A cold tab reads the file when it is first shown, so the change is only news to the scenes
        // that place it.
        if (doc?.loaded) {
            await doc.reloadFromDisk()
            this.changed()
            return
        }
        this.session.scheduleAssetRefresh(path)
    }

    /** The tabs of this project, under a key of its own: one browser origin serves many projects. */
    private get memoryKey() {
        return `kite3d.editor.tabs:${this.session.loadedProject?.path ?? ''}`
    }

    private remember() {
        localStorage.setItem(this.memoryKey, JSON.stringify({
            paths: this.documents.map(d => d.path),
            activeId: this.activeId,
        }))
    }

    private remembered(): {paths: string[], activeId: string | null} {
        const text = localStorage.getItem(this.memoryKey)
        try {
            const read = text ? JSON.parse(text) : null
            if (Array.isArray(read?.paths)) return {paths: read.paths, activeId: read.activeId ?? null}
        } catch {
            // localStorage outlives the build that wrote it, and a key this build cannot read must
            // not stop the editor from opening its main scene.
        }
        return {paths: [], activeId: null}
    }

    private create(path: string, kind: DocumentKind): EditorDocument {
        const doc: EditorDocument =
            kind === 'scene' ? new SceneDocument(path, this.session, this.viewport) :
                kind === 'object' ? new ObjectDocument(path, this.session, this.viewport) :
                    kind === 'material' ? new MaterialDocument(path, this.session, this.viewport) :
                        new TextureDocument(path, this.session, this.viewport)
        doc.addEventListener('change', this.changed)    // a dirty dot redraws its tab
        return doc
    }

}
