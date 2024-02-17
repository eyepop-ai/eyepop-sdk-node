const path = require('path');

  module.exports = {
    entry: path.resolve(__dirname, 'dist', 'eyepop.render2d.index.js'),
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'eyepop.render2d.min.js',
      library: {
        name: "Render2d",
        type: "umd",
        export: ['default']
      },
    }
  };