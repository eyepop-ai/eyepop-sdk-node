import { Area, BaseComponent, Camera, CameraExtrinsics, CameraIntrinsics, ComponentParams, ContourType, EndpointState, EyePop, ForwardOperatorType, InferenceComponent, MotionDetectConfig, MotionModel, Pop, PointCloud, PopComponent, PopComponentType, PopDepthMap, Quaternion, TrackingComponent, Vector3, Vector3d, cloudOfDepth, cloudOfObject } from '@eyepop.ai/eyepop'
import { POSE_CONNECTIONS, Render2d } from "@eyepop.ai/eyepop-render-2d";

import { createCanvas, loadImage } from "canvas";
import { open } from "openurl";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { pino } from "pino";

import { parseArgs } from 'node:util';
import process from "process";
import { AreaType } from 'EyePop/data/data_types'

// The depth ability used when --toWorld is asked for on its own. Must be a
// metric one: a 'relative' map is accepted and silently yields no coordinates,
// because relative depth is scale- AND shift-invariant, so a cloud recovered
// from it would be distorted rather than merely unscaled.
const DEFAULT_DEPTH_ABILITY = 'eyepop.depth.large:latest'

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

  "depth": { components: [{
    type: PopComponentType.INFERENCE,
    id: 1,
    ability: 'eyepop.depth.large:latest',
  }]},
}
const logger = pino({ level: "debug", name: "eyepop-example" });

const { positionals, values } = parseArgs({
    options: {
        localPath: {
            type: 'string',
            short: 'l',
        },
        assetUuid: {
            type: 'string',
            short: 'a',
        },
        url: {
            type: 'string',
            short: 'u',
        },
        session_uuid: {
            type: 'string',
            short: 's',
        },
        pop: {
            type: 'string',
            short: 'p',
        },
        modelUuid: {
            type: 'string',
            short: 'm',
        },
        abilityUuid: {
            type: 'string',
            short: 'a',
        },
        model: {
            type: 'string',
        },
        ability: {
            type: 'string',
        },
        sam1: {
            type: 'string',
            short: '1',
        },
        sam2: {
            type: 'string',
            short: '2',
        },
        visualize: {
            type: 'boolean',
            short: 'v',
            default: false,
        },
        output: {
            type: 'boolean',
            short: 'o',
            default: false,
        },
        points: {
            type: 'string',
        },
        boxes: {
            type: 'string',
        },
        prompt: {
            type: 'string',
            multiple: true,
        },
        topK: {
            type: 'string',
            default: '',
        },
        confidenceThreshold: {
            type: 'string',
            default: '',
        },
        motionDetect: {
            type: 'boolean',
            default: false,
        },
        fps: {
            type: 'string',
        },
        tracking: {
            type: 'boolean',
            default: false,
        },
        trackingReidModel: {
            type: 'string',
        },
        trackingAgnostic: {
            type: 'boolean',
            default: false,
        },
        trackingMaxAge: {
            type: 'string',
        },
        trackingIoUThreshold: {
            type: 'string',
        },
        trackingSimThreshold: {
            type: 'string',
        },
        trackingMotionModel: {
            type: 'string',
        },
        roi: {
            type: 'string',
        },
        toWorld: {
            type: 'boolean',
            short: 'w',
            default: false,
        },
        depthMapToWorld: {
            type: 'boolean',
            default: false,
        },
        depthMapAbility: {
            type: 'string',
        },
        depthMapAbilityUuid: {
            type: 'string',
        },
        cameraHfovDegrees: {
            type: 'string',
        },
        cameraIntrinsics: {
            type: 'string',
        },
        cameraRotation: {
            type: 'string',
        },
        cameraTranslation: {
            type: 'string',
        },
        worldOut: {
            type: 'string',
        },
        help: {
            type: 'boolean',
            short: 'h',
            default: false,
        },
        depthMapOpacity: {
            type: 'string',
            default: '0.5',
        }
    },
})

