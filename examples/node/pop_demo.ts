import {
  ComponentParams,
  ContourType,
  EndpointState,
  EyePop,
  ForwardOperatorType,
  PopComponentType,
} from '@eyepop.ai/eyepop'
import { Render2d } from "@eyepop.ai/eyepop-render-2d";

import { createCanvas, loadImage } from "canvas";
import { open } from "openurl";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { pino } from "pino";

import { parseArgs } from 'node:util';
import process from "process";
import { BaseComponent, MotionModel, TrackingComponent } from 'EyePop/worker/worker_types'

const POP_EXAMPLES = {
  "person": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.person:latest',
    categoryName: 'person'
  }]},

  "2d-body-points": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.person:latest',
    categoryName: 'person',
    forward: {
      operator: {
        type: ForwardOperatorType.CROP,
        crop: {
          maxItems: 128
        }
      },
      targets: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.person.2d-body-points:latest',
        categoryName: '2d-body-points',
        confidenceThreshold: 0.25
      }]
    }
  }]},

  "faces": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.person:latest',
    categoryName: 'person',
    forward: {
      operator: {
        type: ForwardOperatorType.CROP,
        crop: {
          maxItems: 128
        }
      },
      targets: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.person.face.short-range:latest',
        categoryName: '2d-face-points',
        forward: {
          operator: {
            type: ForwardOperatorType.CROP,
            crop: {
              boxPadding: 1.5,
              orientationTargetAngle: -90.0,
            }
          },
          targets: [{
            type: PopComponentType.INFERENCE,
            model: 'eyepop.person.face-mesh:latest',
            categoryName: '3d-face-mesh'
          }]
        }
      }]
    }
  }]},

  "hands": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.person:latest',
    categoryName: 'person',
    forward: {
      operator: {
        type: ForwardOperatorType.CROP,
        crop: {
          boxPadding: 0.25,
          maxItems: 128,
        }
      },
      targets: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.person.palm:latest',
        forward: {
          operator: {
            type: ForwardOperatorType.CROP,
            crop: {
              includeClasses: ['hand circumference'],
              orientationTargetAngle: -90.0,
            }
          },
          targets: [{
            type: PopComponentType.INFERENCE,
            model: 'eyepop.person.3d-hand-points:latest',
            categoryName: '3d-hand-points'
          }]
        }
      }]
    }
  }]},

  "3d-body-points": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.person:latest',
    categoryName: 'person',
    forward: {
      operator: {
        type: ForwardOperatorType.CROP,
        crop: {
          boxPadding: 0.5
        }
      },
      targets: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.person.pose:latest',
        hidden: true,
        forward: {
          operator: {
            type: ForwardOperatorType.CROP,
            crop: {
              boxPadding: 0.5,
              orientationTargetAngle: -90.0,
            }
          },
          targets: [{
            type: PopComponentType.INFERENCE,
            model: 'eyepop.person.3d-body-points.heavy:latest',
            categoryName: '3d-body-points',
            confidenceThreshold: 0.25
          }]
        }
      }]
    }
  }]},

  "text": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.text:latest',
    categoryName: 'text',
    forward: {
      operator: {
        type: ForwardOperatorType.CROP,
      },
      targets: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.text.recognize.square:latest'
      }]
    }
  }]},

  "sam1": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.sam.small:latest',
    id: 1,
    forward: {
      operator: {
        type: ForwardOperatorType.FULL,
      },
      targets: [{
        type: PopComponentType.CONTOUR_FINDER,
        contourType: ContourType.POLYGON,
        areaThreshold: 0.005
      }]
    }
  }]},

  "sam2": { components: [{
    type: PopComponentType.INFERENCE,
    model: 'eyepop.sam2.encoder.tiny:latest',
    hidden: true,
    forward: {
      targets: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.sam2.decoder:latest',
        id: 1,
        forward: {
          operator: {
            type: ForwardOperatorType.FULL,
          },
          targets: [{
            type: PopComponentType.CONTOUR_FINDER,
            contourType: ContourType.POLYGON,
            areaThreshold: 0.005
          }]
        }
      }]
    }
  }]},

  "image-contents": { components: [{
    type: PopComponentType.INFERENCE,
    id: 1,
    ability: 'eyepop.image-contents:latest',
  }]},

  "localize-objects": { components: [{
    type: PopComponentType.INFERENCE,
    id: 1,
    ability: 'eyepop.localize-objects:latest',
  }]},
}
const logger = pino({ level: "debug", name: "eyepop-example" });

