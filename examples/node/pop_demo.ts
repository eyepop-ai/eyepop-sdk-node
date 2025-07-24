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

  // "image-contents": { components: [{
  //   type: PopComponentType.INFERENCE,
  //   id: 1,
  //   ability: 'eyepop.image-contents:latest',
  // }]},

  "image-contents": { components: [
    {
      // type: PopComponentType.INFERENCE,
      // id: 1,
      // // ability: 'eyepop.image-contents:latest',
      // ability: 'eyepop.localize-objects:latest',
      // params: {
      //   prompts: [
      //     {
      //       prompt: "person"
      //     }
      //   ]
      // },
      type: PopComponentType.INFERENCE,
      // id: 1,
      // ability: 'ci-eyepop.localize-objects:latest',
      // ability: 'ci-eyepop.image-contents:latest',
      // ability: 'ci-eyepop.image-captions:latest',
      ability: 'eyepop.text-contents:latest',
      // params: {
      //   prompts: [
      //     {
      //       // prompt: "person"
      //       // prompt: "Analyze the image provided and determine the categories of: What color is their shirt?. Report the values of the categories as classLabels. If you are unable to provide a category with a value then set it's classLabel to null"
      //       prompt: "Describe with a paragraph what is shown in the image."
      //     },
      //     // {
      //     //   prompt: "hat"
      //     // }
      //   ]
      // },

      // forward: {
      //   operator: {
      //     type: ForwardOperatorType.CROP,
      //     // crop: {
      //     //   maxItems: 1
      //     // }
      //   },
      //   targets: [
      //     {
      //       type: PopComponentType.INFERENCE,
      //       ability: "eyepop.image-contents-t4:latest",
      //       params: {
      //         prompts: [
      //           {
      //             prompt: "Analyze the image provided and determine the categories of: shirt color,Hair color. Report the values of the categories as classLabels. If you are unable to provide a category with a value then set it's classLabel to null"
      //           }
      //         ]
      //       }
      //     }
      //   ]
      // } 

    }
  ]},

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
        "\n\t-1 --sam1 to compose a model given by --model with segmentation using Efficient SAM" +
        "\n\t-2 --sam2 to compose a model given by --model with segmentation using SAM2" +
        "\n\t--points list of POIs as coordinates like (x1, y1), (x2, y2) in the original image coordinate system" +
        "\n\t--boxes list of POIs as boxes like (left1, top1, right1, bottom1), (left1, top1, right1, bottom1) in the original image coordinate system" +
        "\n\t--prompt text prompt to pass as parameter" +
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

  if (parameters.modelUuid) {
    if (parameters.sam1) {
      pop = {
        components: [{
          type: PopComponentType.INFERENCE,
          modelUuid: parameters.modelUuid,
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
        }]
      };
    } else if (parameters.sam2) {
      pop = {
        type: PopComponentType.INFERENCE,
        model: 'eyepop.sam2.encoder.tiny:latest',
        hidden: true,
        forward: {
          targets: [{
            type: PopComponentType.INFERENCE,
            modelUuid: parameters.modelUuid,
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
      }
    } else {
      pop = {
        type: PopComponentType.INFERENCE,
        modelUuid: parameters.modelUuid
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
    printHelpAndExit("required: --modelUuid or --pop");
  }

  let example_input;
  let image = null;
  if (parameters.url) {
    image = await loadImage(parameters.url);
    example_input = {url: parameters.url};
  } else if (parameters.localPath) {
    image = await loadImage(parameters.localPath);
    example_input = {path: parameters.localPath};
  } else if (parameters.assetUuid) {
    const dataEndpoint = await EyePop.dataEndpoint().connect();
    try {
      const imageBlob = await dataEndpoint.downloadAsset(parameters.assetUuid);
      image = await loadImage(Buffer.from(await imageBlob.arrayBuffer()));
    } finally {
      await dataEndpoint.disconnect();
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

  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");

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
    if (parameters.visualize) {
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
