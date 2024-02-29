import {Prediction} from '../eyepop';
import {CanvasRenderingContext2D} from 'canvas';
import {Renderer2d, RenderRule} from './renderer-2d';
import {RenderBlur} from './render-blur';
import {RenderBox} from './render-box';
import {RenderFace} from './render-face';
import {RenderHand} from './render-hand';
import {RenderPose} from './render-pose';
import {RenderTrail} from "./render-trail";
import {RenderContour} from "./render-contour";

export interface Renderer {
    draw(p: Prediction): void
}

export namespace Render2d {
    export function renderer(context: CanvasRenderingContext2D, rules: RenderRule[] | undefined = undefined): Renderer {
        return new Renderer2d(context, rules)
    }
    export function renderBlur(target: string) : RenderRule {
        return {render: new RenderBlur(), target: target}
    }
    export function renderBox(includeSecondaryLabels: boolean = false, target: string = '$.objects.*') : RenderRule {
        return {render: new RenderBox(includeSecondaryLabels), target: target}
    }
    export function renderContour(target: string = '$.objects[?(@.contours)]') : RenderRule {
        return {render: new RenderContour(), target: target}
    }
    export function renderFace(target: string = '$..objects[?(@.classLabel=="face")]') : RenderRule {
        return {render: new RenderFace(), target: target}
    }
    export function renderHand(target: string = '$..objects[?(@.classLabel=="hand circumference")]') : RenderRule {
        return {render: new RenderHand(), target: target}
    }
    export function renderPose(target: string = '$..objects[?(@.category=="person")]') : RenderRule {
        return {render: new RenderPose(), target: target}
    }
    export function renderTrail(durationSeconds: number = 1.0,
                                traceDetails : string | undefined = undefined,
                                target: string = '$..objects[?(@.traceId)]') : RenderRule {
        return {render: new RenderTrail(durationSeconds, traceDetails), target: target}
    }
}

export default Render2d
