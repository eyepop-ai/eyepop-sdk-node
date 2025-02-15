import { ContourType, EndpointState, EyePop, ForwardOperatorType, InferenceType, PopComponentType, TransientPopId } from "@eyepop.ai/eyepop";
import { Render2d } from "@eyepop.ai/eyepop-render-2d";

import { createCanvas, loadImage } from "canvas";
import { open } from "openurl";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { pino } from "pino";
import process from "process";

const logger = pino({ level: "debug", name: "eyepop-example" });

const example_image = process.argv[2];

const TEXT_ON_OBJECTS = {
  components: [
    {
      type: PopComponentType.INFERENCE,
      model: "eyepop.coco.yolov7-tiny:latest",
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
        },
        targets: [
          {
            type: PopComponentType.INFERENCE,
            model: "eyepop.text:latest",
            hidden: false,
            forward: {
              operator: {
                type: ForwardOperatorType.CROP,
              },
              targets: [
                {
                  type: PopComponentType.INFERENCE,
                  model: "eyepop.text.recognize.square:latest",
                },
              ],
            },
          },
        ],
      },
    },
  ],
};

const OBJECT_TRACKING = {
  components: [
    {
      type: PopComponentType.INFERENCE,
      model: "eyepop.coco.yolov7-tiny:latest",
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
        },
        targets: [
          {
            type: PopComponentType.TRACING,
          },
        ],
      },
    },
  ],
};

const OBJECT_PLUS_PERSON = {
  components: [
    {
      type: PopComponentType.INFERENCE,
      model: "eyepop.coco.yolov7-tiny:latest",
    },
    {
      type: PopComponentType.INFERENCE,
      model: "eyepop.person:latest",
      categoryName: "person",
      confidenceThreshold: 0.8,
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
        },
        targets: [
          {
            type: PopComponentType.INFERENCE,
            categoryName: "2d-body-points",
            model: "eyepop.person.2d-body-points:latest",
          },
        ],
      },
    },
  ],
};

const OBJECT_PLUS_PERSON_WITH_TRACKING = {
  components: [
    {
      type: PopComponentType.INFERENCE,
      inferenceTypes: [InferenceType.OBJECT_DETECTION],
      modelUuid: "yolov7:YOLOv7-TINY_COCO_TensorFlowLite_float32", // replace with your own model uuid
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
        },
        targets: [
          {
            type: PopComponentType.TRACING,
          },
        ],
      },
    },
    {
      type: PopComponentType.INFERENCE,
      inferenceTypes: [InferenceType.OBJECT_DETECTION],
      modelUuid: "eyepop-person:EPPersonB1_Person_TorchScriptCuda_float32",
      categoryName: "person",
      confidenceThreshold: 0.8,
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
        },
        targets: [
          {
            type: PopComponentType.TRACING,
            reidModelUuid: "legacy:reid-mobilenetv2_x1_4_ImageNet_TensorFlowLite_int8",
            forward: {
              operator: {
                type: ForwardOperatorType.CROP,
                crop: {
                  boxPadding: 0.1,
                },
              },
              targets: [
                {
                  type: PopComponentType.INFERENCE,
                  inferenceTypes: [InferenceType.KEY_POINTS],
                  categoryName: "2d-body-points",
                  modelUuid: "Mediapipe:MoveNet_SinglePose_Thunder_MoveNet_TensorFlowLite_float32",
                },
              ],
            },
          },
        ],
      },
    },
  ],
};

const OBJECT_SEGMENTATION = {
  components: [
    {
      type: PopComponentType.INFERENCE,
      inferenceTypes: [InferenceType.OBJECT_DETECTION],
      modelUuid: "yolov7:YOLOv7-TINY_COCO_TensorFlowLite_float32", // replace with your own model uuid
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
          crop: {
            boxPadding: 0.25,
          },
        },
        targets: [
          {
            type: PopComponentType.INFERENCE,
            inferenceTypes: [InferenceType.SEMANTIC_SEGMENTATION],
            modelUuid: "legacy:EfficientSAM_Sm_Grounded_TorchScript_float32",
            forward: {
              operator: {
                type: ForwardOperatorType.FULL,
              },
              targets: [
                {
                  type: PopComponentType.CONTOUR_FINDER,
                  contourType: ContourType.POLYGON,
                },
              ],
            },
          },
        ],
      },
    },
  ],
};

(async () => {
  let example_input;
  if (URL.canParse(example_image)) {
    example_input = { url: example_image };
  } else {
    example_input = { path: example_image };
  }
  const image = await loadImage(example_image);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");

  const endpoint = await EyePop.workerEndpoint({
    popId: TransientPopId.Transient,
    logger: logger,
  })
    .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
      logger.info("Endpoint changed state %s -> %s", fromState, toState);
    })
    .connect();
  try {
    await endpoint.changePop(OBJECT_PLUS_PERSON);
    let results = await endpoint.process(example_input);
    for await (let result of results) {
      logger.info("result: %s", JSON.stringify(result));
      canvas.width = result.source_width;
      canvas.height = result.source_height;
      context.drawImage(image, 0, 0);
      Render2d.renderer(context, [Render2d.renderPose(), Render2d.renderText(), Render2d.renderContour()]).draw(result);
    }
    const tmp_dir = mkdtempSync(join(tmpdir(), "ep-demo-"));
    const temp_file = join(tmp_dir, "out.png");
    logger.info(`creating temp file: %s`, temp_file);

    const buffer = canvas.toBuffer("image/png");
    writeFileSync(temp_file, buffer);

    open(`file://${temp_file}`);
  } catch (e) {
    console.error(e);
  } finally {
    await endpoint.disconnect();
  }
})();
