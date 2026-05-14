# Howto run the examples

## Preparation

In project root:

```shell
export EYEPOP_API_KEY=<your api key>
```

For a provisioned persistent worker session, also set:

```shell
export EYEPOP_SESSION_UUID=<your session uuid>
```

## In Node

```shell
npx tsx examples/node/pop_demo.ts \
  --pop person \
  --output \
  --localPath examples/example.jpg
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
