import {Renderer} from './index'
import {CanvasRenderingContext2D} from 'canvas'
import {Prediction} from '@eyepop.ai/eyepop'
import {Style} from "./style";
import {Render} from "./render";
import {RenderBox} from "./render-box";
import {StreamTime} from "EyePop";

const jp = require('jsonpath');

export interface RenderRule {
    readonly render: Render
    readonly target : string
}

export class Renderer2d implements Renderer {
    private readonly context: CanvasRenderingContext2D
    private readonly style: Style

    private readonly rules: RenderRule[]

    private static readonly defaultRules:RenderRule[] = [
        {
            render: new RenderBox(),
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
        for (let i = 0; i < this.rules.length; i++) {
            this.rules[i].render.start(this.context, this.style)
        }
    }

    public draw(p: Prediction) {
        const x_scale = this.context.canvas.width / p.source_width
        const y_scale = this.context.canvas.height / p.source_height
        const streamTime:StreamTime = {
            offset: p.offset,
            seconds: p.seconds,
            timestamp: p.timestamp
        }
        for (let i = 0; i < this.rules.length; i++) {
            const rule = this.rules[i]
            const targets = jp.query(p, rule.target)
            for (let j = 0; j < targets.length; j++) {
                rule.render.draw(targets[j], 0, 0, x_scale, y_scale, streamTime)
            }
        }
    }
}