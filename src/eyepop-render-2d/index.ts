import {Prediction} from '../eyepop'
import {CanvasRenderingContext2D} from 'canvas'
import {Renderer2d, RenderRule} from './renderer-2d'


export interface Renderer {
    prediction(p: Prediction): void
}

export namespace Render2d {
    export function renderer(context: CanvasRenderingContext2D, rules: RenderRule[] | undefined = undefined): Renderer {
        return new Renderer2d(context, rules)
    }
}

export default Render2d