function printHelpAndExit(message?: string, exitCode: number = -1) {
    if (message) {
      console.error(message);

    }
    console.info(
        'EyePop example, usage: ' +
            '\n\t-l or --localPath=[path] to run inference on a local image file' +
            '\n\t-a or --assetUuid=[uuid] to run inference on a asset by its Uuid' +
            '\n\t-u --url=[url] to run inference on a remote image url' +
            '\n\t-s --session-uuid=[SESSION UUID] to use a permanent session' +
            '\n\t-p --pop=[pop] to run one of the example pos, one of ' +
            Object.keys(POP_EXAMPLES) +
            '\n\t-m --modelUuid=[model uuid] to run inference using a specific model uuid' +
            '\n\t--model=[model] to run inference using a specific model alias' +
            '\n\t-a --abilityUuid=[ability uuid] to run inference using a specific ability uuid' +
            '\n\t--ability=[ability] to run inference using a specific ability alias' +
            '\n\t-1 --sam1 to compose a model given by --model with segmentation using Efficient SAM' +
            '\n\t   (the depth example defaults to eyepop.depth.large; the small and *-landscape variants trade cost for aspect fit)' +
            '\n\t-2 --sam2 to compose a model given by --model with segmentation using SAM2' +
            '\n\t--points list of POIs as coordinates like (x1, y1), (x2, y2) in the original image coordinate system' +
            '\n\t--boxes list of POIs as boxes like (left1, top1, right1, bottom1), (left1, top1, right1, bottom1) in the original image coordinate system' +
            '\n\t--prompt text prompt to pass as parameter' +
            '\n\t--top-k for --model-uuid and -model-alias apply this top-k filter' +
            '\n\t--confidence-threshold for --model-uuid and -model-alias apply this confidence threshold filter' +
            '\n\t--motionDetect to activate motion detection' +
            '\n\t--roi Rectangular ROI as (x, y, width, height)' +
            '\n\t--fps FPS throttle for video sources' +
            '\n\t--tracking to track objects in videos' +
            '\n\t--trackingReidModel=[uuid] Use re-id model uuid for tracking' +
            '\n\t--trackingAgnostic Track objects class-agnostic' +
            '\n\t--trackingMaxAge=[secs] Max age in seconds for unmatched tracks' +
            '\n\t--trackingIoUThreshold=[threshold 0...1] IoU threshold to match tracks' +
            '\n\t--trackingSimThreshold=[threshold 0...1] Similarity threshold to match tracks by re-id' +
            '\n\t--trackingMotionModel=[random_walk|constant_velocity|constant_acceleration] specify which motion model to use in tracking' +
            '\n\t-w --toWorld translate this pop\'s point based predictions into world coordinates in metres, back-projected through a depth map' +
            '\n\t--depthMapToWorld back-project the depth map itself, so the results carry a point cloud of the whole scene rather than one per segmented object.' +
            '\n\t   Also what reveals the map: without it the depth branch stays out of the response. Stands on its own, with or without --toWorld' +
            '\n\t--depthMapAbility=[ability] depth ability supplying the map to back-project through, default ' + DEFAULT_DEPTH_ABILITY +
            '\n\t   (must be a metric one; a \'relative\' ability is accepted and silently yields no coordinates)' +
            '\n\t--depthMapAbilityUuid=[uuid] depth ability by uuid, instead of --depthMapAbility' +
            '\n\t--cameraHfovDegrees=[degrees] source\'s horizontal field of view in (0, 180). Without a calibration the worker assumes 60 degrees,' +
            '\n\t   which stretches world coordinates along the optical axis by however wrong that guess is' +
            '\n\t--cameraIntrinsics=(fx, fy, cx, cy) source\'s normalized intrinsics, fractions of the frame rather than pixels.' +
            '\n\t   Mutually exclusive with --cameraHfovDegrees' +
            '\n\t--cameraRotation=(w, x, y, z) source\'s camera-to-world rotation as a unit quaternion. With extrinsics, world coordinates come back' +
            '\n\t   in the world frame - Z up, ground at Z = 0 - instead of the camera frame. Note this is the inverse of what cv2.solvePnP returns' +
            '\n\t--cameraTranslation=(x, y, z) where the camera itself sits in the world, in metres. A camera declared 5 m up reports its scene 5 m up.' +
            '\n\t   Not solvePnP\'s tvec, which is not the camera position' +
            '\n\t--worldOut=[path.ply] write everything in the results that carries world coordinates - key points, outlines, contours,' +
            '\n\t   mask point clouds and the scene cloud - to an ASCII PLY file, in metres, one colour per series.' +
            '\n\t   Open it in MeshLab, CloudCompare or Blender to move around the scene. Needs --toWorld or --depthMapToWorld to fill them' +
            '\n\t-v --visualize to visualize the result' +
            '\n\t-o --output to print the result to stdout' +
            '\n\t-h --help to print this help message',
    )
    process.exit(exitCode);
}

