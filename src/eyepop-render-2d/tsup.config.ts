import { defineConfig } from 'tsup'

export default defineConfig({
    entry: {
        'eyepop.render2d.index': './index.ts',
    },
    outDir: './dist',
    format: ['cjs', 'esm'], // Build for commonJS and ESmodules
    dts: true, // Generate declaration file (.d.ts)
    splitting: false,
    sourcemap: true,
    clean: true,
})
