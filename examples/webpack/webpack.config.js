const webpack = require('webpack');
const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');
const EmitFilePlugin = require('emit-file-webpack-plugin');
const EyePop = require('@eyepop.ai/eyepop').EyePop;
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");

const eyepopSession = async () => {
    return JSON.stringify(await (await EyePop.workerEndpoint().connect()).session());
}

module.exports = {
    entry: {
      upload: './src/upload.js',
      ingress: './src/ingress.js'
    },
    mode: 'development', output: {
        path: path.resolve(__dirname, 'dist'), clean: true, filename: '[name].js',
    },
    plugins: [
      new HtmlWebpackPlugin({
          template: "./src/upload.html",
          filename: "upload.html",
          chunks: ["upload"]
      }),
      new HtmlWebpackPlugin({
          template: "./src/ingress.html",
          filename: "ingress.html",
          chunks: ["ingress"]
      }),
      new CopyPlugin({
          patterns: ["static"],
      }), new EmitFilePlugin({
          filename: `eyepop-session.json`,
          content: eyepopSession,
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_PRE_PROCESS,
      }), new NodePolyfillPlugin()
    ],
    devServer: {
      hot: false, allowedHosts: "all", liveReload: false, port: 8000, client: {
          logging: 'verbose', overlay: true,
      },
  },
};

