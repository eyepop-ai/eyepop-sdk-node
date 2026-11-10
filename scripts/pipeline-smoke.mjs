#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

const ENV_URLS = {
    production: 'https://compute.eyepop.ai',
    staging: 'https://compute.staging.eyepop.xyz',
}

const USAGE = `Usage: node scripts/pipeline-smoke.mjs [options]

Runs a pop on the pipeline API through the SDK's pipeline mode and checks two consecutive
jobs return the expected objects. No worker session is created, so nothing is deleted.
A value in parentheses is the environment variable read when the option is not passed; a
repo .env is loaded first.

  --environment <name>     production or staging (EYEPOP_ENV, default staging). Also sets
                           EYEPOP_ENV for the SDK, which picks the pipeline API from it.
  --eyepop-url <url>       compute API URL, overriding the environment's (EYEPOP_URL)
  --api-key <key>          (EYEPOP_API_KEY)
  --sdk-module <path>      SDK build to load (default ./src/eyepop/dist/eyepop.index.js)
  --explicit-mode          pass isPipelineMode: true instead of relying on the default;
                           for an SDK released before pipeline mode became the default
  --image <path>           (default tests/test.jpg)
  --ability <alias>        (default eyepop.person:latest)
  --expected-class <name>  (default person)
  --min-objects <n>        per job (default 1)
  --min-confidence <0-1>   (default 0.5)
  --summary-json <path>    (default pipeline-smoke-summary.json)
  -h, --help
`

function loadDotEnv(path = '.env') {
    if (!existsSync(path)) {
        return
    }
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        if (!match || process.env[match[1]] !== undefined) {
            continue
        }
        process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    }
}

function parseArgs(argv) {
    const args = {
        environment: process.env.EYEPOP_ENV || 'staging',
        eyepopUrl: process.env.EYEPOP_URL || '',
        apiKey: process.env.EYEPOP_API_KEY || '',
        sdkModule: './src/eyepop/dist/eyepop.index.js',
        explicitMode: false,
        image: 'tests/test.jpg',
        ability: 'eyepop.person:latest',
        expectedClass: 'person',
        minObjects: 1,
        minConfidence: 0.5,
        summaryJson: 'pipeline-smoke-summary.json',
    }
    const flags = {
        '--environment': v => (args.environment = v),
        '--eyepop-url': v => (args.eyepopUrl = v),
        '--api-key': v => (args.apiKey = v),
        '--sdk-module': v => (args.sdkModule = v),
        '--image': v => (args.image = v),
        '--ability': v => (args.ability = v),
        '--expected-class': v => (args.expectedClass = v),
        '--min-objects': v => (args.minObjects = Number(v)),
        '--min-confidence': v => (args.minConfidence = Number(v)),
        '--summary-json': v => (args.summaryJson = v),
    }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '-h' || arg === '--help') {
            console.log(USAGE)
            process.exit(0)
        } else if (arg === '--explicit-mode') {
            args.explicitMode = true
        } else if (flags[arg]) {
            flags[arg](argv[++i])
        } else {
            throw new Error(`Unknown option ${arg}`)
        }
    }
    return args
}

async function main() {
    loadDotEnv()
    const args = parseArgs(process.argv.slice(2))
    const summary = { ok: false, environment: args.environment, ability: args.ability, jobs: [], error: null }
    const started = Date.now()
    try {
        if (!args.apiKey) {
            throw new Error('EYEPOP_API_KEY or --api-key is required')
        }
        const eyepopUrl = args.eyepopUrl || ENV_URLS[args.environment]
        if (!eyepopUrl) {
            throw new Error(`Unknown environment ${args.environment}; use staging or production, or pass --eyepop-url`)
        }
        // The SDK picks the pipeline API from EYEPOP_ENV; an SDK that predates the variable ignores it
        // and takes the url from the compute API's /v1/configs.
        process.env.EYEPOP_ENV = args.environment
        const sdk = require(resolve(args.sdkModule))
        summary.sdk_module = args.sdkModule
        summary.eyepop_url = eyepopUrl

        const options = {
            apiKey: args.apiKey,
            eyepopUrl,
            pop: { components: [{ type: sdk.PopComponentType.INFERENCE, ability: args.ability }] },
        }
        if (args.explicitMode) {
            options.isPipelineMode = true
        }
        const endpoint = sdk.EyePop.workerEndpoint(options)
        await endpoint.connect()
        try {
            const session = await endpoint.session()
            summary.pipeline_api_url = session.baseUrl
            if (!session.isPipelineMode || session.pipelineId) {
                throw new Error(`endpoint is not in pipeline mode (isPipelineMode=${session.isPipelineMode}, pipelineId=${session.pipelineId})`)
            }
            // Two jobs: the second reuses the socket and the pop the first one set.
            for (let n = 1; n <= 2; n++) {
                const jobStarted = Date.now()
                const job = await endpoint.process({ source: { path: resolve(args.image) } })
                let predictions = 0
                let matching = 0
                for await (const prediction of job) {
                    predictions += 1
                    matching += (prediction.objects ?? []).filter(o => o.classLabel === args.expectedClass && (o.confidence ?? 0) >= args.minConfidence).length
                }
                summary.jobs.push({ job: n, predictions, matching_objects: matching, seconds: (Date.now() - jobStarted) / 1000 })
                if (matching < args.minObjects) {
                    throw new Error(`job ${n}: ${matching} ${args.expectedClass} object(s) at confidence >= ${args.minConfidence}, wanted ${args.minObjects}`)
                }
            }
        } finally {
            await endpoint.disconnect()
        }
        summary.ok = true
    } catch (error) {
        summary.error = `${error?.name ?? 'Error'}: ${error?.message ?? error}`
    }
    summary.duration_seconds = (Date.now() - started) / 1000
    writeFileSync(args.summaryJson, JSON.stringify(summary, null, 2) + '\n')
    console.log(JSON.stringify(summary, null, 2))
    process.exit(summary.ok ? 0 : 1)
}

main()
