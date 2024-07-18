# EyePop.ai Render 2d Node Module
This EyePop.ai Node Module provides convenient 2d rendering functions for predictions returned by 
to the EyePop.ai's inference API from applications written in the TypeScript or JavaScript language.

The module requires the [EyePop Node SDK](https://www.npmjs.com/package/@eyepop.ai/eyepop)
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
    const renderer = Render2d.renderer(context)
    
    context.drawImage(image, 0, 0)

    const endpoint = await EyePop.endpoint().connect()
    try {
        let results = await endpoint.process({path: example_image_path})
        for await (let result of results) {
            renderer.draw(result)
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
        const renderer = Render2d.renderer(context);
        
        const endpoint = await EyePop.endpoint({ auth: { oAuth2: true }, popId: '< Pop Id>' }).connect();
        endpoint.process({file: fileChooser.files[0]}).then(async (results) => {
            for await (let result of results) {
                renderer.draw(result);
            }
        });
        await endpoint.disconnect();
    });
    </script>
</body>
</html>

```
### Rendering Rules
By default, the 2d renderer renders boxes and class-labels for every top level object in the prediction.
Change this rendering behaviour by passing in rendering rule(s), e.g.:
```javascript
// ...
    Render2d.renderer(context,[Render2.renderFace()]).draw(result);
// ...
```
Each rule has a `render` object and a `target` attribute. All prebuild render classes accept a JSONPath expression as `target` parameter to select which elements should be rendered from predictions. 
See [JSONPath expression](https://www.npmjs.com/package/jsonpath)

Most prebuild render classes provide a reasonable defaults, as shown below.
#### Rendering Bounding Boxes and Class Labels

```typescript
Render2d.renderBox({
    showClass = true, 
    showConfidence = false,
    showTraceId = false,
    showNestedClasses = false,
    target = '$..objects.*' 
})
``` 
#### Render Human Body Poses (2d or 3d)
```typescript
Render2d.renderPose({
    target: '$..objects[?(@.category=="person")]'
})
```    
#### Render Human Hand Details
```typescript
Render2d.renderHand({
    target: '$..objects[?(@.classLabel=="hand circumference")]'
})
```
#### Render Human Faces
```typescript
Render2d.renderFace({
    showLabels = false,
    target = '$..objects[?(@.classLabel=="face")]' 
}) 
```
#### Render Text (OCR Overlay)
```typescript
Render2d.renderText({
    target: '$..objects[?(@.classLabel=="text")]'
})
```
#### Render Segmentation Masks
```typescript
Render2d.renderMask({
    target: '$..objects[?(@.mask)]'
}) 
```
#### Render Segmentation Contours
```typescript
Render2d.renderContour({
    target: '$..objects[?(@.contours)]'
}) 
```
#### Blur an Object (TODO does black-put instead of blur)
```typescript
Render2d.renderBlur({
    target: '$..objects[?(@.classLabel=="face")]'
})
```
#### Render a Trail of a traced object over time
```typescript
Render2d.renderTrail({
    target: '$..objects[?(@.traceId)]',
    trailLengthSeconds:1,
})
```
By default, this traces the mid-point of the object's bounding box. Instead, one can also draw trails of sub-objects or key points of the traced object. Use the optional parameter `traceDetails` for this purpose. 
E.g. trail the nose of every traced person:
```typescript
Render2d.renderTrail({
    target: '$..objects[?(@.traceId)]',
    trailLengthSeconds:1,
    traceDetails:'$..keyPoints[?(@.category=="3d-body-points")].points[?(@.classLabel.includes("nose"))]'
})
```
#### Custom render implementation
To implement custom rendering rules, create a custom class as follows:  
```typescript
import { PredictedObject, StreamTime } from '@eyepop.ai/eyepop'

export interface Render {
    target: string
    start(context: CanvasRenderingContext2D, style: Style): void
    draw(element: any, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void
}

export class RenderCustomImage implements Render
{
  public target: string = "$..objects[?(@.category=='person')]"

  private context: CanvasRenderingContext2D | undefined
  private style: any

  // Optionally, add a constructor here. ie: constructor(...) { }

  // The start method sets the context and style properties.
  start(context: CanvasRenderingContext2D, style: any)
  {
    this.context = context
    this.style = style
  }

  // The draw method draws the image and line on the canvas based on the positions of the points in the PredictedObject.
  public draw(
    element: PredictedObject, // The object containing the keypoints
    xOffset: number, // The x offset for the drawing
    yOffset: number, // The y offset for the drawing
    xScale: number, // The x scale factor for the drawing
    yScale: number, // The y scale factor for the drawing
    streamTime: StreamTime // The timestamp for the stream of predicted objects
  ): void
  {
    // Check if the context and style properties have been set
    if (!this.context || !this.style)
    {
      throw new Error('render() called before start()')
    }

    // Check if the keypoints are defined
    if (!element.keyPoints) return
    if (!element.keyPoints.length) return

    // Find the points of interest in the keypoints
    for (let i = 0; i < element.keyPoints.length; i++)
    {
      const kp = element.keyPoints[ i ]
      for (let j = 0; j < kp.points.length; j++)
      {
        const point = kp.points[ j ]
        if (point.classLabel === 'left eye' || point.classLabel === 'right eye')
        {
            // Draw with the canvas context here
        }
      }
    }
  }
}


```
