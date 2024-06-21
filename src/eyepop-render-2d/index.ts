import { Prediction } from '@eyepop.ai/eyepop';
import { CanvasRenderingContext2D } from 'canvas';
import { Renderer2d } from './renderer-2d';
import { RenderBlur } from './render-blur';
import { RenderBox } from './render-box';
import { RenderFace } from './render-face';
import { RenderHand } from './render-hand';
import { RenderPose } from './render-pose';
import { RenderTrail } from "./render-trail";
import { RenderMask } from "./render-mask";
import { RenderContour } from "./render-contour";
import { RenderKeyPoints } from "./render-keypoints";
import { Render, RenderTarget } from './render';

export interface Renderer extends RenderTarget
{
    draw(p: Prediction): void
}

export namespace Render2d
{
    export function renderer(context: CanvasRenderingContext2D, rules: Render[] | undefined = undefined): Renderer
    {
        return new Renderer2d({ context, rules })
    }
    export function renderBlur(target: string): Render
    {
        return new RenderBlur({ target })
    }
    export function renderBox(showClass: boolean = true, showText: boolean = false, showConfidence: boolean = false, showTraceId: boolean = false, showNestedClasses: boolean = false, target: string = '$..objects.*'): Render
    {
        return new RenderBox({ target, showClass, showText, showConfidence, showTraceId, showNestedClasses })
    }
    export function renderMask(target: string = '$..objects[?(@.mask)]'): Render
    {
        return new RenderMask({ target })
    }
    export function renderContour(target: string = '$..objects[?(@.contours)]'): Render
    {
        return new RenderContour({ target })
    }
    export function renderFace(target: string = '$..objects[?(@.classLabel=="face")]'): Render
    {
        return new RenderFace({ target })
    }
    export function renderKeypoints(target: string = '$..objects[?(@.keyPoints)]'): Render
    {
        return new RenderKeyPoints({ target })
    }
    export function renderHand(target: string = '$..objects[?(@.classLabel=="hand circumference")]'): Render
    {
        return new RenderHand({ target })
    }
    export function renderPose(target: string = '$..objects[?(@.category=="person")]'): Render
    {
        return new RenderPose({ target })
    }
    export function renderTrail(trailLengthSeconds: number = 1.0,
        traceDetails: string | undefined = undefined,
        target: string = '$..objects[?(@.traceId)]'): Render
    {
        return new RenderTrail({ target, traceDetails, trailLengthSeconds })
    }
}

export default Render2d
