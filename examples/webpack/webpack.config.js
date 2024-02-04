const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  mode: 'development',
  output: {
     path: path.resolve(__dirname, 'dist'),
     clean: true,
     filename: 'main.js',
  },
  resolve: {
    extensions: ['.ts', '.js', '.json', '.css'],
  },
  target: 'web',
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/index.html"
    }),
    new CopyPlugin({
      patterns: [
        "static"
      ],
    }),
  ],
  externalsPresets: { node: true },
  devServer: {
    hot: true,
    allowedHosts: "all",
    liveReload: true,
    port: 8080,
    client: {
      logging: 'verbose',
      overlay: true,
    },
  },
};