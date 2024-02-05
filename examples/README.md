# Howto run the examples
## Preparation
In project root:
```shell
npm link . @eyepop.ai/eyepop
```
```shell
export EYEPOP_POP_ID=<your pop id>
```
```shell
export EYEPOP_SECRET_KEY=<your api key>
```
## In Node
```shell
npx tsx examples/node/visualize_on_image.ts examples/example.jpg
```
```shell
npx tsx examples/node/upload_image_timing.ts examples/example.jpg 100
```
```shell
npx tsx examples/node/load_video_from_http.ts
```
## With Webpack
```shell
cd examples/webpack
npm link ../.. @eyepop.ai/eyepop
npm install
npm run dev
```
open http://localhost:8080/
## Vanilla JS in browser
in project root
```shell
open 
```

## Plain Javascript in Browser