const { positionals, values } = parseArgs({
  options: {
    localPath: {
      type: "string",
      short: "l"
    },
    assetUuid: {
      type: "string",
      short: "a"
    },
    url: {
      type: "string",
      short: "u"
    },
    pop: {
      type: "string",
      short: "p"
    },
    modelUuid: {
      type: "string",
      short: "m"
    },
    abilityUuid: {
      type: "string",
      short: "a"
    },
    model: {
      type: "string",
    },
    ability: {
      type: "string",
    },
    sam1: {
      type: "string",
      short: "1"
    },
    sam2: {
      type: "string",
      short: "2"
    },
    visualize: {
      type: "boolean",
      short: "v",
      default: false
    },
    output: {
      type: "boolean",
      short: "o",
      default: false
    },
    points: {
      type: "string",
    },
    boxes: {
      type: "string",
    },
    prompt: {
      type: "string",
      multiple: true
    },
    topK: {
      type: "string",
      default: ""
    },
    confidenceThreshold: {
      type: "string",
      default: ""
    },
    tracking: {
      type: "boolean",
      default: false
    },
    trackingReidModel: {
      type: "string"
    },
    trackingAgnostic: {
      type: "boolean",
      default: false
    },
    trackingMaxAge: {
      type: "string",
    },
    trackingIoUThreshold: {
      type: "string",
    },
    trackingSimThreshold: {
      type: "string",
    },
    trackingMotionModel: {
      type: "string",
    },
    help: {
      type: "boolean",
      short: "h",
      default: false
    }
  },
});

function printHelpAndExit(message?: string, exitCode: number = -1) {
    if (message) {
      console.error(message);

    }
    console.info("EyePop example, usage: " +
        "\n\t-l or --localPath=[path] to run inference on a local image file" +
        "\n\t-a or --assetUuid=[uuid] to run inference on a asset by its Uuid" +
        "\n\t-u --url=[url] to run inference on a remote image url" +
        "\n\t-p --pop=[pop] to run one of the example pos, one of "+Object.keys(POP_EXAMPLES)+
        "\n\t-m --modelUuid=[model uuid] to run inference using a specific model uuid" +
        "\n\t--model=[model] to run inference using a specific model alias" +
        "\n\t-a --abilityUuid=[ability uuid] to run inference using a specific ability uuid" +
        "\n\t--ability=[ability] to run inference using a specific ability alias" +
        "\n\t-1 --sam1 to compose a model given by --model with segmentation using Efficient SAM" +
        "\n\t-2 --sam2 to compose a model given by --model with segmentation using SAM2" +
        "\n\t--points list of POIs as coordinates like (x1, y1), (x2, y2) in the original image coordinate system" +
        "\n\t--boxes list of POIs as boxes like (left1, top1, right1, bottom1), (left1, top1, right1, bottom1) in the original image coordinate system" +
        "\n\t--prompt text prompt to pass as parameter" +
        "\n\t--top-k for --model-uuid and -model-alias apply this top-k filter" +
        "\n\t--confidence-threshold for --model-uuid and -model-alias apply this confidence threshold filter" +
        "\n\t--tracking to track objects in videos" +
        "\n\t--trackingReidModel=[uuid] Use re-id model uuid for tracking" +
        "\n\t--trackingAgnostic Track objects class-agnostic" +
        "\n\t--trackingMaxAge=[secs] Max age in seconds for unmatched tracks" +
        "\n\t--trackingIoUThreshold=[threshold 0...1] IoU threshold to match tracks" +
        "\n\t--trackingSimThreshold=[threshold 0...1] Similarity threshold to match tracks by re-id" +
        "\n\t--trackingMotionModel=[random_walk|constant_velocity|constant_acceleration] specify which motion model to use in tracking" +
        "\n\t-v --visualize to visualize the result" +
        "\n\t-o --output to print the result to stdout" +
        "\n\t-h --help to print this help message")
    process.exit(exitCode);
}

