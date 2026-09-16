import './renderer.scss'
import {BlueprintProvider, FocusStyleManager} from "@blueprintjs/core";
import {AppToasterOverlay, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import App from './App.tsx'
import {createRoot} from 'react-dom/client'
// import {StrictMode} from 'react'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
import {DevServerSource} from './devserver/DevServerSource.ts'
import {HubClient} from './devserver/HubClient.ts'
import {DevServerDirectoryHandle, ProjectManifest} from './devserver/handles.ts'
import {HubProvider} from './utils/UseHub.ts'
import {ViewerInstanceManager} from './utils/ViewerInstanceManager.ts'
import {Viewport} from './documents/Viewport.ts'
import {DocumentStore} from './documents/DocumentStore.ts'
import {showErrorToast} from './utils/Toaster.tsx'

declare global {
    interface Window {
        // kite3d screenshot and the cookie isolation test wait for this
        kite3dProjectLoaded?: boolean
    }
}

FocusStyleManager.onlyShowFocusOnTabs();

async function openServedProject() {
    const source = new DevServerSource()
    const state = await source.state()
    const hub = new HubClient(source)

    // A server without a project answers {hub: true}: the picker, and no viewer behind it.
    if (state.hub) {
        document.title = 'Kite3D'
        createRoot(document.getElementById('root')!).render(
            <BlueprintProvider>
            <VisualStyleProvider>
            <HubProvider hub={hub}>
                <WelcomeScreenDialog/>
                <AppToasterOverlay/>
            </HubProvider>
            </VisualStyleProvider>
            </BlueprintProvider>,
        )
        return
    }

    const manifest = new ProjectManifest(source)
    await manifest.refresh()
    const root = new DevServerDirectoryHandle('', source, manifest)

    const manager = new ViewerInstanceManager(source, manifest)
    const project = await manager.initReadWriteProject({
        path: state.name || '',
        file: 'package.json',
        assets: 'assets/',
        lastModified: Date.now(),
        handle: root,
    })
    const viewer = await manager.loadProject(project, {})
    const viewport = new Viewport(viewer, manager)
    const store = new DocumentStore(manager, viewport)
    manager.store = store

    createRoot(document.getElementById('root')!).render(
        // <StrictMode>
            <App manager={manager} project={project} hub={hub} store={store}/>
        // </StrictMode>,
    )
    manager.initialize()

    // The editor renders first. A file that does not load is one broken file, and the user needs the
    // Files panel and the strip to reach it, not a blank page.
    await store.restore().catch((e) => showErrorToast('Unable to open the last tabs', e))
    window.kite3dProjectLoaded = true
}

void openServedProject()