// JSON.stringify replacer that summarizes large binary members (depth values,
// mask bitmaps) instead of dumping megabytes of base64 to the console
function replaceBinaryMembers(key: string, value: any): any {
    if (!value || typeof value != 'object' || !value.width || !value.height) {
        return value
    }
    // accumulated rather than returned at the first match: a depth map carries
    // its values and, once back-projected, its cloud, and returning early left
    // the second one to print in full
    let replaced = value
    if (typeof value.values == 'string') {
        replaced = { ...replaced, values: `<${value.width}x${value.height} base64 float32, ${value.values.length} chars>` }
    }
    if (typeof value.bitmap == 'string') {
        replaced = { ...replaced, bitmap: `<${value.width}x${value.height} base64 bitmap, ${value.bitmap.length} chars>` }
    }
    if (typeof value.world == 'string') {
        replaced = { ...replaced, world: `<${value.width}x${value.height} base64 xyz float32, ${value.world.length} chars>` }
    }
    return replaced
}

// The numbers in one comma separated group.
//
// Parsed rather than eval'd. An argument handed to eval runs as code with the
// process's own privileges, and an example is the worst place for that pattern:
// it gets copied into projects whose arguments do not come from the person
// running them.
function numbers_in(text: string, option: string): number[] {
  const values: number[] = []
  for (const part of text.split(',')) {
    const trimmed = part.trim()
    // Number('') is 0, so an empty part would otherwise pass as a number that
    // was never written
    if (trimmed === '' || !Number.isFinite(Number(trimmed))) {
      printHelpAndExit(`--${option} takes numbers, not ${JSON.stringify(text.trim())}`)
      return []
    }
    values.push(Number(trimmed))
  }
  return values
}

// One group per parenthesised tuple, or the whole argument as a single group
// when it has no parentheses.
function number_groups(arg: string, option: string): number[][] {
  const groups: number[][] = []
  for (const match of arg.matchAll(/\(([^()]*)\)/g)) {
    groups.push(numbers_in(match[1] as string, option))
  }
  if (groups.length === 0) {
    groups.push(numbers_in(arg, option))
  }
  return groups
}

function tuple_of_numbers(arg: string, expected: number, option: string): number[] {
  const groups = number_groups(arg, option)
  if (groups.length !== 1 || groups[0]?.length !== expected) {
    printHelpAndExit(`--${option} needs ${expected} numbers, like ${'(' + Array(expected).fill('0').join(', ') + ')'}`)
    return []
  }
  return groups[0] as number[]
}

function list_of_points(arg: string) {
  return number_groups(arg, 'points').map(values => {
    if (values.length !== 2) {
      printHelpAndExit('--points takes coordinate pairs, like (x1, y1), (x2, y2)')
    }
    return { x: values[0], y: values[1] }
  })
}

function list_of_boxes(arg: string) {
  return number_groups(arg, 'boxes').map(values => {
    if (values.length !== 4) {
      printHelpAndExit('--boxes takes boxes, like (left1, top1, right1, bottom1), (left2, top2, right2, bottom2)')
    }
    return {
      topLeft: { x: values[0], y: values[1] },
      bottomRight: { x: values[2], y: values[3] },
    }
  })
}

