import { Prediction } from '@eyepop.ai/eyepop';
import { CanvasRenderingContext2D } from 'canvas';
import { Renderer2d } from './renderer-2d';
import { RenderBlur, RenderBlurOptions } from './render-blur';
import { RenderBox, RenderBoxOptions } from './render-box';
import { RenderFace, RenderFaceOptions } from './render-face';
import { RenderHand, RenderHandOptions } from './render-hand';
import { RenderPose, RenderPoseOptions } from './render-pose';
import { RenderTrail, RenderTrailOptions } from "./render-trail";
import { RenderMask, RenderMaskOptions } from "./render-mask";
import { RenderContour, RenderContourOptions } from "./render-contour";
import { RenderKeyPoints, RenderKeyPointsOptions } from "./render-keypoints";
import { Render, RenderTarget } from './render';
import { RenderText, RenderTextOptions } from './render-text';

export interface Renderer extends RenderTarget
{
    draw(p: Prediction, color?:string): void
}

export namespace Render2d
{
    export function renderer(context: CanvasRenderingContext2D, rules: Render[] | undefined = undefined): Renderer
    {
        return new Renderer2d({ context, rules })
    }
    export function renderBlur(options: Partial<RenderBlurOptions> = {}): Render
    {
        return new RenderBlur(options)
    }
    export function renderBox(options: Partial<RenderBoxOptions> = {}): Render
    {
        return new RenderBox(options)
    }
    export function renderMask(options: Partial<RenderMaskOptions> = {}): Render
    {
        return new RenderMask(options)
    }
    export function renderContour(options: Partial<RenderContourOptions> = {}): Render
    {
        return new RenderContour(options)
    }
    export function renderFace(options: Partial<RenderFaceOptions> = {}): Render
    {
        return new RenderFace(options)
    }
    export function renderKeypoints(options: Partial<RenderKeyPointsOptions> = {}): Render
    {
        return new RenderKeyPoints(options)
    }
    export function renderHand(options: Partial<RenderHandOptions> = {}): Render
    {
        return new RenderHand(options)
    }
    export function renderPose(options: Partial<RenderPoseOptions> = {}): Render
    {
        return new RenderPose(options)
    }
    export function renderText(options: Partial<RenderTextOptions> = {}): Render
    {
        return new RenderText(options)
    }
    export function renderTrail(options: Partial<RenderTrailOptions> = {}): Render
    {
        return new RenderTrail(options)
    }
}

export default Render2d
