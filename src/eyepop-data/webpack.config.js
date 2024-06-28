const path = require('path');
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");

module.exports = {
  entry: path.resolve(__dirname, 'dist', 'eyepopdata.index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'eyepopdata.min.js',
    library: {
      name: "EyePopData",
      type: "umd",
      export: ['default']
    },
  },
  plugins: [
    new NodePolyfillPlugin()
  ],
  resolve: {
    fallback: {
      "net": false, // This tells Webpack to provide an empty module for 'net' when bundling for the browser.
    },
  },
};