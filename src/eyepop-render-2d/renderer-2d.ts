import {Renderer} from './index'
import {CanvasRenderingContext2D} from 'canvas'
import {PredictedClass, PredictedKeyPoints, PredictedMesh, PredictedObject, Prediction} from '@eyepop.ai/eyepop'
import {Style} from "./style";
import {Render} from "./render";
import {RenderBox} from "./render-box";
import {RenderFace} from "./render-face";
import {RenderHand} from "./render-hand";
import {RenderPose} from "./render-pose";
import {RenderBlur} from "./render-blur";

const jp = require('jsonpath');

export type RenderType = 'box' | 'pose' | 'hand' | 'face' | 'blur'
export interface RenderRule {
    readonly type: RenderType
    readonly target : string
}

export class Renderer2d implements Renderer {
    private readonly context: CanvasRenderingContext2D
    private readonly style: Style

    private readonly rules: RenderRule[]

    private readonly renders: Map<RenderType, Render>

    private static readonly defaultRules:RenderRule[] = [
        {
            type: 'box',
            target: '$.objects.*'
        }
    ]
    constructor(context: CanvasRenderingContext2D, rules:  RenderRule[] | RenderRule | undefined) {
        this.context = context
        if (rules) {
            if (Array.isArray(rules)) {
                this.rules = rules
            } else {
                this.rules = [rules]
            }
        } else {
            this.rules = Renderer2d.defaultRules
        }
        this.style = new Style(context)
        this.renders = new Map<RenderType, Render>()
        this.renders.set('box', new RenderBox(context, this.style))
        this.renders.set('pose', new RenderPose(context, this.style))
        this.renders.set('hand', new RenderHand(context, this.style))
        this.renders.set('face', new RenderFace(context, this.style))
        this.renders.set('blur', new RenderBlur(context, this.style))
    }

    public prediction(p: Prediction) {
        const x_scale = this.context.canvas.width / p.source_width
        const y_scale = this.context.canvas.height / p.source_height

        for (let i = 0; i < this.rules.length; i++) {
            const rule = this.rules[i]
            const r = this.renders.get(rule.type)
            if (!r) {
                console.warn('no registered renderer for type:', rule.type)
            } else {
                const targets = jp.query(p, rule.target)
                for (let j = 0; j < targets.length; j++) {
                    r.render(targets[j], 0, 0, x_scale, y_scale)
                }
            }
        }
    }
}