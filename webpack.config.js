 const path = require('path');

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
  };