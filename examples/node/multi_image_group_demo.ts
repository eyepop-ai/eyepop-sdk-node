/**
 * Multi-image group demo
 *
 * Send several images as a single image group (one inference unit) to a
 * multi-image-capable VLM ability and print the one combined result.
 *
 * Usage:
 *   # local files
 *   npx tsx examples/node/multi_image_group_demo.ts image1.jpg image2.jpg image3.jpg
 *
 *   # remote URLs (prefix each with http:// or https://)
 *   npx tsx examples/node/multi_image_group_demo.ts https://example.com/a.jpg https://example.com/b.jpg
 *
 * The ability must be multi-image-capable (e.g. eyepop.vlm.image:latest).
 * Override with EYEPOP_MULTI_IMAGE_ABILITY env var.
 * Override the prompt with EYEPOP_MULTI_IMAGE_PROMPT env var.
 */

import { EyePop, EndpointState, InferenceComponent, Pop } from '@eyepop.ai/eyepop'
import { pino } from 'pino'
import process from 'process'

const logger = pino({ level: 'info', name: 'eyepop-example' })

const ability = process.env['EYEPOP_MULTI_IMAGE_ABILITY'] ?? 'eyepop.vlm.image:latest'
const prompt = process.env['EYEPOP_MULTI_IMAGE_PROMPT'] ?? 'Describe these images together in one sentence.'

const args = process.argv.slice(2)
if (args.length < 2) {
    logger.error('Pass at least two local image paths or remote URLs as arguments.')
    process.exit(1)
}

const isUrl = (s: string) => s.startsWith('http://') || s.startsWith('https://')
const allUrls = args.every(isUrl)
const allPaths = args.every(a => !isUrl(a))

if (!allUrls && !allPaths) {
    logger.error('Mix of local paths and remote URLs is not supported. Use all paths or all URLs.')
    process.exit(1)
}

const groupPop: Pop = {
    components: [
        {
            type: 'inference',
            ability,
            params: { prompt },
        } as InferenceComponent,
    ],
}

;(async () => {
    const endpoint = await EyePop.workerEndpoint({ logger })
        .onStateChanged((from: EndpointState, to: EndpointState) => {
            logger.info('Endpoint state %s -> %s', from, to)
        })
        .connect()

    try {
        await endpoint.changePop(groupPop)

        const results = allUrls
            ? await endpoint.loadFromGroup(args)
            : await endpoint.uploadGroup(args)

        for await (const result of results) {
            console.log(JSON.stringify(result, null, 2))
        }
    } finally {
        await endpoint.disconnect()
    }
})()
