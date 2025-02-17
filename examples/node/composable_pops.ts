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
    {
      type: PopComponentType.INFERENCE,
      model: "eyepop.person:latest",
      categoryName: "person",
      confidenceThreshold: 0.8,
      forward: {
        operator: {
          type: ForwardOperatorType.CROP,
          crop: {
            maxItems: 128
          },
        },
        targets: [
          {
            type: PopComponentType.TRACING,
            reidModel: "eyepop.person.reid:latest",
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
                  categoryName: "2d-body-points",
                  model: "eyepop.person.2d-body-points:latest"
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
      model: "eyepop.coco.yolov7-tiny:latest",
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
            model: "eyepop.sam.small:latest",
            forward: {
              operator: {
                type: ForwardOperatorType.FULL,
              },
              targets: [
                {
                  type: PopComponentType.CONTOUR_FINDER,
                  contourType: ContourType.POLYGON,
                  areaThreshold: 0.005
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
    logger: logger,
  })
    .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
      logger.info("Endpoint changed state %s -> %s", fromState, toState);
    })
    .connect();
  try {
    await endpoint.changePop(OBJECT_SEGMENTATION);
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
