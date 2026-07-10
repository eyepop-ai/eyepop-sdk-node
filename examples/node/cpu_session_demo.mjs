#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const require = createRequire(import.meta.url)

const DEFAULT_EYEPOP_URL = 'https://compute.staging.eyepop.xyz'
const DEFAULT_IMAGE = 'examples/example.jpg'
const DEFAULT_ABILITY = 'eyepop.localize-objects:latest'
const DEFAULT_PROMPT = 'person'
const DEFAULT_EXPECTED_CLASS = 'person'

const { values } = parseArgs({
    options: {
        image: {
            type: 'string',
            short: 'i',
            default: DEFAULT_IMAGE,
        },
        prompt: {
            type: 'string',
            short: 'p',
            default: DEFAULT_PROMPT,
        },
        ability: {
            type: 'string',
            short: 'a',
            default: DEFAULT_ABILITY,
        },
        expectedClass: {
            type: 'string',
            short: 'c',
            default: DEFAULT_EXPECTED_CLASS,
        },
        minConfidence: {
            type: 'string',
            default: '0.5',
        },
        eyepopUrl: {
            type: 'string',
            default: process.env.EYEPOP_URL || DEFAULT_EYEPOP_URL,
        },
        noCleanup: {
            type: 'boolean',
            default: false,
        },
        requireMatch: {
            type: 'boolean',
            default: false,
        },
        json: {
            type: 'boolean',
            default: false,
        },
        help: {
            type: 'boolean',
            short: 'h',
            default: false,
        },
    },
})

function printHelpAndExit() {
    console.info(`CPU session demo for staging

Usage:
  npm run demo:cpu-session -- --image examples/example.jpg --prompt person

Environment:
  EYEPOP_API_KEY must be set. EYEPOP_URL defaults to ${DEFAULT_EYEPOP_URL}.

Options:
  -i, --image <path>          Image to process. Default: ${DEFAULT_IMAGE}
  -p, --prompt <text>         ModelLess prompt. Default: ${DEFAULT_PROMPT}
  -a, --ability <alias>       Ability alias. Default: ${DEFAULT_ABILITY}
  -c, --expectedClass <name>  Class label to summarize. Default: ${DEFAULT_EXPECTED_CLASS}
      --minConfidence <n>     Minimum confidence for the summary. Default: 0.5
      --eyepopUrl <url>       Compute API URL. Default: EYEPOP_URL or staging
      --noCleanup             Leave the transient session in staging
      --requireMatch          Exit non-zero if the ModelLess pop returns no objects
      --json                  Print the full prediction payload
`)
    process.exit(0)
}

function loadSdk() {
    const sdkPath = resolve('src/eyepop/dist/eyepop.index.js')
    if (!existsSync(sdkPath)) {
        throw new Error('SDK build not found. Run `npm run build -w @eyepop.ai/eyepop` first.')
    }
    return require(sdkPath)
}

function buildCpuPop({ ability, prompt, expectedClass }) {
    return {
        components: [
            {
                id: 1,
                type: 'inference',
                ability,
                categoryName: expectedClass,
                params: {
                    prompts: [{ prompt }],
                },
            },
        ],
    }
}

function sessionUuidFromBaseUrl(baseUrl) {
    try {
        const parsed = new URL(baseUrl)
        return parsed.pathname.split('/').filter(Boolean)[0] || ''
    } catch {
        return ''
    }
}

function objectLabel(object) {
    for (const key of ['classLabel', 'category', 'categoryName', 'label', 'name']) {
        if (typeof object?.[key] === 'string') {
            return object[key]
        }
    }
    return ''
}