function rectangle_roi_area(arg: string): Area {
    const values = tuple_of_numbers(arg, 4, 'roi')
    return {
        type: AreaType.RECTANGLE,
        x: values[0] as number,
        y: values[1] as number,
        width: values[2] as number,
        height: values[3] as number
    }
}

function camera_intrinsics(arg: string): CameraIntrinsics {
  const [fx, fy, cx, cy] = tuple_of_numbers(arg, 4, 'cameraIntrinsics')
  return { fx: fx, fy: fy, cx: cx, cy: cy }
}

function camera_rotation(arg: string): Quaternion {
  const [w, x, y, z] = tuple_of_numbers(arg, 4, 'cameraRotation')
  return { w: w, x: x, y: y, z: z }
}

function camera_translation(arg: string): Vector3d {
  const [x, y, z] = tuple_of_numbers(arg, 3, 'cameraTranslation')
  return { x: x, y: y, z: z }
}

// The source calibration, or undefined to let the worker assume a field of
// view. Assuming one is a development scaffold: for canonical metric depth the
// guess cancels out of X and Y and survives only in Z, so lateral measurements
// stay exact while every distance along the optical axis is wrong by however
// wrong the guess was.
function camera_from_args(camera_args: typeof values): Camera | undefined {
  let extrinsics: CameraExtrinsics | undefined = undefined
  if (camera_args.cameraRotation !== undefined || camera_args.cameraTranslation !== undefined) {
    // either half alone is meaningful: a rotation with no translation is a
    // camera at the world origin, a translation with no rotation is one looking
    // along the world axes
    // spread rather than assigned undefined: the SDK's types are declared with
    // exactOptionalPropertyTypes, where an absent member and one explicitly set
    // to undefined are not the same thing
    extrinsics = {
      ...(camera_args.cameraRotation !== undefined ? { rotation: camera_rotation(camera_args.cameraRotation) } : {}),
      ...(camera_args.cameraTranslation !== undefined ? { translation: camera_translation(camera_args.cameraTranslation) } : {}),
    }
  }
  const pose = extrinsics !== undefined ? { extrinsics: extrinsics } : {}
  if (camera_args.cameraIntrinsics !== undefined) {
    return { intrinsics: camera_intrinsics(camera_args.cameraIntrinsics), ...pose }
  }
  if (camera_args.cameraHfovDegrees !== undefined) {
    const hfov = parseFloat(camera_args.cameraHfovDegrees)
    // the SDK refuses this too, but by throwing; the other camera flags answer
    // with the usage text, and one flag failing differently is a worse demo
    if (!(hfov > 0 && hfov < 180)) {
      printHelpAndExit('--cameraHfovDegrees needs a horizontal field of view in (0, 180) degrees')
    }
    return { hfovDegrees: hfov, ...pose }
  }
  return undefined
}

// Opt every component that can be enriched into world coordinates, returning
// how many were opted in. Walks nested forward targets so this works with the
// deeply composed examples as well as the flat ones.
//
// Only a component that runs its own inference can honour it, which is what
// gives it an id for the worker to select on; the converter rejects it on the
// others. A hidden component is skipped rather than rejected - its predictions
// never reach the response, so back-projecting them would be paid for and
// thrown away - but its forward targets are still walked, which is what an
// encoder-then-detector composition needs.
function request_world_coordinates(components: PopComponent[]): number {
  let count = 0
  for (const component of components) {
    const runsOwnInference = component.type === PopComponentType.INFERENCE || component.type === PopComponentType.TRACKING
    if (runsOwnInference && !(component as InferenceComponent).hidden) {
      component.toWorld = true
      count += 1
    }
    if (component.forward?.targets) {
      count += request_world_coordinates(component.forward.targets)
    }
  }
  return count
}

