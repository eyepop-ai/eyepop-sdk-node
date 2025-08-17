const path = require('path')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')

module.exports = {
    entry: path.resolve(__dirname, 'dist', 'eyepop.index.js'),
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'eyepop.min.js',
        library: {
            type: 'umd',
        },
    },
    plugins: [new NodePolyfillPlugin()],
}
