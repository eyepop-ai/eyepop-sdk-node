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

or

open http://localhost:8000/hand-distance.html

(live webcam, with a camera selector and a calibration panel. Runs 2d body points back-projected through
`eyepop.depth.large`, and overlays the distance in metres between each person's wrists. The intrinsics are
prefilled from the camera's reported resolution and an assumed field of view, which the page states plainly:
a browser never reports a focal length, so they are a starting point to be replaced by a real calibration.)

The build mints a worker session from `EYEPOP_API_KEY` and emits it as `eyepop-session.json`, so the key stays
on the build host and only the short lived session reaches the browser. Never place an EyePop API key in a
browser-delivered file.
