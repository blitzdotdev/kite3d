import {getIconPaths, Icons} from '@blueprintjs/icons'
import {afterEach, expect, test, vi} from 'vitest'

vi.mock('@blueprintjs/core', () => ({
    BlueprintProvider: ({children}: {children: unknown}) => children,
    FocusStyleManager: {onlyShowFocusOnTabs: vi.fn()},
}))
vi.mock('uiconfig-blueprint/lib/esm/lib', () => ({
    AppToasterOverlay: () => null,
    VisualStyleProvider: ({children}: {children: unknown}) => children,
}))
vi.mock('./App.tsx', () => ({default: () => null}))
vi.mock('./components/WelcomeScreenDialog.tsx', () => ({WelcomeScreenDialog: () => null}))
vi.mock('./devserver/DevServerSource.ts', () => ({
    DevServerSource: class {
        state() {
            return new Promise(() => {})
        }
    },
}))
vi.mock('./devserver/HubClient.ts', () => ({HubClient: class {}}))
vi.mock('./devserver/handles.ts', () => ({
    DevServerDirectoryHandle: class {},
    ProjectManifest: class {},
}))
vi.mock('./utils/UseHub.ts', () => ({HubProvider: ({children}: {children: unknown}) => children}))
vi.mock('./utils/ViewerInstanceManager.ts', () => ({ViewerInstanceManager: class {}}))

afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
})

// Guards the reported empty toolbar icons after an editor rebuild removed Blueprint's lazy chunks.
test('the editor entry configures and primes a static loader for both icon sizes', async () => {
    const setLoaderOptions = vi.spyOn(Icons, 'setLoaderOptions')
    const loadAll = vi.spyOn(Icons, 'loadAll')

    await import('./main.tsx')

    expect(setLoaderOptions).toHaveBeenCalledOnce()
    expect(loadAll).toHaveBeenCalledOnce()
    const loader = setLoaderOptions.mock.calls[0][0].loader
    expect(loader).toBeTypeOf('function')
    if (typeof loader !== 'function') {
        throw new Error('Expected a custom icon loader')
    }
    await expect(loader('edit', 16)).resolves.toEqual(getIconPaths('edit', 16))
    await expect(loader('edit', 20)).resolves.toEqual(getIconPaths('edit', 20))
})
