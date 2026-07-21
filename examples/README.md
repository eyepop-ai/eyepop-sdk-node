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
npm --workspace @eyepop.ai/eyepop run build
```

For the staging SDK integration matrix used by CI, see the local command in `../CONTRIBUTING.md`.

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

or

open http://localhost:8000/examples/web/static/multi_image_group.html

(select two or more image files, then click Process Group to send them as a single image-group inference)

If OAuth2 login isn't set up for your browser session, create an untracked `examples/web/static/env.js` defining `const apiKey = '<your api key>'` to authenticate with an API key instead (same fallback used by `dataset.html`/`modeltest.html`).
