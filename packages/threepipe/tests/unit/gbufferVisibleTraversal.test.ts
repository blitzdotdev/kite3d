import {Material} from 'three'
import {describe, expect, it, vi} from 'vitest'

vi.mock('../../src/core', () => ({}))

import {GBufferRenderPass} from '../../src/postprocessing/GBufferRenderPass'
import type {IObject3D, IScene, IWebGLRenderer} from '../../src/core'

describe('GBufferRenderPass visibility traversal', () => {
    // The reported combat scene keeps large authored source trees hidden while play renders their runtime clones.
    it('does not preprocess descendants of an invisible object', () => {
        const visible = {visible: true, material: new Material()} as IObject3D
        const hiddenChild = {visible: true, material: new Material()} as IObject3D
        const hiddenParent = {visible: false, children: [hiddenChild]} as IObject3D
        const scene = {
            visible: true,
            children: [visible, hiddenParent],
            traverse: (callback: (object: IObject3D) => void) => {
                callback(scene as IObject3D)
                callback(visible)
                callback(hiddenParent)
                callback(hiddenChild)
            },
            traverseVisible: (callback: (object: IObject3D) => void) => {
                callback(scene as IObject3D)
                callback(visible)
            },
        } as unknown as IScene
        const renderer = {
            getRenderTarget: vi.fn(),
            getActiveCubeFace: vi.fn(),
            getActiveMipmapLevel: vi.fn(),
            renderWithModes: (_modes: unknown, render: () => void) => render(),
            setRenderTarget: vi.fn(),
            autoClear: true,
            setClearColor: vi.fn(),
            setClearAlpha: vi.fn(),
            getClearColor: vi.fn(),
            getClearAlpha: vi.fn(),
            clear: vi.fn(),
            render: vi.fn(),
        } as unknown as IWebGLRenderer
        const pass = new GBufferRenderPass('gbuffer', undefined, new Material())
        pass.scene = scene
        pass.camera = {} as never
        const preprocess = vi.spyOn(pass, 'preprocessObject')

        pass.render(renderer)

        expect(preprocess).toHaveBeenCalledWith(visible)
        expect(preprocess).not.toHaveBeenCalledWith(hiddenChild)
    })
})
