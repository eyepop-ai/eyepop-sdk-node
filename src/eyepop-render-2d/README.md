# EyePop.ai Render 2d Node Module
This EyePop.ai Node Module provides convenient 2d rendering functions for predictions returned by 
to the EyePop.ai's inference API from applications written in the TypeScript or JavaScript language.

The module requires the [EyePop Node SDK](../eyepop/README.md)
## Installation
### Node
```shell
npm install --save @eyepop.ai/eyepop @eyepop.ai/eyepop-render-2d
```
### Browser
```html
<script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop/dist/eyepop.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop-render-2d/dist/eyepop.render2d.min.js"></script>
```
## Usage example
### Node
This EyePop Node Module provides 2d rendering for predictions using `canvas.CanvasRenderingContext2D`.
```typescript
import { EyePop } from '@eyepop.ai/eyepop';
import { Render2d } from '@eyepop.ai/eyepop-render-2d';

import {createCanvas, loadImage} from "canvas";
import {open} from 'openurl';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const example_image_path = 'examples/example.jpg';
    
(async() => {
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)

    const endpoint = await EyePop.endpoint().connect()
    try {
        let results = await endpoint.process({path: example_image_path})
        for await (let result of results) {
            Render2d.renderer(context).prediction(result)
        }        
    } finally {
        await endpoint.disconnect()
    }
    
    const tmp_dir = mkdtempSync(join(tmpdir(), 'ep-demo-'))
    const temp_file = join(tmp_dir, 'out.png')
    console.log(`creating temp file: ${temp_file}`)

    const buffer = canvas.toBuffer('image/png')
    writeFileSync(temp_file, buffer)

    open(`file://${temp_file}`)
})();
```
### Browser
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop/dist/eyepop.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop-render-2d/dist/eyepop.render2d.min.js"></script>
</head>
<body>
<!-- ... -->
    <input type="file" id="my-file-chooser">
<!-- ... -->
    <canvas id="my-canvas"></canvas>
<!-- ... -->
    <script>
    async uploadFile(event) {
        const fileChooser = document.getElementById('my-file-chooser');
        const context = document.getElementById('my-canvas').getContext("2d");
        const endpoint = await EyePop.endpoint({ auth: { oAuth2: true }, popId: '< Pop Id>' }).connect();
        endpoint.process({file: fileChooser.files[0]}).then(async (results) => {
            for await (let result of results) {
                Render2d.renderer(context).prediction(result);
            }
        });
        await endpoint.disconnect();
    });
    </script>
</body>
</html>

```
### Rendering Rules
By default, the 2d renderer renders boxes and clasS-labels for every top level object in the prediction.
Change this rendering behaviour by passing in rendering rule(s), e.g.:
```javascript
// ...
    Render2d.renderer(context,[{
        type: 'face',
        target: '$..objects[?(@.classLabel=="face")]'
    }]).prediction(result);
// ...
```
Each rule has a `type` and a `target` attribute. Supported rule types are:
* `box` draws a bounding box and a class label
* `pose` draws person body key points 
* `hand` draws person hand detailed key points 
* `face` draws person face mesh and expression labels
* `blur` blurs the bounding box of the selected object

the `target` attribute is a [JSONPath expression](https://www.npmjs.com/package/jsonpath) that is applied to the prediction result to filter the objects to be rendered.