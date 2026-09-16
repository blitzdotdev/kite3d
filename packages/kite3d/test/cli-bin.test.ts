import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

describe('the built cli', () => {
    // Guards the owner's report from the terminator project: tsc writes dist/cli.js without the
    // execute bit, so a project that links this package by path fails on npx kite3d dev with
    // "Permission denied". The build runs before the tests, in CI and in AGENTS.md.
    it('keeps the execute bit that the bin link needs', async () => {
        const {mode} = await stat(resolve('dist/cli.js'))
        expect(mode & 0o111).toBe(0o111)
    })
})
