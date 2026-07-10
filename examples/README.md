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

Build the local SDK before running examples that import from `src/eyepop/dist`:

```shell
npm run build -w @eyepop.ai/eyepop
```

```shell
npx tsx examples/node/pop_demo.ts \
  --pop person \
  --output \
  --localPath examples/example.jpg
```

To exercise a CPU ModelLess transient session:

```shell
npm run demo:cpu-session
```

This creates a transient staging session with a ModelLess pop, prompts for `person`, processes `examples/example.jpg`, prints the session and pipeline IDs, then deletes the transient session.

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
