import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    server: {
        port: 8000,
    },
    resolve: {
        alias: {
            'eyepop': path.resolve(__dirname, '../../src/eyepop/dist/eyepop.min.js'),
            'eyepop-render-2d': path.resolve(__dirname, '../../src/eyepop-render-2d/dist/eyepop.render2d.min.js'),
            'example.jpg': path.resolve(__dirname, '../../examples/example.jpg'),
            'large_example.jpg': path.resolve(__dirname, '../../examples/large_example.jpg'),

        }
    },
})
