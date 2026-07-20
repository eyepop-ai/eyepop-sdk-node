const path = require('path')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
const webpack = require('webpack')

module.exports = {
    entry: path.resolve(__dirname, 'dist', 'eyepop.index.js'),
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'eyepop.min.js',
        library: {
            name: 'EyePopSdk',
            type: 'umd',
        },
    },
    plugins: [
        new NodePolyfillPlugin(),
        new webpack.BannerPlugin({
            banner: "if (typeof globalThis !== 'undefined' && globalThis.EyePopSdk) { globalThis.EyePop = globalThis.EyePopSdk.EyePop; globalThis.PopComponentType = globalThis.EyePopSdk.PopComponentType; }",
            footer: true,
            raw: true,
        }),
    ],
}
