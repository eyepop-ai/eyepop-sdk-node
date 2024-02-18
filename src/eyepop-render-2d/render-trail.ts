import {CanvasRenderingContext2D} from "canvas";
import {Style} from "./style";
import {Render} from "./render";
import {Point2d, PredictedObject, StreamTime} from "@eyepop.ai/eyepop";

const jp = require('jsonpath');

interface TraceEntry {
    readonly timestamp: number
    readonly points: Point2d[]
    next: TraceEntry | null
}

export class RenderTrail implements Render {
    private readonly traceDetails : string | undefined
    private readonly trailLengthNanos: number
    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    private traces : Map<number, TraceEntry>

    constructor(trailLengthSeconds: number, traceDetails : string | undefined = undefined) {
        this.trailLengthNanos = (trailLengthSeconds * 1000 * 1000 * 1000)
        this.traceDetails = traceDetails
        this.traces = new Map()
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }
    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {
        if (!element.traceId) {
            return
        }
        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        const points : Point2d[] = []

        if (this.traceDetails) {
            const targets = jp.query(element, this.traceDetails)
            if (targets && targets.length) {
                for (let i = 0; i < targets.length; i++) {
                    const target = targets[i]
                    if ('x' in target && 'y' in target) {
                        if ('width' in target && 'height' in target) {
                            const object = target as PredictedObject
                            const point:Point2d = {
                                x : object.x + object.width / 2,
                                y : object.y + object.height / 2
                            }
                            points.push(point)
                        } else {
                            points.push(target as Point2d)
                        }
                    }
                }
            }
        } else {
            const point:Point2d = {
                x : element.x + element.width / 2,
                y : element.y + element.height / 2
            }
            points.push(point)
        }

        const head:TraceEntry = {
            points: points,
            timestamp: streamTime.timestamp,
            next: this.traces.get(element.traceId)??null
        }
        this.traces.set(element.traceId, head)

        const radius = element.width * xScale / 40

        for (let entry:TraceEntry|null = head; entry != null; entry = entry.next) {
            const age = streamTime.timestamp - entry.timestamp
            if (age < this.trailLengthNanos) {
                const alpha = 1.0 - (age / this.trailLengthNanos)
                this.drawTraceEntry(entry.points, radius, alpha, xOffset, yOffset, xScale, yScale, context, style)
            } else {
                entry.next = null
            }
        }
    }

    private drawTraceEntry(points: Point2d[], radius: number, alpha: number, xOffset: number, yOffset: number, xScale: number, yScale: number, context: CanvasRenderingContext2D, style: Style): void {
        context.globalAlpha = alpha
        context.fillStyle = style.colors.secondary_color
        context.strokeStyle = style.colors.secondary_color
        for (let i = 0; i < points.length; i++) {
            const p = points[i]
            context.beginPath()
            context.globalAlpha = alpha
            context.arc(p.x * xScale + xOffset, p.y * yScale + yOffset, radius * alpha, 0, Math.PI * 2, false)
            context.fill()
            context.stroke()
        }
    }
}