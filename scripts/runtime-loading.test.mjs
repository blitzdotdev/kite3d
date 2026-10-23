import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Guards the manually observed standalone SF startup stall while intermediate
// authored meshes rendered. Execute the actual runtime function with fake loaders
// so default compatibility, restoration and cleanup need no WebGL or network.
test('runtime loading suppression is opt-in and restores rendering on success and failure', async () => {
    const source = readFileSync('packages/engine/src/runtime/createGame.ts', 'utf8')
    const start = source.indexOf('export async function createGame(')
    const end = source.indexOf('\nasync function loadRuntimeProject(', start)
    assert.ok(start >= 0 && end > start)
    const code = ts.transpileModule(source.slice(start, end).replace('export ', ''), {
        compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
    }).outputText
    for (const initiallyEnabled of [true, false]) {
        for (const renderDuringLoad of [undefined, false]) {
            for (const failure of [null, 'load', 'start']) {
                const calls = [], error = new Error('Observed startup failure')
                const viewer = {
                    renderEnabled: initiallyEnabled,
                    assetManager: {importer: {addURLModifier() {}}},
                    async load() {
                        calls.push(['load', this.renderEnabled])
                        if (failure === 'load') throw error
                        return {isObject3D: true}
                    },
                    dispose() { calls.push(['dispose', this.renderEnabled]) },
                }
                const context = vm.createContext({
                    console: {error() {}},
                    validateBase: value => new URL(value),
                    loadRuntimeProject: async () => ({mainScene: 'scene.gltf'}),
                    createViewer: () => viewer,
                    createProjectAssetURLModifier: () => value => value,
                    registerProjectScripts: async () => {}, registerProjectPlugins: async () => {},
                    RuntimeNestedAssetLoader: class {
                        async loadObjectDependencies() {}
                        async waitForPending() {}
                        dispose() { calls.push(['nested-dispose']) }
                    },
                    startGame: async () => {
                        calls.push(['start', viewer.renderEnabled])
                        if (failure === 'start') throw error
                        return {stop: async () => calls.push(['stop'])}
                    }, URL,
                })
                vm.runInContext(code, context)
                const errors = []
                const promise = context.createGame({base: 'https://example.invalid/', canvas: {}, renderDuringLoad, onError: e => errors.push(e)})
                if (failure) {
                    await assert.rejects(promise, e => e === error)
                    assert.deepEqual(errors, [error])
                } else {
                    const game = await promise
                    assert.equal(viewer.renderEnabled, initiallyEnabled)
                    await game.dispose()
                    assert.ok(calls.some(([name]) => name === 'stop'))
                }
                assert.equal(viewer.renderEnabled, initiallyEnabled)
                assert.ok(calls.some(([name]) => name === 'nested-dispose'))
                assert.ok(calls.some(([name, enabled]) => name === 'dispose' && enabled === initiallyEnabled))
                for (const [name, enabled] of calls) {
                    if (name === 'load' || name === 'start') assert.equal(enabled, initiallyEnabled && renderDuringLoad !== false)
                }
            }
        }
    }
})