// Return a copy of the pop that asks for world coordinates. Copied rather than
// mutated because the examples are shared module level objects, and a demo that
// edits one in place would be a trap for the next reader.
function add_world_coordinates_to_pop(original: Pop, world_args: typeof values): Pop {
  const pop: Pop = JSON.parse(JSON.stringify(original))
  const depthMap: PopDepthMap = {
    ...(world_args.depthMapAbilityUuid !== undefined
      ? { abilityUuid: world_args.depthMapAbilityUuid }
      : { ability: world_args.depthMapAbility ?? DEFAULT_DEPTH_ABILITY }),
    // left out rather than set false when not asked for: false would still
    // reveal nothing, but it says the caller decided against a scene cloud
    // rather than never having mentioned one
    ...(world_args.depthMapToWorld ? { toWorld: true } : {}),
  }
  pop.depthMap = depthMap

  const enriched = world_args.toWorld ? request_world_coordinates(pop.components) : 0
  if (enriched === 0 && !world_args.depthMapToWorld) {
    // the converter rejects this rather than silently doing nothing, so say so
    // here where the reason is obvious
    logger.warn('no component in this pop can carry world coordinates, so the depth ability has nothing to enrich')
  } else {
    const askedFor = [
      ...(enriched ? [`${enriched} component(s)`] : []),
      ...(world_args.depthMapToWorld ? ['the whole scene'] : []),
    ]
    logger.info('requesting world coordinates for %s via %s', askedFor.join(' and '), depthMap.abilityUuid ?? depthMap.ability)
  }
  return pop
}

// One line on how many points came back placed, or undefined if none did.
//
// A point the worker could not place carries no world members at all - sky,
// outside the depth map, no usable map - so counting them is what tells a
// calibration that worked from one that quietly did not.
function summarize_world_coordinates(prediction: any): string | undefined {
  let placed = 0
  let unplaced = 0

  const countPoints = (points: any[] | undefined) => {
    for (const point of points ?? []) {
      if (point?.worldZ !== undefined && point?.worldZ !== null) {
        placed += 1
      } else {
        unplaced += 1
      }
    }
  }
  const walk = (obj: any) => {
    for (const keyPoints of obj.keyPoints ?? []) {
      countPoints(keyPoints.points)
    }
    countPoints(obj.outline)
    for (const contour of obj.contours ?? []) {
      countPoints(contour.points)
      for (const cutout of contour.cutouts ?? []) {
        countPoints(cutout)
      }
    }
    for (const nested of obj.objects ?? []) {
      walk(nested)
    }
  }
  // a prediction carries the same point bearing members an object does, so one
  // walk from the root covers both; walking its objects again would count the
  // whole tree twice
  walk(prediction)

  if (placed === 0 && unplaced === 0) {
    return undefined
  }
  return `world coordinates: ${placed} point(s) placed, ${unplaced} not`
}

// One colour per series so the carriers stay apart in a viewer, the way one
// legend entry per carrier does in a plot.
const WORLD_PLY_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [228, 26, 28], [55, 126, 184], [77, 175, 74], [152, 78, 163],
  [255, 127, 0], [166, 86, 40], [247, 129, 191],
]

// One labelled set of world coordinates: a skeleton, an outline, a contour, a
// mask cloud or the scene. Segments index into points.
interface WorldSeries {
  label: string
  points: Vector3[]
  segments: Array<[number, number]>
}

// The placed points of a carrier, and where each original point ended up.
//
// The map is what keeps the segments honest: unplaced points are dropped, so
// joining points by their new positions would connect across a hole as though
// the geometry ran straight through it.
interface PlacedPoints {
  points: Vector3[]
  // new index per original index, -1 where the worker placed no point
  indexOf: number[]
}

// An unplaced point carries no world members at all rather than a zero or a
// NaN - sky, outside the depth map, no usable map - so testing a coordinate for
// a number is what separates them.
function placed_points(points: any[] | undefined): PlacedPoints {
  const placed: Vector3[] = []
  const indexOf: number[] = []
  for (const point of points ?? []) {
    if (Number.isFinite(point?.worldX) && Number.isFinite(point?.worldY) && Number.isFinite(point?.worldZ)) {
      indexOf.push(placed.length)
      placed.push({ x: point.worldX, y: point.worldY, z: point.worldZ })
    } else {
      indexOf.push(-1)
    }
  }
  return { points: placed, indexOf: indexOf }
}

