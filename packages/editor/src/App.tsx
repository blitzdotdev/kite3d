import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {AppToasterOverlay, DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import {BlueprintProvider} from "@blueprintjs/core";
import {AssetsProvider} from "./utils/AssetsProvider.ts";
import {ContextMenuProvider} from "./components/ContextMenuProvider.tsx";
import {ProjectProvider} from "./utils/UseProject.ts";
import {ManagerProvider} from "./utils/UseManager.ts";
// import Split from "react-split";
// import {InspectorStackComponent} from 'uiconfig-blueprint/lib/esm/lib'
import {
    QueryClient,
    QueryClientProvider,
    useQuery,
} from '@tanstack/react-query'
import {queryClient} from "./tsdb/client.ts";
import {ViewerInstanceManager} from "./utils/ViewerInstanceManager.ts";
import {LoadedProject} from "./utils/project.ts";
import {HubClient} from "./devserver/HubClient.ts";
import {HubProvider} from "./utils/UseHub.ts";
import {AskDialogBridge} from "./utils/AskDialog.tsx";
import {DocumentStore} from "./documents/DocumentStore.ts";
import {DocumentStoreProvider} from "./documents/UseDocuments.ts";

// console.log(InspectorStackComponent, Split)

function App({manager, project, hub, store}: { manager: ViewerInstanceManager, project: LoadedProject, hub: HubClient, store: DocumentStore }) {
    return (
        <QueryClientProvider client={queryClient}>
        <BlueprintProvider>
        <VisualStyleProvider>
        <DialogProvider>
        <HubProvider hub={hub}>
        <ProjectProvider project={project}>
        <ManagerProvider manager={manager}>
        <DocumentStoreProvider store={store}>
        <AssetsProvider>
        <ContextMenuProvider>
            <>
                <ThreeEditorComponent />
                <DialogComponent/>
                <AskDialogBridge/>
                <AppToasterOverlay/>
            </>
        </ContextMenuProvider>
        </AssetsProvider>
        </DocumentStoreProvider>
        </ManagerProvider>
        </ProjectProvider>
        </HubProvider>
        </DialogProvider>
        </VisualStyleProvider>
        </BlueprintProvider>
        </QueryClientProvider>
    )
}

export default App
