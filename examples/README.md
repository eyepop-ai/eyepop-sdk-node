# Howto run the examples

## Preparation

In project root:

```shell
export EYEPOP_POP_ID=<your pop id>
```

```shell
export EYEPOP_SECRET_KEY=<your api key>
```

## In Node

```shell
npx tsx examples/node/upload_image.ts examples/example.jpg
```

## With Webpack

```shell
cd examples/webpack
npm install
npm run dev
```

open http://localhost:8000/upload.html

or

open http://localhost:8000/ingress.html

## Plain JS in browser

in project root

```shell
python3 -m http.server
```

open http://localhost:8000/examples/web/static/upload.html

or

open http://localhost:8000/examples/web/static/ingress.html

In another terminal

```shell
open http://127.0.0.1:8000/examples/web/static/upload.html?popId=$EYEPOP_POP_ID&eyepopUrl=(echo $EYEPOP_URL | jq -sRr @uri)
```