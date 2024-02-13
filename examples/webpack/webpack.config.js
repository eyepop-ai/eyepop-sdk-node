const webpack = require('webpack');
const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');
const EmitFilePlugin = require('emit-file-webpack-plugin');
const EyePopSdk = require('@eyepop.ai/eyepop').EyePopSdk;
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");

const eyepopSession = async () => {
    return JSON.stringify(await (await EyePopSdk.endpoint().connect()).session());
}

module.exports = {
    entry: './src/index.js', mode: 'development', output: {
        path: path.resolve(__dirname, 'dist'), clean: true, filename: 'main.js',
    },
    plugins: [
      new HtmlWebpackPlugin({
          template: "./src/index.html"
      }), new CopyPlugin({
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

