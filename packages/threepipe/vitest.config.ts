import {configDefaults, defineConfig} from 'vitest/config'
import glsl from 'rollup-plugin-glsl'
import {existsSync} from 'node:fs'
import path from 'node:path'

const localThree = path.resolve(__dirname, './node_modules/three/')
const hoistedThree = path.resolve(__dirname, '../../node_modules/three/')

export default defineConfig({
    plugins: [
        glsl({include: 'src/**/*.glsl'}),
    ],
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, './src/index.ts'),
            'three': existsSync(localThree) ? localThree : hoistedThree,
        },
    },
    test: {
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: [
            'src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
        ],
        exclude: [
            ...configDefaults.exclude,
            'experiments/**',
            '.claude/**',
            '.repos/**',
            'website/**',
            'examples/**',
            'plugins/**',
        ],
        reporters: process.env.CI ? ['verbose', 'junit'] : ['default'],
        outputFile: {
            junit: './test-results/junit.xml',
        },
        testTimeout: 10000,
    },
})
