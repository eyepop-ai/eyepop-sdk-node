 const path = require('path');
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");

  module.exports = {
    entry: path.resolve(__dirname, 'dist', 'index.js'),
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'eyepop.min.js',
      library: {
        name: "EyePopSdk",
        type: "umd",
        export: ['default']
      },
    },
    plugins: [
        new NodePolyfillPlugin()
    ]
    // resolve: {
    //   fallback: {
    //     "crypto": require.resolve("crypto-browserify"),
    //     "stream": false,
    //     "process": false
    //   }
    // }
  };