// The same, for a dense cloud, where an unplaced point is NaN in all three. A
// cloud is a grid rather than a path, so there is nothing to connect.
function placed_cloud_points(cloud: PointCloud): Vector3[] {
  const placed: Vector3[] = []
  for (let offset = 0; offset + 2 < cloud.points.length; offset += 3) {
    const x = cloud.points[offset] as number
    const y = cloud.points[offset + 1] as number
    const z = cloud.points[offset + 2] as number
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      placed.push({ x: x, y: y, z: z })
    }
  }
  return placed
}

// Segments joining consecutive points, closed back to the first: an outline or
// a contour is a ring in the order the worker emitted it.
//
// A pair with an unplaced point in it is skipped rather than bridged, which is
// what keeps a partially placed contour honest - an edge across the gap would
// be a line the geometry does not have.
function path_segments(placed: PlacedPoints): Array<[number, number]> {
  const segments: Array<[number, number]> = []
  const count = placed.indexOf.length
  if (count < 2) {
    return segments
  }
  for (let i = 0; i < count; i++) {
    const from = placed.indexOf[i] as number
    const to = placed.indexOf[(i + 1) % count] as number
    if (from >= 0 && to >= 0) {
      segments.push([from, to])
    }
  }
  return segments
}

// Skeleton segments for a key point group, or none for a category that has no
// skeleton.
//
// Matched by class label rather than index, mirroring the 2D renderer and using
// its table: the label is what identifies a joint, and an unrecognised category
// gets no lines at all rather than points joined in whatever order they arrived.
function pose_segments(group: any, placed: PlacedPoints): Array<[number, number]> {
  const connections = typeof group?.category === 'string' ? POSE_CONNECTIONS[group.category] : undefined
  if (!connections) {
    return []
  }
  const byLabel = new Map<string, number>()
  ;(group?.points ?? []).forEach((point: any, i: number) => {
    const index = placed.indexOf[i] ?? -1
    if (index >= 0 && typeof point?.classLabel === 'string') {
      byLabel.set(point.classLabel, index)
    }
  })
  const segments: Array<[number, number]> = []
  for (const connection of connections) {
    const from = byLabel.get(connection[0] as string)
    const to = byLabel.get(connection[1] as string)
    if (from !== undefined && to !== undefined) {
      segments.push([from, to])
    }
  }
  return segments
}

// Every set of world coordinates in a prediction, labelled.
//
// Covers every carrier the worker enriches - key points, outlines, contours
// with their cutouts, mask point clouds and the scene cloud a depthMap.toWorld
// pop returns - rather than only the clouds, so a pop that produces no masks
// still has something to write. cloudsOfPrediction() finds the clouds alone;
// the sparse carriers hold worldX/worldY/worldZ on the points themselves.
//
// Labelled by class and carrier, and numbered when a class appears more than
// once, so several objects can be told apart. Nested objects are included.
function labelled_world_points(prediction: any): WorldSeries[] {
  const series: WorldSeries[] = []
  const seen = new Map<string, number>()

  const add = (label: string, points: Vector3[], segments: Array<[number, number]>): void => {
    if (points.length) {
      series.push({ label: label, points: points, segments: segments })
    }
  }

  const walk = (objects: any[] | undefined): void => {
    for (const [index, obj] of (objects ?? []).entries()) {
      let name: string = obj?.classLabel ?? `object ${index}`
      const count = (seen.get(name) ?? 0) + 1
      seen.set(name, count)
      if (count > 1) {
        name = `${name} ${count}`
      }

      for (const group of obj?.keyPoints ?? []) {
        const placed = placed_points(group?.points)
        add(`${name} keypoints`, placed.points, pose_segments(group, placed))
      }
      const outline = placed_points(obj?.outline)
      add(`${name} outline`, outline.points, path_segments(outline))
      for (const contour of obj?.contours ?? []) {
        const points = placed_points(contour?.points)
        add(`${name} contour`, points.points, path_segments(points))
        for (const cutout of contour?.cutouts ?? []) {
          const hole = placed_points(cutout)
          add(`${name} cutout`, hole.points, path_segments(hole))
        }
      }
      const cloud = cloudOfObject(obj)
      if (cloud !== undefined) {
        add(`${name} mask`, placed_cloud_points(cloud), [])
      }

      walk(obj?.objects)
    }
  }

  // a prediction carries key point groups of its own, for the abilities that
  // produce them without an enclosing object
  for (const group of prediction?.keyPoints ?? []) {
    const placed = placed_points(group?.points)
    add('keypoints', placed.points, pose_segments(group, placed))
  }
  walk(prediction?.objects)

  // last, so the objects a viewer came to look at are not buried under a scene
  // cloud two orders of magnitude larger
  const scene = cloudOfDepth(prediction?.depth, prediction?.source_width, prediction?.source_height)
  if (scene !== undefined) {
    add('scene', placed_cloud_points(scene), [])
  }
  return series
}

