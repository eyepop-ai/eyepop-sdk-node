/**
 * Multi-image group demo
 *
 * Send several images as a single image group (one inference unit) to a
 * multi-image-capable ability and print the one combined result.
 *
 * Usage:
 *   # local files
 *   npx tsx examples/node/multi_image_group_demo.ts image1.jpg image2.jpg image3.jpg
 *
 *   # remote URLs (prefix each with http:// or https://)
 *   npx tsx examples/node/multi_image_group_demo.ts https://example.com/a.jpg https://example.com/b.jpg
 *
 * Environment variables:
 *   EYEPOP_API_KEY             — required
 *   EYEPOP_SESSION_UUID        — use a pre-configured persistent session (skips changePop)
 *   EYEPOP_MULTI_IMAGE_ABILITY — ability to use (default: eyepop.vlm.image:latest)
 */

import { EyePop, EndpointState, InferenceComponent, Pop } from '@eyepop.ai/eyepop'
import { pino } from 'pino'
import process from 'process'

const logger = pino({ level: 'info', name: 'eyepop-example' })

const ability = process.env['EYEPOP_MULTI_IMAGE_ABILITY'] ?? 'eyepop.vlm.image:latest'
const sessionUuid = process.env['EYEPOP_SESSION_UUID']

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
        } as InferenceComponent,
    ],
}

;(async () => {
    const endpoint = await EyePop.workerEndpoint({ logger, sessionUuid })
        .onStateChanged((from: EndpointState, to: EndpointState) => {
            logger.info('Endpoint state %s -> %s', from, to)
        })
        .connect()

    try {
        if (!sessionUuid) {
            await endpoint.changePop(groupPop)
        }

        const results = allUrls
            ? await endpoint.loadFromGroup(args)
            : await endpoint.uploadGroup(args)

        for await (const result of results) {
            console.log(JSON.stringify(result, null, 2))
        }
    } catch (e) {
        logger.error(e)
    } finally {
        await endpoint.disconnect()
    }
})()
