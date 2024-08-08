# Composable Pops (PREVIEW)
Building rich inference pipelines programmatically by combining prebuilt ML components with custom trained models.
## Anatomy of a Pop 
A Pop declares "Pop components" and an optional post transform instruction in [JSONata](https://jsonata.org/) format. There are different component types with the simplest one, `noop`, just being a passthrough component. So the most simplest Pop with a single component looks like:

```json
{
   "components": [{
      "type":"forward"   
   }]
}
```

This example adds an attribute into the resulting meta data. The `postTransform` value has to have a valid [JSONata](https://jsonata.org/) expression.

```json
{
   "components": [{
      "type":"forward"   
   },{
      "type":"forward"   
   }],
   "postTransform": "{\"foo\":\"bar\"}"
}
```
The Pop will apply all components independent of each other on the input media, i.e. semantically a parallel execution.  The Pop runtime may decide to execute the components in parallel, sequential or mixed depending on available resources and externally configured constrains.
## Pop Components
Supported **component types**:

* **`forward`**
* **`inference`**
* **`tracing`**
* **`contour_finder`**
* **`component_finder`**

### Component Type: forward

The `forward` component does not performs any operation itself, but forward the media and meta data to other components with an optional filter and secondary crop instructions.&#x20;

In its simplest form it can by used as a 'tee' to forward to more than one component. All other component types inherit all features ant attributes from `forward`. This makes it more compact to process and forward in one step.

### Component Type: inference

The `inference` component performs ML based inference on the input media and produces structured meta data that will be included in the output of the Pop.  The structured meta data can also be forwarded to other models ([explained later](#component-type-component_finder)). Here is a simple example of an `inference` pop component:

```json
{
   "components": [{
      "type":"inference",
      "inferenceTypes": ["object_detection"],
      "modelUuid": "066ae8f1fc0174138000cb8bcfa7bdeb"
   }]
}
```

The `modelUuid` must be a valid Uuid of a model instance in the Dataset API and must be readable by the user creating this Pop. This can be a custom trained (aka SST model) or a public, EyePop provided model. TBD how clients can discover public models.

Valid `inferenceTypes` values are below and have to match or be a subset of the model's capabilities:

* `image_classification`
* `object_detection`
* `key_points`
* `ocr`
* `mesh`
* `semantic_segmentation`
* `segmentation`

#### Other attributes for component type: inference

* The attribute `categoryName`tag all meta data result with the given string as `category-name`
* The attribute `confidenceThreshold` overwrites the default  model confidence threshold and filters out results below this value.
* The attribute `targetFps` allows a controlled sample rate to run inference on videos, the value has to be string expressing a fraction of integer values, e.g. `"10/1"`
* the attribute `hidden` will, if set to `true`, produce meta data to the forwarded components but it will be hidden from the final output. This can be helpful when intermediary components are needed for technical reasons (e.g. a face detector before facial expressions) but the end result should apply the leaf node results to the previous component (e.g. the person detector).

For example:

```json
{
   "components": [{
      "type":"inference",
      "inferenceTypes": ["object_detection"],
      "categoryName": "ocean-animals",
      "confidenceThreshold": 0.85,
      "targetFps": "3/2",
      "modelUuid": "066ae8f1fc0174138000cb8bcfa7bdeb"
   }]
}
```

#### Chaining pop components

All component types allow forwarding their meta data results to other components with an optional filter and secondary crop instructions.&#x20;

You can use this to run components in sequence. and use the object detection result of the first component to crop the detected areas and run the subsequent components on those image areas. Here is an example how to run text detection and recognition on a subset of the primarily detected objects:

```json
{
  "components": [{
     "type":"inference",
     "inferenceTypes": ["object_detection"],
     "categoryName": "logistic-stuff",
     "modelUuid": "066ae8f1fc0174138000cb8bcfa7bdeb",
     "forward": {
       "operator": {
         "type": "crop",
         "includeClasses": ["ziploc-bag", "envelope"],
         "crop": {
           "boxPadding": 0.5,
           "maxItems": 1024
         }
       },
       "targets": [{
         "type":"inference",
         "inferenceTypes": ["object_detection"],
         "categoryName": "text",
         "modelUuid": "066ae8d0204774aa8000b3622e509d40",
         "forward": {
           "operator": {
             "type": "crop"
           },
           "targets": [{
             "type":"inference",
             "inferenceTypes": ["ocr"],
             "categoryName": "text",
             "modelUuid": "066ae8ba5b3179848000dc608ee5b0c2"           
           }]
         }       
       }]
     }
   }]
}
```

Supported attributes to control forwarding:

* `operator.type` one of `full`, `crop` or `crop_with_full_fallback`
* `operator.includeClasses` an optional string list to only forward specific classes
* `operator.crop.maxItems` overwrite the default of 16 items to crop per image frame
* `operator.crop.boxPadding` expand the bounding by this factor
* `operator.crop.orientationTargetAngle` rotate the box to this target angle in degrees

### Component Type: tracing

The `tracing` component performs object tracing for video media. It i.e. attempts to re-identify detected objects in subsequent frames by its trajectory and similarity. Traced objects have the same `traceId` in the meta data of subsequent frames. Example:

```json
{
   "components": [{
     "type":"inference",
     "inferenceTypes": ["object_detection"],
     "categoryName": "common-vehicles",
     "modelUuid": "066ae8f1fc0174138000cb8bcfa7bdeb",
     "forward": {
       "operator": {
         "type": "crop",
         "includeClasses": ["car", "truck"]
       },
       "targets": [{
         "type":"tracing",
         "reidModelUuid": "066ae8d0204774aa8000b3622e509d40"
       }]
     }
   }]
}
```

Supported attributes to control tracing:

* `reidModelUuid` optional REid model to calculate similarity. If omitted, tracing only used trajectory.&#x20;
* `maxAgeSeconds` maximum  time to keep traces without being matched to an object.  This does not limit the temporal length of traces in general, just how long the tracer keeps them if unmatched.
* `simThreshold` the minimum similarity for objects to be matched to an active trace.
* `iouThreshold` the minimum iuo factor for an object in a frame to be be matched to the projected position of an active trace in this frame if not matched by similarity yet.

### Component Type: contour_finder

The `contour_finder` component converts segmentation masks to contours of different shapes.  For example:

```json
{
   "components": [{
     "type":"inference",
     "inferenceTypes": ["object_detection"],
     "modelUuid": "066ae8f1fc0174138000cb8bcfa7bdeb",
     "forward": {
       "operator": {
         "type": "crop",
         "includeClasses": ["person"]
       },
       "targets": [{
         "type":"inference",
         "inference_types": ["semantic_segmentation"],
         "modelUuid": "066ae8d0204774aa8000b3622e509d40",
         "forward": {
           "operator": {
             "type": "full"
           },
           "targets": [{
             "type": "contour_finder"          
           }]
         }
       }]
     }
   }]
}
```

Supported attributes to control contour finding:

* `contourType` one of&#x20;
  * `all_pixels`
  * `polygon`
  * `convex_hull`
  * `hough_circles`
  * `circle`
  * `triangle`
  * `rectangle`

Contours are always expressed as polygons in the result meta data, even for the regular shapes `circle` and `rectangle`.  Contour types `all_pixels` and `polygon` can hace "cut outs".

### Component Type: component\_finder

The `component_finder` converts segmentation masks of objects into sub objects, using the Connected Components algorithm. For example:

```json
{
   "components": [{
      "type":"inference",
      "inferenceTypes": ["semantic_segmentation"],
      "categoryName": "bacteria",
      "modelUuid": "066ae8f1fc0174138000cb8bcfaaaaaa",
      "forward": {
        "operator": {
          "type": "full"
        },
        "targets": [{
            "type": "component_finder",
            "componentClassLabel": "bacteria-cluster"   
        }]
      }
   }]
}   
```

Supported attributes to control component finding:

* `dilate`
* `erode`
* `componentClassLabel`
* `keepSource`
