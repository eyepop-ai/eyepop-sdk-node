import type { JestConfigWithTsJest } from 'ts-jest'

const config: JestConfigWithTsJest = {
    preset: 'ts-jest/presets/default-esm',
    verbose: true,
    transform: {
        '^.+\\.ts?$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
    },
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        // src/eyepop/package.json points main at dist, so a bare directory import
        // would silently test the last build instead of the sources under test
        '^\\.{1,2}/(?:.*/)?src/(eyepop|eyepop-render-2d)$': '<rootDir>/src/$1/index.ts',
    },
}
export default config
