import 'eyepop'
import 'eyepop-render-2d'

import { pino } from 'pino'
import image1Src from 'example.jpg'
import image2Src from 'large_example.jpg'

const logger = pino({ level: 'info', name: 'eyepop-example' })

document.addEventListener('DOMContentLoaded', async () =>
{
    const image = document.getElementById('image1') as HTMLImageElement
    image.src = image1Src
    const canvas = document.getElementById('canvas1') as HTMLCanvasElement
    const context = canvas.getContext("2d")

    const image1 = document.getElementById('image2') as HTMLImageElement
    image1.src = image2Src
    const canvas1 = document.getElementById('canvas2') as HTMLCanvasElement
    const context1 = canvas1.getContext("2d")

    const imageBlob1 = await fetch(image.src).then(res => res.blob())
    const imageBlob2 = await fetch(image1.src).then(res => res.blob())

    const endpoint = await EyePop.endpoint({
        auth: {
            oAuth2: true,
        },
        popId: 'ab3cb23c05c045a29ee6ea00c765f167',
        logger: logger
    }).onStateChanged((fromState: any, toState: any) =>
    {
        logger.info("Endpoint changed state %s -> %s", fromState, toState)
    }).connect()

    try
    {

        let results = await endpoint.process({ file: imageBlob1 })

        for await (let result of await results)
        {
            canvas.width = result.source_width
            canvas.height = result.source_height
            console.log(result)
            let hasText = false
            for (let i = 0; i < result?.objects?.length; i++)
            {
                let obj = result.objects[ i ]
                if (obj.category === 'text')
                {
                    hasText = true
                    break
                }
            }

            context?.drawImage(image, 0, 0)
            Render2d?.renderer(context,
                [
                    Render2d.renderPose(),
                    Render2d.renderFace(),
                    Render2d.renderHand(),
                    Render2d.renderBox({
                        showClass: !hasText,
                        showText: !hasText,
                        showConfidence: !hasText,
                        showTraceId: !hasText,
                        showNestedClasses: !hasText,
                    }),
                    Render2d.renderText()
                ]
            ).draw(result)
        }

        results = await endpoint.process({ file: imageBlob2 })

        for await (let result of await results)
        {
            canvas1.width = result.source_width
            canvas1.height = result.source_height
            console.log(result)
            let hasText = false

            for (let i = 0; i < result?.objects?.length; i++)
            {
                let obj = result.objects[ i ]
                if (obj.category === 'text')
                {
                    hasText = true
                    break
                }
            }
            context1?.drawImage(image1, 0, 0)
            Render2d?.renderer(context1,
                [
                    Render2d.renderPose(),
                    Render2d.renderFace(),
                    Render2d.renderHand(),
                    Render2d.renderBox({
                        showClass: !hasText,
                        showText: !hasText,
                        showConfidence: !hasText,
                        showTraceId: !hasText,
                        showNestedClasses: !hasText,
                    }),
                    Render2d.renderText()
                ]
            ).draw(result)
        }
    } finally
    {
        await endpoint.disconnect()
    }
})


