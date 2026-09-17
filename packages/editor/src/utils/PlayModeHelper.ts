import {EventDispatcher, PickingPlugin} from "threepipe";
import {RunningGame, startGame} from "@kite3d/engine";
import {settingsKey} from "./project.ts";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";
import {isPackageProject} from "./projectUtils.ts";
import {EditModePlugin} from "./EditModePlugin.ts";
import {SceneDocument} from "../documents/SceneDocument.ts";

export class PlayModeHelper extends EventDispatcher<{
    runModePauseChange: {},
    /** A run started or stopped. The document strip is dead while one runs, so it listens. */
    runModeChange: {},
}> {

    isPausedRunning = false

    // todo make public readonly
    isRunningMode = false

    // The run on the edit viewer: the project's scripts, plugins, clock, components, physics and main().
    private running: RunningGame | null = null

    // The scene this run borrowed, what it looked like before, and the tab Play was pressed on.
    // Stop gives all three back.
    private beforeRun: {
        scene: SceneDocument, activeId: string | null,
        dirty: boolean, savedHash: string | null, sceneName: string | null,
    } | null = null

    constructor(private manager: ViewerInstanceManager) {
        super()
    }

    async startRunMode() {
        const manager = this.manager
        // check if scene is loaded
        // save current scene to running.glb
        // load running.glb in play mode
        const store = manager.store
        if (!store) return false
        // Play runs the scene tab that is open. An object, material or texture tab holds no scene,
        // so the main scene runs from those.
        const scene = store.active instanceof SceneDocument ? store.active : store.mainScene
        if (!scene) return false
        if (manager.savingScene) return false

        if (this.isRunningMode) {
            if (this.isPausedRunning) {
                await this.unpauseRunMode(true)
                return true
            }
            return true
        }

        const project = manager.loadedProject
        const isPackage = isPackageProject(project)
        if (!project || (isPackage && !project.handle)) return false

        // The tab Play was pressed on. The activate below overwrites it, and a cold scene reads its
        // file in that same activate, so the rest of the record is taken after it.
        const activeId = store.activeId
        // A scene runs on the viewport, so it goes there first. Switching while it runs is refused.
        await store.activateForPlay(scene.path)
        this.beforeRun = {scene, activeId, dirty: scene.dirty, savedHash: scene.savedHash, sceneName: scene.sceneName}

        // Play runs the scene as it is, not as an isolated view shows it.
        manager.get().getPlugin(EditModePlugin)?.exitIsolate()
        await manager.editPreview.start()

        let load

        if (isPackage) {
            const filePath = `.${settingsKey}/running/${manager.editorId}.scene.gltf` // todo delete file after run mode closed?

            try {
                const v = manager.get()
                const gltfMeta = v.scene.modelRoot.userData.gltfExtras?.resourcePath
                if (gltfMeta) delete v.scene.modelRoot.userData.gltfExtras.resourcePath

                const picking = v.getPlugin(PickingPlugin)
                const selected = picking?.getSelectedObject()?.uuid

                const res = await manager.exportRunningScene()
                if (!res.file) {
                    // todo
                    throw new Error('Failed to export scene for run mode: ' + (res.error || 'Unknown error'))
                }

                const text = await (res.file as File).text()
                const gltfJson = JSON.parse(text)
                console.log('[Running Scene GLTF]', gltfJson)

                if (v.scene.modelRoot.userData.gltfExtras)
                    v.scene.modelRoot.userData.gltfExtras.resourcePath = gltfMeta

                const snapshot = res.file as File
                manager._runningSceneFile = snapshot

                // todo async write file and delete on stop (handle user stopping before write complete)
                // const saved = await manager.writeFile(project.handle, filePath, manager._runningSceneFile, project.path).catch(e => {
                //     console.error(e)
                //     return false
                // })
                // if (!saved) {
                //     // return {error: 'Failed to save scene file.'}
                //     throw new Error('Failed to save scene file for run mode')
                // }

                // The game runs on a copy, so stopping can put the authored scene back untouched.
                load = async () => {
                    await store.viewport.reload(scene, () => scene.importTree(snapshot, filePath))
                    if (picking && selected) {
                        const obj = v.object3dManager.getObject(selected)
                        if (obj) picking.setSelectedObject(obj)
                    }
                }
            } catch (e) {
                await manager.editPreview.stop()
                throw e
            }
        }

        console.clear && console.clear()
        this.isRunningMode = true
        this.dispatchEvent({type: 'runModeChange'})
        manager.features.enable('physics', 'PlayingMode')
        manager.get().timeline.reset()

        if (load) await load()

        try {
            this.running = await startGame(manager.get(), manager.runtimeProject(), {base: '/files/'})
        } catch (e) {
            await this.stopRunMode()
            throw e
        }
        return true
    }

    async pauseRunMode() {
        const manager = this.manager
        if (this.isPausedRunning) return
        this.isPausedRunning = true
        manager.get().timeline.stop()
        manager.editPreview.pause()
        this.dispatchEvent({type: 'runModePauseChange'})
    }

    async unpauseRunMode(startTime = true) {
        const manager = this.manager
        if (!this.isPausedRunning) return
        this.isPausedRunning = false
        manager.editPreview.resume()
        if (startTime) manager.get().timeline.start()
        this.dispatchEvent({type: 'runModePauseChange'})
    }

    async stopRunMode() {
        const manager = this.manager
        if (!this.isRunningMode) return false
        this.isRunningMode = false
        this.dispatchEvent({type: 'runModeChange'})

        await this.unpauseRunMode(false)

        const project = manager.loadedProject
        const isPackage = isPackageProject(project)
        if (!project || (isPackage && !project.handle)) return false

        const store = manager.store
        const before = this.beforeRun
        if (!store || !before) return
        const scene = before.scene

        const v = manager.get()
        const picking = v.getPlugin(PickingPlugin)
        const selected = picking?.getSelectedObject()?.uuid

        await this.running?.stop()
        this.running = null

        manager.features.disable('physics', 'PlayingMode')

        await manager.editPreview.stop()

        v.timeline.stop()
        v.timeline.reset()

        if (isPackage) {
            const filePath = `.${settingsKey}/running/${manager.editorId}.scene.gltf` // todo delete file after run mode closed?

            const tempFile = manager._runningSceneFile
            if (!tempFile) {
                console.error('No running scene file found, cannot reload scene.')
                return
            }
            // todo delete tempFile

            await store.viewport.reload(scene, () => scene.importTree(tempFile, filePath))

            if (picking && selected) {
                const obj = v.object3dManager.getObject(selected)
                if (obj) picking.setSelectedObject(obj)
            }
        }

        scene.savedHash = before.savedHash
        scene.dirty = before.dirty
        // The run's snapshot is threepipe's raw export, and it names the model root 'Scene'.
        // Importing that snapshot back would write its name over the one the scene file carries.
        scene.sceneName = before.sceneName
        this.beforeRun = null

        // The tab Play was pressed on comes back. activateForPlay does nothing when that tab is the
        // scene that just ran, or when it is no longer open, and the scene stays on the viewport.
        if (before.activeId) await store.activateForPlay(before.activeId)
    }

}