function summarizePredictions(predictions, expectedClass, minConfidence) {
    const expected = expectedClass.trim().toLowerCase()
    const objects = predictions.flatMap(prediction => (Array.isArray(prediction.objects) ? prediction.objects : []))
    const matches = objects.filter(object => {
        const confidence = object?.confidence ?? 0
        return objectLabel(object).trim().toLowerCase() === expected && typeof confidence === 'number' && confidence >= minConfidence
    })
    return {
        predictionCount: predictions.length,
        objectCount: objects.length,
        matchingObjectCount: matches.length,
        topMatches: matches
            .slice()
            .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
            .slice(0, 5)
            .map(object => ({
                class: objectLabel(object),
                confidence: object.confidence,
                box: {
                    x: object.x,
                    y: object.y,
                    width: object.width,
                    height: object.height,
                },
            })),
    }
}

async function cleanupSession(apiKey, eyepopUrl, sessionUuid) {
    if (!sessionUuid) {
        return { ok: false, result: 'missing_session_uuid' }
    }
    const response = await fetch(`${eyepopUrl.replace(/\/+$/, '')}/v1/sessions/${sessionUuid}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
    })
    const body = await response.text()
    return {
        ok: [200, 202, 204, 404].includes(response.status),
        status: response.status,
        result: response.status === 404 ? 'already_absent' : 'deleted',
        body: body && response.status >= 300 ? body.slice(0, 300) : '',
    }
}

async function main() {
    if (values.help) {
        printHelpAndExit()
    }
    const apiKey = process.env.EYEPOP_API_KEY
    if (!apiKey) {
        throw new Error('EYEPOP_API_KEY is required')
    }

    const imagePath = resolve(values.image)
    if (!existsSync(imagePath)) {
        throw new Error(`Image does not exist: ${values.image}`)
    }

    const minConfidence = Number(values.minConfidence)
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
        throw new Error('--minConfidence must be between 0 and 1')
    }

    const { EyePop } = loadSdk()
    const pop = buildCpuPop(values)
    const sessionName = `node-cpu-demo-${Date.now()}`
    const eyepopUrl = values.eyepopUrl.replace(/\/+$/, '')
    let endpoint
    let sessionUuid = ''

    console.info('CPU session demo')
    console.info(`- environment_url: ${eyepopUrl}`)
    console.info(`- image: ${values.image}`)
    console.info(`- ability: ${values.ability}`)
    console.info(`- prompt: ${values.prompt}`)

    try {
        endpoint = await EyePop.workerEndpoint({
            eyepopUrl,
            auth: { apiKey },
            sessionName,
            pop,
        }).connect()

        const session = await endpoint.session()
        sessionUuid = sessionUuidFromBaseUrl(session.baseUrl)
        console.info(`- session_uuid: ${sessionUuid || 'n/a'}`)
        console.info(`- pipeline_id: ${session.pipelineId}`)

        const stream = await endpoint.process({
            source: { path: imagePath },
        })
        const predictions = []
        for await (const prediction of stream) {
            predictions.push(prediction)
        }

        const summary = summarizePredictions(predictions, values.expectedClass, minConfidence)
        console.info(`- predictions: ${summary.predictionCount}`)
        console.info(`- objects: ${summary.objectCount}`)
        console.info(`- ${values.expectedClass} matches >= ${minConfidence}: ${summary.matchingObjectCount}`)
        for (const [index, match] of summary.topMatches.entries()) {
            console.info(`  ${index + 1}. ${match.class} confidence=${Number(match.confidence ?? 0).toFixed(4)} box=${JSON.stringify(match.box)}`)
        }

        if (values.json) {
            console.info(JSON.stringify(predictions, null, 2))
        }
        if (values.requireMatch && summary.matchingObjectCount === 0) {
            process.exitCode = 2
        }
    } finally {
        if (endpoint) {
            await endpoint.disconnect()
        }
        if (!values.noCleanup && sessionUuid) {
            const cleanup = await cleanupSession(apiKey, eyepopUrl, sessionUuid)
            console.info(`- cleanup: ${cleanup.result} (${cleanup.status || 'n/a'})`)
            if (!cleanup.ok) {
                process.exitCode = process.exitCode || 3
            }
        }
    }
}

main().catch(error => {
    console.error(error?.stack || error)
    process.exit(1)
})
