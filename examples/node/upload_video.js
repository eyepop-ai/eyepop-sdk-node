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
Object.defineProperty(exports, "__esModule", { value: true });
var eyepop_1 = require("../../src/eyepop");
var process_1 = require("process");
var pino_1 = require("pino");
var logger = (0, pino_1.pino)({ level: 'debug', name: 'eyepop-example' });
function upload_video(video_path, seconds) {
    var _a, e_1, _b, _c;
    return __awaiter(this, void 0, void 0, function () {
        var endpoint, results, _d, results_1, results_1_1, result, e_1_1;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, eyepop_1.EyePop.workerEndpoint({ logger: logger }).connect()];
                case 1:
                    endpoint = _e.sent();
                    _e.label = 2;
                case 2:
                    _e.trys.push([2, , 16, 18]);
                    return [4 /*yield*/, endpoint.process({ path: video_path })];
                case 3:
                    results = _e.sent();
                    _e.label = 4;
                case 4:
                    _e.trys.push([4, 9, 10, 15]);
                    _d = true, results_1 = __asyncValues(results);
                    _e.label = 5;
                case 5: return [4 /*yield*/, results_1.next()];
                case 6:
                    if (!(results_1_1 = _e.sent(), _a = results_1_1.done, !_a)) return [3 /*break*/, 8];
                    _c = results_1_1.value;
                    _d = false;
                    result = _c;
                    // @ts-ignore
                    if (result['seconds'] >= seconds) {
                        results.cancel();
                    }
                    console.log(result);
                    _e.label = 7;
                case 7:
                    _d = true;
                    return [3 /*break*/, 5];
                case 8: return [3 /*break*/, 15];
                case 9:
                    e_1_1 = _e.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 15];
                case 10:
                    _e.trys.push([10, , 13, 14]);
                    if (!(!_d && !_a && (_b = results_1.return))) return [3 /*break*/, 12];
                    return [4 /*yield*/, _b.call(results_1)];
                case 11:
                    _e.sent();
                    _e.label = 12;
                case 12: return [3 /*break*/, 14];
                case 13:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 14: return [7 /*endfinally*/];
                case 15: return [3 /*break*/, 18];
                case 16: return [4 /*yield*/, endpoint.disconnect()];
                case 17:
                    _e.sent();
                    return [7 /*endfinally*/];
                case 18: return [2 /*return*/];
            }
        });
    });
}
;
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var video_file, seconds, e_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                video_file = process_1.default.argv[2];
                seconds = 60.0;
                console.log("using: ".concat(video_file, " for ").concat(seconds, " seconds"));
                return [4 /*yield*/, upload_video(video_file, seconds)];
            case 1:
                _a.sent();
                return [3 /*break*/, 3];
            case 2:
                e_2 = _a.sent();
                console.error(e_2);
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); })();