// A coordinate, rounded to a tenth of a millimetre.
//
// Two reasons, both about the file rather than the measurement: printing a
// float32 widened to a double spells 0.1 as 0.10000000149011612, and a scene
// cloud is one point per depth map pixel, so those extra digits cost megabytes.
// No depth model resolves anywhere near this finely.
function metres(value: number): number {
  return Number(value.toFixed(4))
}

// Write the series as one ASCII PLY in metres, returning how many points were
// written.
//
// A PLY has no notion of a series, so the colours alone would say only that the
// points came from different carriers. The labels go in as header comments,
// which is the nearest thing the format has to a legend and which every viewer
// ignores safely.
function write_world_ply(series: WorldSeries[], path: string): number {
  const vertices: string[] = []
  const edges: string[] = []
  const legend: string[] = []
  series.forEach((entry, index) => {
    const colour = WORLD_PLY_COLOURS[index % WORLD_PLY_COLOURS.length] as readonly [number, number, number]
    // a class label is model supplied text, and a newline in one would end the
    // comment early and corrupt the header
    const label = entry.label.replace(/\s+/g, ' ')
    legend.push(`comment ${label}: ${entry.points.length} point(s), rgb ${colour[0]} ${colour[1]} ${colour[2]}`)
    // segments index within their own series; the file numbers every vertex
    // from the start of the file
    const base = vertices.length
    for (const point of entry.points) {
      vertices.push(`${metres(point.x)} ${metres(point.y)} ${metres(point.z)} ${colour[0]} ${colour[1]} ${colour[2]}`)
    }
    for (const segment of entry.segments) {
      edges.push(`${base + segment[0]} ${base + segment[1]} ${colour[0]} ${colour[1]} ${colour[2]}`)
    }
  })
  const header = [
    'ply',
    'format ascii 1.0',
    'comment EyePop world coordinates, metres',
    ...legend,
    `element vertex ${vertices.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
  ]
  // declared only when there are edges: a scene cloud has none, and viewers
  // vary in what they make of an empty element
  if (edges.length) {
    header.push(
      `element edge ${edges.length}`,
      'property int vertex1',
      'property int vertex2',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
    )
  }
  header.push('end_header')
  writeFileSync(path, header.concat(vertices).concat(edges).join('\n') + '\n')
  return vertices.length
}

(async (parameters=values) => {
  if (parameters.help) {
    printHelpAndExit(undefined, 0);
  }

  if (parameters.cameraIntrinsics !== undefined && parameters.cameraHfovDegrees !== undefined) {
    // rejected rather than resolved by precedence: two descriptions of one lens
    // that disagree have no right answer
    printHelpAndExit("pass either --cameraIntrinsics or --cameraHfovDegrees, not both");
  }
  if ((parameters.cameraRotation !== undefined || parameters.cameraTranslation !== undefined)
      && parameters.cameraIntrinsics === undefined && parameters.cameraHfovDegrees === undefined) {
    // a pose says where the camera is, not what it sees; the worker rejects a
    // calibration that describes no lens, so say so here where the fix is obvious
    printHelpAndExit("--cameraRotation and --cameraTranslation describe a pose, not a lens; pass --cameraIntrinsics or --cameraHfovDegrees as well");
  }
  if ((parameters.depthMapAbility !== undefined || parameters.depthMapAbilityUuid !== undefined)
      && !(parameters.toWorld || parameters.depthMapToWorld)) {
    printHelpAndExit("--depthMapAbility needs --toWorld or --depthMapToWorld; a depth ability nothing asked to use is rejected as a bad pop rather than silently doing nothing");
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
  } else if (parameters.depthMapToWorld) {
    // a complete pop on its own: the depth map is the only consumer, so there is
    // nothing for a component to do and none has to be named
    pop = { components: [] }
  } else if (!parameters.session_uuid) {
    printHelpAndExit("required: --modelUuid --abilityUuid or --model or --ability or --pop pt --session-uuid or --depthMapToWorld");
  }

  if (parameters.toWorld || parameters.depthMapToWorld) {
    if (!pop) {
      printHelpAndExit("world coordinates cannot be added to a preconfigured session; pass a pop or a model");
    }
    pop = add_world_coordinates_to_pop(pop as Pop, parameters)
  }

  const camera = camera_from_args(parameters)
  if ((parameters.toWorld || parameters.depthMapToWorld) && camera === undefined) {
    logger.warn("no camera calibration supplied, so the worker assumes a 60 degree horizontal field of "
      + "view; lateral measurements are exact but depth is only as right as that guess. Pass "
      + "--cameraHfovDegrees to turn the guess into a measurement")
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
            const imageBlob = await dataEndpoint.downloadAsset(parameters.assetUuid) as Blob;
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

  let worldSeries: WorldSeries[] = [];

  const canvas = image? createCanvas(image.width, image.height): undefined;
  const context = canvas? canvas.getContext("2d"): undefined;

  const endpoint = await EyePop.workerEndpoint({
    logger: logger,
    sessionUuid: parameters.session_uuid
  })
    .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
      logger.debug("Endpoint changed state %s -> %s", fromState, toState);
    })
    .connect();
  try {
    if (pop) {
        await endpoint.changePop(pop);
    }
    const results = await endpoint.process({
        source: example_input,
        componentParams: sourceParams,
        motionDetect: parameters.motionDetect ? { motionDetect: true } : undefined,
        roi: parameters.roi ? rectangle_roi_area(parameters.roi) : undefined,
        fps: parameters.fps ?? undefined,
        camera: camera
    })
    for await (let result of results) {
      if (parameters.output) {
        console.info(JSON.stringify(result, replaceBinaryMembers, 2));
        const world = summarize_world_coordinates(result);
        if (world !== undefined) {
          console.info(world);
        }
      }
      if (parameters.worldOut) {
        // the last prediction that carried any, rather than every frame merged:
        // a video source moves between frames and supplies no per-frame pose, so
        // stacking them into one static cloud would smear the scene
        const series = labelled_world_points(result);
        if (series.length) {
          worldSeries = series;
        }
      }
      if (parameters.visualize && canvas && context && image) {
        canvas.width = result.source_width;
        canvas.height = result.source_height;
        context.drawImage(image, 0, 0);
        Render2d.renderer(context, [
            Render2d.renderDepth({opacity: Number(parameters.depthMapOpacity)}),
            Render2d.renderPose(),
            Render2d.renderText(),
            Render2d.renderContour(),
            Render2d.renderBox()
        ]).draw(result);
      }
    }
    if (parameters.worldOut) {
      if (worldSeries.length === 0) {
        logger.warn("nothing in the results carries world coordinates, so %s was not written; they need "
          + "--toWorld for the objects or --depthMapToWorld for the scene", parameters.worldOut);
      } else {
        const written = write_world_ply(worldSeries, parameters.worldOut);
        const connected = worldSeries.reduce((total, entry) => total + entry.segments.length, 0);
        logger.info("wrote %d world point(s) and %d edge(s) in %d series to %s", written, connected,
          worldSeries.length, parameters.worldOut);
        for (const entry of worldSeries) {
          logger.debug("  %s: %d point(s)", entry.label, entry.points.length);
        }
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
