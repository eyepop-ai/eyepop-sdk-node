const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: path.resolve(__dirname, 'dist', 'eyepop.render2d.index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'eyepop.render2d.min.js',
    library: {
      name: "Render2d",
      type: "umd",
      export: [ 'default' ]
    },
  },
  plugins: [
    // Work around for Buffer is undefined:
    // https://github.com/webpack/changelog-v5/issues/10
    new webpack.ProvidePlugin({
      Buffer: [ 'buffer', 'Buffer' ],
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
    })
  ]
};
