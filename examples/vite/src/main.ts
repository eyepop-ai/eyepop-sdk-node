import 'eyepop'
import 'eyepop-render-2d'

import { pino } from 'pino'
import image1Src from 'example.jpg'
import image2Src from 'large_example.jpg'
const image3Src = 'https://raw.githubusercontent.com/64blit/files/main/images_videos/6tb6aa0giyq51.jpg'

import { BoxType } from '../../../src/eyepop-render-2d/render-box';

const logger = pino({ level: 'info', name: 'eyepop-example' })

const testParent = document.getElementById('testParent')

async function run(testData: any)
{
    // takes the test data, creates a canvas per image, draws the image to the canvas, and then draws the render tests to the canvas
    const endpoint = await EyePop.workerEndpoint({
        auth: {
            oAuth2: true,
        },
        popId: 'ab3cb23c05c045a29ee6ea00c765f167',
        logger: logger
    }).onStateChanged((fromState: any, toState: any) =>
    {
        logger.info("Endpoint changed state %s -> %s", fromState, toState)
    }).connect()

    for (let i = 0; i < testData.length; i++)
    {
        const image = document.createElement(`image`) as HTMLImageElement
        image.id = `image${i + 1}`
        image.classList.add('hidden')

        const canvas = document.createElement(`canvas`) as HTMLCanvasElement
        canvas.id = `canvas${i + 1}`
        canvas.classList.add('w-1/2', 'object-contain')

        testParent?.appendChild(image)
        testParent?.appendChild(canvas)

        const context = canvas.getContext("2d")

        image.src = testData[ i ].image


        const imageBlob = await fetch(image.src).then(res => res.blob())

        try
        {

            let results = null
            if (testData[ i ].imageType === 'url')
            {
                results = await endpoint.process({ url: image.src })
            } else
            {
                results = await endpoint.process({ file: imageBlob })
            }

            for await (let result of await results)
            {
                canvas.width = result.source_width
                canvas.height = result.source_height
                console.log(result)
                let hasText = false
                for (let j = 0; j < result?.objects?.length; j++)
                {
                    let obj = result.objects[ j ]
                    if (obj.category === 'text')
                    {
                        hasText = true
                        break
                    }
                }

                const imageObjectURL = URL.createObjectURL(imageBlob);
                const imageElement = new Image();
                imageElement.src = imageObjectURL;
                imageElement.onload = () =>
                {
                    context?.drawImage(imageElement, 0, 0);
                    URL.revokeObjectURL(imageObjectURL);
                    Render2d?.renderer(context,
                        testData[ i ].renderTest
                    ).draw(result)
                };

                console.log(result)
            }
        } catch (e)
        {
            console.error(e)
        }
    }
}

document.addEventListener('DOMContentLoaded', async () =>
{

    document.getElementById('url-input')?.addEventListener('input', async (event) =>
    {
        const imageUrl = (event.target as HTMLInputElement).value;
        const image1 = document.getElementById('image1') as HTMLImageElement;
        const newImage = new Image()
        newImage.src = imageUrl
        image1.crossOrigin = "Anonymous"
        newImage.crossOrigin = "Anonymous"

        newImage.onload = () =>
        {
            image1.src = imageUrl
            console.log(image1.src)
            run(false)
        }
    })

    const testData = [ {
        renderTest: [
            Render2d.renderPose(),
            Render2d.renderFace(),
            Render2d.renderHand(),
            Render2d.renderBox({
                showClass: true,
                showText: true,
                showConfidence: true,
                showTraceId: true,
                showNestedClasses: true,
                boxType: BoxType.Simple
            }),
            Render2d.renderText()
        ],
        imageType: 'url',
        image: image3Src
    }, {
        renderTest: [
            Render2d.renderPose(),
            Render2d.renderFace(),
            Render2d.renderHand(),
            Render2d.renderBox({
                showClass: true,
                showText: true,
                showConfidence: true,
                showTraceId: true,
                showNestedClasses: true,
                boxType: BoxType.SimpleSelected
            }),
            Render2d.renderText()
        ],
        imageType: 'file',
        image: image1Src

    }, {
        renderTest: [
            Render2d.renderPose(),
            Render2d.renderFace(),
            Render2d.renderHand(),
            Render2d.renderBox({
                showClass: true,
                showText: true,
                showConfidence: true,
                showTraceId: true,
                showNestedClasses: true,
                boxType: BoxType.Rich
            }),
            Render2d.renderText()
        ],
        imageType: 'file',
        image: image2Src
    }, ]

    run(testData)
})
