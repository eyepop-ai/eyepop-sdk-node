"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var eyepop_1 = require("@eyepop.ai/eyepop");
var eyepop_render_2d_1 = require("@eyepop.ai/eyepop-render-2d");
var canvas_1 = require("canvas");
var openurl_1 = require("openurl");
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var node_os_1 = require("node:os");
var pino_1 = require("pino");
var node_util_1 = require("node:util");
var process_1 = require("process");
var POP_EXAMPLES = {
    "person": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person'
            }] },
    "2d-body-points": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person',
                forward: {
                    operator: {
                        type: eyepop_1.ForwardOperatorType.CROP,
                        crop: {
                            maxItems: 128
                        }
                    },
                    targets: [{
                            type: eyepop_1.PopComponentType.INFERENCE,
                            model: 'eyepop.person.2d-body-points:latest',
                            categoryName: '2d-body-points',
                            confidenceThreshold: 0.25
                        }]
                }
            }] },
    "faces": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person',
                forward: {
                    operator: {
                        type: eyepop_1.ForwardOperatorType.CROP,
                        crop: {
                            maxItems: 128
                        }
                    },
                    targets: [{
                            type: eyepop_1.PopComponentType.INFERENCE,
                            model: 'eyepop.person.face.short-range:latest',
                            categoryName: '2d-face-points',
                            forward: {
                                operator: {
                                    type: eyepop_1.ForwardOperatorType.CROP,
                                    crop: {
                                        boxPadding: 1.5,
                                        orientationTargetAngle: -90.0,
                                    }
                                },
                                targets: [{
                                        type: eyepop_1.PopComponentType.INFERENCE,
                                        model: 'eyepop.person.face-mesh:latest',
                                        categoryName: '3d-face-mesh'
                                    }]
                            }
                        }]
                }
            }] },
    "hands": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person',
                forward: {
                    operator: {
                        type: eyepop_1.ForwardOperatorType.CROP,
                        crop: {
                            boxPadding: 0.25,
                            maxItems: 128,
                        }
                    },
                    targets: [{
                            type: eyepop_1.PopComponentType.INFERENCE,
                            model: 'eyepop.person.palm:latest',
                            forward: {
                                operator: {
                                    type: eyepop_1.ForwardOperatorType.CROP,
                                    crop: {
                                        includeClasses: ['hand circumference'],
                                        orientationTargetAngle: -90.0,
                                    }
                                },
                                targets: [{
                                        type: eyepop_1.PopComponentType.INFERENCE,
                                        model: 'eyepop.person.3d-hand-points:latest',
                                        categoryName: '3d-hand-points'
                                    }]
                            }
                        }]
                }
            }] },
    "3d-body-points": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person',
                forward: {
                    operator: {
                        type: eyepop_1.ForwardOperatorType.CROP,
                        crop: {
                            boxPadding: 0.5
                        }
                    },
                    targets: [{
                            type: eyepop_1.PopComponentType.INFERENCE,
                            model: 'eyepop.person.pose:latest',
                            hidden: true,
                            forward: {
                                operator: {
                                    type: eyepop_1.ForwardOperatorType.CROP,
                                    crop: {
                                        boxPadding: 0.5,
                                        orientationTargetAngle: -90.0,
                                    }
                                },
                                targets: [{
                                        type: eyepop_1.PopComponentType.INFERENCE,
                                        model: 'eyepop.person.3d-body-points.heavy:latest',
                                        categoryName: '3d-body-points',
                                        confidenceThreshold: 0.25
                                    }]
                            }
                        }]
                }
            }] },
    "text": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.text:latest',
                categoryName: 'text',
                forward: {
                    operator: {
                        type: eyepop_1.ForwardOperatorType.CROP,
                    },
                    targets: [{
                            type: eyepop_1.PopComponentType.INFERENCE,
                            model: 'eyepop.text.recognize.square:latest'
                        }]
                }
            }] },
    "sam1": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.sam.small:latest',
                id: 1,
                forward: {
                    operator: {
                        type: eyepop_1.ForwardOperatorType.FULL,
                    },
                    targets: [{
                            type: eyepop_1.PopComponentType.CONTOUR_FINDER,
                            contourType: eyepop_1.ContourType.POLYGON,
                            areaThreshold: 0.005
                        }]
                }
            }] },
    "sam2": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.sam2.encoder.tiny:latest',
                hidden: true,
                forward: {
                    targets: [{
                            type: eyepop_1.PopComponentType.INFERENCE,
                            model: 'eyepop.sam2.decoder:latest',
                            id: 1,
                            forward: {
                                operator: {
                                    type: eyepop_1.ForwardOperatorType.FULL,
                                },
                                targets: [{
                                        type: eyepop_1.PopComponentType.CONTOUR_FINDER,
                                        contourType: eyepop_1.ContourType.POLYGON,
                                        areaThreshold: 0.005
                                    }]
                            }
                        }]
                }
            }] },
    "image-contents": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.image-contents:latest',
                id: 1
            }] },
    "localize-objects": { components: [{
                type: eyepop_1.PopComponentType.INFERENCE,
                model: 'eyepop.localize-objects:latest',
                id: 1
            }] },
};
var logger = (0, pino_1.pino)({ level: "debug", name: "eyepop-example" });
var _a = (0, node_util_1.parseArgs)({
    options: {
        localPath: {
            type: "string",
            short: "l"
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
}), positionals = _a.positionals, values = _a.values;
function printHelpAndExit(message, exitCode) {
    if (exitCode === void 0) { exitCode = -1; }
    if (message) {
        console.error(message);
    }
    console.info("EyePop example, usage: " +
        "\n\t-l or --localPath=[path] to run inference on a local image file" +
        "\n\t-u --url=[url] to run inference on a remote image url" +
        "\n\t-p --pop=[pop] to run one of the example pos, one of " + Object.keys(POP_EXAMPLES) +
        "\n\t-m --modelUuid=[model uuid] to run inference using a specific model uuid" +
        "\n\t-1 --sam1 to compose a model given by --model with segmentation using Efficient SAM" +
        "\n\t-2 --sam2 to compose a model given by --model with segmentation using SAM2" +
        "\n\t--points list of POIs as coordinates like (x1, y1), (x2, y2) in the original image coordinate system" +
        "\n\t--boxes list of POIs as boxes like (left1, top1, right1, bottom1), (left1, top1, right1, bottom1) in the original image coordinate system" +
        "\n\t--prompt text prompt to pass as parameter" +
        "\n\t-v --visualize to visualize the result" +
        "\n\t-o --output to print the result to stdout" +
        "\n\t-h --help to print this help message");
    process_1.default.exit(exitCode);
}
function list_of_points(arg) {
    var points_as_tuples = eval("[".concat(arg.replace('(', '[').replace(')', ']'), "]"));
    var points = [];
    for (var _i = 0, points_as_tuples_1 = points_as_tuples; _i < points_as_tuples_1.length; _i++) {
        var tuple = points_as_tuples_1[_i];
        points.push({
            x: tuple[0],
            y: tuple[1]
        });
    }
    return points;
}
function list_of_boxes(arg) {
    var boxes_as_tuples = eval("[".concat(arg.replace('(', '[').replace(')', ']'), "]"));
    var boxes = [];
    for (var _i = 0, boxes_as_tuples_1 = boxes_as_tuples; _i < boxes_as_tuples_1.length; _i++) {
        var tuple = boxes_as_tuples_1[_i];
        boxes.push({
            topLeft: {
                x: tuple[0],
                y: tuple[1],
            },
            bottomRight: {
                x: tuple[2],
                y: tuple[3],
            }
        });
    }
    return boxes;
}
(function () {
    var args_1 = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args_1[_i] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([], args_1, true), void 0, function (parameters) {
        var pop, example_input, image, sourceParams, canvas, context, endpoint, results, _a, results_1, results_1_1, result, e_1_1, tmp_dir, temp_file, buffer, e_2;
        var _b, e_1, _c, _d;
        if (parameters === void 0) { parameters = values; }
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (parameters.help) {
                        printHelpAndExit(undefined, 0);
                    }
                    if (parameters.modelUuid) {
                        if (parameters.sam1) {
                            pop = {
                                components: [{
                                        type: eyepop_1.PopComponentType.INFERENCE,
                                        modelUuid: parameters.modelUuid,
                                        forward: {
                                            operator: {
                                                type: eyepop_1.ForwardOperatorType.CROP,
                                            },
                                            targets: [{
                                                    type: eyepop_1.PopComponentType.INFERENCE,
                                                    model: 'eyepop.sam.small:latest',
                                                    forward: {
                                                        operator: {
                                                            type: eyepop_1.ForwardOperatorType.FULL,
                                                        },
                                                        targets: [{
                                                                type: eyepop_1.PopComponentType.CONTOUR_FINDER,
                                                                contourType: eyepop_1.ContourType.POLYGON,
                                                                areaThreshold: 0.005
                                                            }]
                                                    }
                                                }]
                                        }
                                    }]
                            };
                        }
                        else if (parameters.sam2) {
                            pop = {
                                type: eyepop_1.PopComponentType.INFERENCE,
                                model: 'eyepop.sam2.encoder.tiny:latest',
                                hidden: true,
                                forward: {
                                    targets: [{
                                            type: eyepop_1.PopComponentType.INFERENCE,
                                            modelUuid: parameters.modelUuid,
                                            forward: {
                                                operator: {
                                                    type: eyepop_1.ForwardOperatorType.CROP,
                                                },
                                                targets: [{
                                                        type: eyepop_1.PopComponentType.INFERENCE,
                                                        model: 'eyepop.sam2.decoder:latest',
                                                        forward: {
                                                            operator: {
                                                                type: eyepop_1.ForwardOperatorType.FULL,
                                                            },
                                                            targets: [{
                                                                    type: eyepop_1.PopComponentType.CONTOUR_FINDER,
                                                                    contourType: eyepop_1.ContourType.POLYGON,
                                                                    areaThreshold: 0.005
                                                                }]
                                                        }
                                                    }]
                                            }
                                        }]
                                }
                            };
                        }
                        else {
                            pop = {
                                type: eyepop_1.PopComponentType.INFERENCE,
                                modelUuid: parameters.modelUuid
                            };
                        }
                    }
                    else if (parameters.pop) {
                        if (POP_EXAMPLES.hasOwnProperty(parameters.pop)) {
                            // @ts-ignore
                            pop = POP_EXAMPLES[parameters.pop];
                        }
                        else {
                            printHelpAndExit("unknown pop ".concat(parameters.pop));
                        }
                    }
                    else {
                        printHelpAndExit("required: --modelUuid or --pop");
                    }
                    if (!parameters.url) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, canvas_1.loadImage)(parameters.url)];
                case 1:
                    image = _e.sent();
                    example_input = { url: parameters.url };
                    return [3 /*break*/, 5];
                case 2:
                    if (!parameters.localPath) return [3 /*break*/, 4];
                    return [4 /*yield*/, (0, canvas_1.loadImage)(parameters.localPath)];
                case 3:
                    image = _e.sent();
                    example_input = { path: parameters.localPath };
                    return [3 /*break*/, 5];
                case 4:
                    printHelpAndExit("required: --localPath or --url");
                    process_1.default.exit(-1);
                    _e.label = 5;
                case 5:
                    sourceParams = undefined;
                    if (parameters.points) {
                        sourceParams = [{
                                componentId: 1,
                                values: {
                                    roi: {
                                        points: list_of_points(parameters.points)
                                    }
                                }
                            }];
                    }
                    else if (parameters.boxes) {
                        sourceParams = [{
                                componentId: 1,
                                values: {
                                    roi: {
                                        boxes: list_of_boxes(parameters.boxes)
                                    }
                                }
                            }];
                    }
                    else if (parameters.prompt) {
                        sourceParams = [{
                                componentId: 1,
                                values: {
                                    prompts: [
                                        parameters.prompt.map(function (prompt) { return { prompt: prompt }; })
                                    ]
                                }
                            }];
                    }
                    canvas = (0, canvas_1.createCanvas)(image.width, image.height);
                    context = canvas.getContext("2d");
                    return [4 /*yield*/, eyepop_1.EyePop.workerEndpoint({
                            logger: logger,
                        })
                            .onStateChanged(function (fromState, toState) {
                            logger.debug("Endpoint changed state %s -> %s", fromState, toState);
                        })
                            .connect()];
                case 6:
                    endpoint = _e.sent();
                    _e.label = 7;
                case 7:
                    _e.trys.push([7, 22, 23, 25]);
                    return [4 /*yield*/, endpoint.changePop(pop)];
                case 8:
                    _e.sent();
                    return [4 /*yield*/, endpoint.process(example_input, sourceParams)];
                case 9:
                    results = _e.sent();
                    _e.label = 10;
                case 10:
                    _e.trys.push([10, 15, 16, 21]);
                    _a = true, results_1 = __asyncValues(results);
                    _e.label = 11;
                case 11: return [4 /*yield*/, results_1.next()];
                case 12:
                    if (!(results_1_1 = _e.sent(), _b = results_1_1.done, !_b)) return [3 /*break*/, 14];
                    _d = results_1_1.value;
                    _a = false;
                    result = _d;
                    if (parameters.output) {
                        console.info(JSON.stringify(result, undefined, 2));
                    }
                    canvas.width = result.source_width;
                    canvas.height = result.source_height;
                    context.drawImage(image, 0, 0);
                    eyepop_render_2d_1.Render2d.renderer(context, [
                        eyepop_render_2d_1.Render2d.renderPose(),
                        eyepop_render_2d_1.Render2d.renderText(),
                        eyepop_render_2d_1.Render2d.renderContour(),
                        eyepop_render_2d_1.Render2d.renderBox()
                    ]).draw(result);
                    _e.label = 13;
                case 13:
                    _a = true;
                    return [3 /*break*/, 11];
                case 14: return [3 /*break*/, 21];
                case 15:
                    e_1_1 = _e.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 21];
                case 16:
                    _e.trys.push([16, , 19, 20]);
                    if (!(!_a && !_b && (_c = results_1.return))) return [3 /*break*/, 18];
                    return [4 /*yield*/, _c.call(results_1)];
                case 17:
                    _e.sent();
                    _e.label = 18;
                case 18: return [3 /*break*/, 20];
                case 19:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 20: return [7 /*endfinally*/];
                case 21:
                    if (parameters.visualize) {
                        tmp_dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ep-demo-"));
                        temp_file = (0, node_path_1.join)(tmp_dir, "out.png");
                        logger.info("creating temp file: %s", temp_file);
                        buffer = canvas.toBuffer("image/png");
                        (0, node_fs_1.writeFileSync)(temp_file, buffer);
                        (0, openurl_1.open)("file://".concat(temp_file));
                    }
                    return [3 /*break*/, 25];
                case 22:
                    e_2 = _e.sent();
                    console.error(e_2);
                    return [3 /*break*/, 25];
                case 23: return [4 /*yield*/, endpoint.disconnect()];
                case 24:
                    _e.sent();
                    return [7 /*endfinally*/];
                case 25: return [2 /*return*/];
            }
        });
    });
})();