function list_of_points(arg: string) {
  const points_as_tuples = eval(`[${arg.replace('(', '[').replace(')', ']')}]`)
  let points: any[] = [];
  for (let tuple of points_as_tuples) {
    points.push({
      x: tuple[0],
      y: tuple[1]
    })
  }
  return points
}

function list_of_boxes(arg: string) {
  const boxes_as_tuples = eval(`[${arg.replace('(', '[').replace(')', ']')}]`)
  let boxes: any[] = []
  for (let tuple of boxes_as_tuples) {
    boxes.push({
      topLeft: {
        x: tuple[0],
        y: tuple[1],
      },
      bottomRight: {
        x: tuple[2],
        y: tuple[3],
      }
    })
  }
  return boxes
}

(async (parameters=values) => {
  if (parameters.help) {
    printHelpAndExit(undefined, 0);
  }
  let pop;

  const topK = (parameters.topK && parameters.topK.length? parseInt(parameters.topK): undefined)
  const confidenceThreshold = (parameters.confidenceThreshold && parameters.confidenceThreshold.length? parseFloat(parameters.confidenceThreshold): undefined)
  const ability = parameters.ability? parameters.ability: (parameters.model? parameters.model: undefined)
  const abilityUuid = parameters.abilityUuid? parameters.abilityUuid: (parameters.modelUuid? parameters.modelUuid: undefined)
  let trackingComponent: TrackingComponent | undefined = undefined
  if (parameters.tracking) {
    trackingComponent = {
        type: PopComponentType.TRACKING,
        agnostic: parameters.trackingAgnostic? parameters.trackingAgnostic: false,
    }
    if (parameters.trackingMaxAge !== undefined) {
        trackingComponent.maxAgeSeconds = parseFloat(parameters.trackingMaxAge)
    }
    if (parameters.trackingReidModel !== undefined) {
        trackingComponent.reidModel = parameters.trackingReidModel
    }
    if (parameters.trackingIoUThreshold !== undefined) {
        trackingComponent.iouThreshold = parseFloat(parameters.trackingIoUThreshold)
    }
    if (parameters.trackingSimThreshold !== undefined) {
        trackingComponent.simThreshold = parseFloat(parameters.trackingSimThreshold)
    }
    if (parameters.trackingMotionModel !== undefined) {
        trackingComponent.motionModel = MotionModel[parameters.trackingMotionModel as keyof typeof MotionModel]
    }
  }
  if (ability || abilityUuid) {
    if (parameters.sam1) {
      pop = {components: [{
          type: PopComponentType.INFERENCE,
          ability: ability,
          abilityUuid: abilityUuid,
          topK: topK,
          confidenceThreshold: confidenceThreshold,
          forward: {
            operator: {
              type: ForwardOperatorType.CROP,
            },
            targets: [{
              type: PopComponentType.INFERENCE,
              model: 'eyepop.sam.small:latest',
              forward: {
                operator: {
                  type: ForwardOperatorType.FULL,
                },
                targets: [{
                  type: PopComponentType.CONTOUR_FINDER,
                  contourType: ContourType.POLYGON,
                  areaThreshold: 0.005
                }]
              }
            }]
          }
        }]}
    } else if (parameters.sam2) {
      pop = { components: [{
        type: PopComponentType.INFERENCE,
        model: 'eyepop.sam2.encoder.tiny:latest',
        hidden: true,
        forward: {
          targets: [{
            type: PopComponentType.INFERENCE,
            ability: ability,
            abilityUuid: abilityUuid,
            topK: topK,
            confidenceThreshold: confidenceThreshold,
            forward: {
              operator: {
                type: ForwardOperatorType.CROP,
              },
              targets: [{
                type: PopComponentType.INFERENCE,
                model: 'eyepop.sam2.decoder:latest',
                forward: {
                  operator: {
                    type: ForwardOperatorType.FULL,
                  },
                  targets: [{
                    type: PopComponentType.CONTOUR_FINDER,
                    contourType: ContourType.POLYGON,
                    areaThreshold: 0.005
                  }]
                }
              }]
            }
          }]
        }
      }]}
    } else {
      pop = { components: [{
        type: PopComponentType.INFERENCE,
        ability: ability,
        abilityUuid: abilityUuid,
        topK: topK,
        confidenceThreshold: confidenceThreshold,
      }]}
      if (trackingComponent) {
          (pop.components[0] as BaseComponent).forward = {
            operator: {
              type: ForwardOperatorType.CROP,
            },
            targets: [trackingComponent]
        }
      }
    }
  } else if (parameters.pop) {
    if (POP_EXAMPLES.hasOwnProperty(parameters.pop)) {
      // @ts-ignore
      pop = POP_EXAMPLES[parameters.pop];
    } else {
      printHelpAndExit(`unknown pop ${parameters.pop}`);
    }
  } else {
    printHelpAndExit("required: --modelUuid --abilityUuid or --model or --ability or --pop");
  }
  console.log(JSON.stringify(pop, undefined, 2))
  let example_input;
  let image = null;
  if (parameters.url) {
    if (parameters.visualize) {
        image = await loadImage(parameters.url);
    }
    example_input = {url: parameters.url};
  } else if (parameters.localPath) {
    if (parameters.visualize) {
      image = await loadImage(parameters.localPath);
    }
    example_input = {path: parameters.localPath};
  } else if (parameters.assetUuid) {
    if (parameters.visualize) {
        const dataEndpoint = await EyePop.dataEndpoint().connect();
        try {
            const imageBlob = await dataEndpoint.downloadAsset(parameters.assetUuid);
            image = await loadImage(Buffer.from(await imageBlob.arrayBuffer()));
        } finally {
            await dataEndpoint.disconnect();
        }
    }
    example_input = {assetUuid: parameters.assetUuid};
  } else {
    printHelpAndExit("required: --localPath or --url or --assetUuid");
    process.exit(-1);
  }

  let sourceParams: ComponentParams[] | undefined = undefined;
  if (parameters.points) {
    sourceParams = [{
      componentId: 1,
      values: {
        roi: {
          points: list_of_points(parameters.points)
        }
      }
    }]
  } else if (parameters.boxes) {
    sourceParams = [{
      componentId: 1,
      values: {
        roi: {
          boxes: list_of_boxes(parameters.boxes)
        }
      }
    }]
  } else if (parameters.prompt) {
    sourceParams = [{
      componentId: 1,
      values: {
        prompts: parameters.prompt.map((prompt) => {return {prompt: prompt}})
      }
    }]
  }

  const canvas = image? createCanvas(image.width, image.height): undefined;
  const context = canvas? canvas.getContext("2d"): undefined;

  const endpoint = await EyePop.workerEndpoint({
    logger: logger,
  })
    .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
      logger.debug("Endpoint changed state %s -> %s", fromState, toState);
    })
    .connect();
  try {
    await endpoint.changePop(pop);
    let results = await endpoint.process(example_input, sourceParams);
    for await (let result of results) {
      if (parameters.output) {
        console.info(JSON.stringify(result, undefined, 2));
      }
      if (parameters.visualize && canvas && context && image) {
        canvas.width = result.source_width;
        canvas.height = result.source_height;
        context.drawImage(image, 0, 0);
        Render2d.renderer(context, [
            Render2d.renderPose(),
            Render2d.renderText(),
            Render2d.renderContour(),
            Render2d.renderBox()
        ]).draw(result);
      }
    }
    if (parameters.visualize && canvas) {
      const tmp_dir = mkdtempSync(join(tmpdir(), "ep-demo-"));
      const temp_file = join(tmp_dir, "out.png");
      logger.info(`creating temp file: %s`, temp_file);

      const buffer = canvas.toBuffer("image/png");
      writeFileSync(temp_file, buffer);

      open(`file://${temp_file}`);
    }
  } catch (e) {
    logger.error(e);
  } finally {
    await endpoint.disconnect();
  }
})();
