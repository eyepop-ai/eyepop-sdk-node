const path = require('path');
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const webpack = require('webpack');

module.exports = {
  entry: path.resolve(__dirname, 'dist', 'eyepop.index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'eyepop.min.js',
    library: {
      name: "EyePop",
      type: "umd",
      export: [ 'default' ]
    },
  },
  plugins: [
    new NodePolyfillPlugin(),
    new webpack.ProvidePlugin({
      Buffer: [ 'buffer', 'Buffer' ],
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
    })
  ]
};
