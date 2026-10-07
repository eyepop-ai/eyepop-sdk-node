#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const require = createRequire(import.meta.url)

const ENV_URLS = {
    production: 'https://compute.eyepop.ai',
    staging: 'https://compute.staging.eyepop.xyz',
}

const USAGE = `Usage: node scripts/session-smoke.mjs [options]

Connects transient worker sessions through the SDK, runs inference on each, checks
the results, and writes a JSON summary. A value in parentheses is the environment
variable read when the option is not passed; a repo .env is loaded first.

Target:
  --environment <name>        production or staging (EYEPOP_ENV, default production)
  --eyepop-url <url>          compute URL, overriding the environment's (EYEPOP_URL)
  --api-key <key>             (EYEPOP_API_KEY)
  --session-name <prefix>     each scenario requests <prefix>-<scenario> (EYEPOP_SESSION_NAME)
  --sdk-module <path>         SDK build to load (EYEPOP_SMOKE_SDK_MODULE,
                              default ./src/eyepop/dist/eyepop.index.js)

Scenarios:
  --scenario <name>           gpu-direct, cpu-direct, vlm-direct, cpu-then-gpu-upgrade,
                              gpu-then-cpu-downgrade, legacy-change-pop, or all-transient
                              (EYEPOP_SMOKE_SCENARIO, default gpu-direct)
  --{gpu,cpu,vlm}-image <path>, --{gpu,cpu,vlm}-pop-file <path>, --{gpu,cpu,vlm}-ability <alias>,
  --{gpu,cpu,vlm}-expected-class <class>, --{gpu,cpu,vlm}-min-objects <n>,
  --{gpu,cpu,vlm}-min-confidence <0-1>, --vlm-min-texts <n>
                              what each step runs and must return
  --image, --pop-file, --ability, --expected-class, --min-objects, --min-confidence
                              defaults for the GPU step

Timing and output:
  --session-ready-timeout-seconds <s>   (default 60)
  --timeout-seconds <s>       deadline for each scenario (default 600)
  --summary-json <path>       (default session-smoke-summary.json)

Cleanup:
  After its scenarios, the smoke deletes only the transient sessions that its own
  POST /v1/sessions calls returned and that were not listed before the scenario
  connected. A session it reused is left alone.
  --no-cleanup                delete nothing
  --cleanup-preexisting       before each scenario, delete EVERY transient session of the
                              user, including sessions other clients are using right now
                              (EYEPOP_SMOKE_CLEANUP_PREEXISTING=true). Run it by hand only,
                              on an account nobody else uses. Never pass it in CI or with a
                              shared fixture user such as eyepop-testing basic or pro; the
                              script refuses to run it when CI=true.
  -h, --help                  print this help
`

function loadDotEnv(path = '.env') {
    if (!existsSync(path)) {
        return
    }
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
            continue
        }
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        if (!match || process.env[match[1]] !== undefined) {
            continue
        }
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        process.env[match[1]] = value
    }
}

function parseArgs(argv) {
    const args = {
        environment: process.env.EYEPOP_ENV || 'production',
        eyepopUrl: process.env.EYEPOP_URL || '',
        apiKey: process.env.EYEPOP_API_KEY || '',
        sessionName: process.env.EYEPOP_SESSION_NAME || '',
        scenario: process.env.EYEPOP_SMOKE_SCENARIO || 'gpu-direct',
        image: 'tests/test.jpg',
        popFile: process.env.EYEPOP_SMOKE_POP_FILE || '',
        ability: process.env.EYEPOP_SMOKE_ABILITY || 'eyepop.person:latest',
        expectedClass: process.env.EYEPOP_SMOKE_EXPECTED_CLASS || 'person',
        minObjects: Number(process.env.EYEPOP_SMOKE_MIN_OBJECTS || '1'),
        minConfidence: Number(process.env.EYEPOP_SMOKE_MIN_CONFIDENCE || '0.5'),
        gpuImage: process.env.EYEPOP_SMOKE_GPU_IMAGE || '',
        gpuPopFile: process.env.EYEPOP_SMOKE_GPU_POP_FILE || '',
        gpuAbility: process.env.EYEPOP_SMOKE_GPU_ABILITY || '',
        gpuExpectedClass: process.env.EYEPOP_SMOKE_GPU_EXPECTED_CLASS || '',
        gpuMinObjects: process.env.EYEPOP_SMOKE_GPU_MIN_OBJECTS ? Number(process.env.EYEPOP_SMOKE_GPU_MIN_OBJECTS) : undefined,
        gpuMinConfidence: process.env.EYEPOP_SMOKE_GPU_MIN_CONFIDENCE ? Number(process.env.EYEPOP_SMOKE_GPU_MIN_CONFIDENCE) : undefined,
        cpuImage: process.env.EYEPOP_SMOKE_CPU_IMAGE || 'tests/test.jpg',
        cpuPopFile: process.env.EYEPOP_SMOKE_CPU_POP_FILE || 'tests/fixtures/pops/localize-objects-modeless.json',
        cpuAbility: process.env.EYEPOP_SMOKE_CPU_ABILITY || '',
        cpuExpectedClass: process.env.EYEPOP_SMOKE_CPU_EXPECTED_CLASS || 'person',
        cpuMinObjects: Number(process.env.EYEPOP_SMOKE_CPU_MIN_OBJECTS || '1'),
        cpuMinConfidence: Number(process.env.EYEPOP_SMOKE_CPU_MIN_CONFIDENCE || '0'),
        vlmImage: process.env.EYEPOP_SMOKE_VLM_IMAGE || 'tests/test.jpg',
        vlmPopFile: process.env.EYEPOP_SMOKE_VLM_POP_FILE || '',
        vlmAbility: process.env.EYEPOP_SMOKE_VLM_ABILITY || 'eyepop-ai-eyepop-basic.describe.image:latest',
        vlmExpectedClass: process.env.EYEPOP_SMOKE_VLM_EXPECTED_CLASS || 'description',
        vlmMinObjects: Number(process.env.EYEPOP_SMOKE_VLM_MIN_OBJECTS || '0'),
        vlmMinConfidence: Number(process.env.EYEPOP_SMOKE_VLM_MIN_CONFIDENCE || '0'),
        vlmMinTexts: Number(process.env.EYEPOP_SMOKE_VLM_MIN_TEXTS || '1'),
        sessionReadyTimeoutSeconds: Number(process.env.EYEPOP_SMOKE_SESSION_READY_TIMEOUT_SECONDS || '60'),
        timeoutSeconds: Number(process.env.EYEPOP_SMOKE_TIMEOUT_SECONDS || '600'),
        summaryJson: process.env.EYEPOP_SMOKE_SUMMARY_JSON || 'session-smoke-summary.json',
        sdkModule: process.env.EYEPOP_SMOKE_SDK_MODULE || './src/eyepop/dist/eyepop.index.js',
        noCleanup: false,
        cleanupPreexisting: process.env.EYEPOP_SMOKE_CLEANUP_PREEXISTING === 'true',
        help: false,
    }

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        const next = () => {
            index += 1
            if (index >= argv.length) {
                throw new Error(`Missing value for ${arg}`)
            }
            return argv[index]
        }

        switch (arg) {
            case '--environment':
                args.environment = next()
                break
            case '--eyepop-url':
                args.eyepopUrl = next()
                break
            case '--api-key':
                args.apiKey = next()
                break
            case '--session-name':
                args.sessionName = next()
                break
            case '--scenario':
                args.scenario = next()
                break
            case '--image':
                args.image = next()
                break
            case '--pop-file':
                args.popFile = next()
                break
            case '--ability':
                args.ability = next()
                break
            case '--expected-class':
                args.expectedClass = next()
                break
            case '--min-objects':
                args.minObjects = Number(next())
                break
            case '--min-confidence':
                args.minConfidence = Number(next())
                break
            case '--gpu-image':
                args.gpuImage = next()
                break
            case '--gpu-pop-file':
                args.gpuPopFile = next()
                break
            case '--gpu-ability':
                args.gpuAbility = next()
                break
            case '--gpu-expected-class':
                args.gpuExpectedClass = next()
                break
            case '--gpu-min-objects':
                args.gpuMinObjects = Number(next())
                break
            case '--gpu-min-confidence':
                args.gpuMinConfidence = Number(next())
                break
            case '--cpu-image':
                args.cpuImage = next()
                break
            case '--cpu-pop-file':
                args.cpuPopFile = next()
                break
            case '--cpu-ability':
                args.cpuAbility = next()
                break
            case '--cpu-expected-class':
                args.cpuExpectedClass = next()
                break
            case '--cpu-min-objects':
                args.cpuMinObjects = Number(next())
                break
            case '--cpu-min-confidence':
                args.cpuMinConfidence = Number(next())
                break
            case '--vlm-image':
                args.vlmImage = next()
                break
            case '--vlm-pop-file':
                args.vlmPopFile = next()
                break
            case '--vlm-ability':
                args.vlmAbility = next()
                break
            case '--vlm-expected-class':
                args.vlmExpectedClass = next()
                break
            case '--vlm-min-objects':
                args.vlmMinObjects = Number(next())
                break
            case '--vlm-min-confidence':
                args.vlmMinConfidence = Number(next())
                break
            case '--vlm-min-texts':
                args.vlmMinTexts = Number(next())
                break
            case '--session-ready-timeout-seconds':
                args.sessionReadyTimeoutSeconds = Number(next())
                break
            case '--timeout-seconds':
                args.timeoutSeconds = Number(next())
                break
            case '--summary-json':
                args.summaryJson = next()
                break
            case '--sdk-module':
                args.sdkModule = next()
                break
            case '--no-cleanup':
                args.noCleanup = true
                break
            case '--cleanup-preexisting':
                args.cleanupPreexisting = true
                break
            case '-h':
            case '--help':
                args.help = true
                break
            default:
                throw new Error(`Unknown argument: ${arg}`)
        }
    }

    return args
}

function requireInputs(args) {
    if (!ENV_URLS[args.environment] && !args.eyepopUrl) {
        throw new Error(`Unknown environment ${args.environment}; pass --eyepop-url`)
    }
    if (!args.apiKey) {
        throw new Error('Missing EYEPOP_API_KEY; load an eyepop-testing fixture or fill out repo .env from .env.example')
    }
    if (args.cleanupPreexisting && process.env.CI === 'true') {
        throw new Error('--cleanup-preexisting deletes every transient session of the user, including other CI runs on a shared fixture; it is for manual use only')
    }
    if (!Number.isFinite(args.minObjects) || args.minObjects < 0) {
        throw new Error('--min-objects must be at least 0')
    }
    if (!Number.isFinite(args.minConfidence) || args.minConfidence < 0 || args.minConfidence > 1) {
        throw new Error('--min-confidence must be between 0.0 and 1.0')
    }
    if (!Number.isFinite(args.sessionReadyTimeoutSeconds) || args.sessionReadyTimeoutSeconds <= 0) {
        throw new Error('--session-ready-timeout-seconds must be greater than 0')
    }
    if (!scenarioDefinitions(args).some(definition => definition.name === args.scenario) && args.scenario !== 'all-transient') {
        throw new Error(`Unknown scenario ${args.scenario}`)
    }
    for (const scenario of selectedScenarioDefinitions(args)) {
        for (const step of scenario.steps) {
            if (!Number.isFinite(step.minObjects) || step.minObjects < 0) {
                throw new Error(`${scenario.name} ${step.name} min objects must be at least 0`)
            }
            if (!Number.isFinite(step.minConfidence) || step.minConfidence < 0 || step.minConfidence > 1) {
                throw new Error(`${scenario.name} ${step.name} min confidence must be between 0.0 and 1.0`)
            }
            if (!Number.isFinite(step.minTexts) || step.minTexts < 0) {
                throw new Error(`${scenario.name} ${step.name} min texts must be at least 0`)
            }
            if (step.image && !existsSync(step.image)) {
                throw new Error(`Image fixture does not exist: ${step.image}`)
            }
            if (step.popFile && !existsSync(step.popFile)) {
                throw new Error(`Pop fixture does not exist: ${step.popFile}`)
            }
        }
    }
}

async function importSdk(specifier) {
    if (specifier.endsWith('.js') || (!specifier.endsWith('.mjs') && !specifier.startsWith('file:'))) {
        return require(resolveImportSpecifier(specifier))
    }
    const moduleSpecifier = pathToFileURL(resolve(specifier)).href
    return import(moduleSpecifier)
}

function resolveImportSpecifier(specifier) {
    return specifier.startsWith('.') || specifier.startsWith('/') || existsSync(specifier) ? resolve(specifier) : specifier
}

function buildPop(step, sdk) {
    if (step.popFile) {
        return JSON.parse(readFileSync(step.popFile, 'utf8'))
    }
    return {
        components: [
            {
                type: sdk.PopComponentType?.INFERENCE || 'inference',
                ability: step.ability,
                categoryName: step.expectedClass,
            },
        ],
    }
}

function scenarioDefinitions(args) {
    const gpuStep = {
        name: 'gpu-inference',
        popFile: args.gpuPopFile || args.popFile,
        ability: args.gpuAbility || args.ability,
        expectedClass: args.gpuExpectedClass || args.expectedClass,
        image: args.gpuImage || args.image,
        minObjects: Number.isFinite(args.gpuMinObjects) ? args.gpuMinObjects : args.minObjects,
        minConfidence: Number.isFinite(args.gpuMinConfidence) ? args.gpuMinConfidence : args.minConfidence,
        minTexts: 0,
    }
    const cpuStep = {
        name: 'cpu-inference',
        popFile: args.cpuPopFile,
        ability: args.cpuAbility,
        expectedClass: args.cpuExpectedClass,
        image: args.cpuImage,
        minObjects: args.cpuMinObjects,
        minConfidence: args.cpuMinConfidence,
        minTexts: 0,
    }

    const vlmStep = {
        name: 'vlm-inference',
        popFile: args.vlmPopFile,
        ability: args.vlmAbility,
        expectedClass: args.vlmExpectedClass,
        image: args.vlmImage,
        minObjects: args.vlmMinObjects,
        minConfidence: args.vlmMinConfidence,
        minTexts: args.vlmMinTexts,
    }

    return [
        {
            name: 'gpu-direct',
            startMode: 'constructor-pop',
            steps: [gpuStep],
        },
        {
            name: 'cpu-direct',
            startMode: 'constructor-pop',
            steps: [cpuStep],
        },
        {
            name: 'vlm-direct',
            startMode: 'constructor-pop',
            steps: [vlmStep],
        },
        {
            name: 'cpu-then-gpu-upgrade',
            startMode: 'reconnect-per-step',
            steps: [cpuStep, gpuStep, cpuStep],
        },
        {
            name: 'gpu-then-cpu-downgrade',
            startMode: 'reconnect-per-step',
            steps: [gpuStep, cpuStep],
        },
        {
            name: 'legacy-change-pop',
            startMode: 'no-pop-then-change-pop',
            steps: [gpuStep],
        },
    ]
}

function selectedScenarioDefinitions(args) {
    const definitions = scenarioDefinitions(args)
    if (args.scenario === 'all-transient') {
        return definitions
    }
    return definitions.filter(definition => definition.name === args.scenario)
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
    const objects = predictions.flatMap(prediction => [
        ...(Array.isArray(prediction.objects) ? prediction.objects : []),
        ...(Array.isArray(prediction.classes) ? prediction.classes : []),
    ])
    const texts = predictions.flatMap(prediction => (Array.isArray(prediction.texts) ? prediction.texts : []))
    const nonEmptyTexts = texts.map(text => String(text?.text ?? '').trim()).filter(Boolean)
    const expected = expectedClass.trim().toLowerCase()
    const matches = objects.filter(object => {
        const confidence = object?.confidence ?? 0
        return objectLabel(object).trim().toLowerCase() === expected && typeof confidence === 'number' && confidence >= minConfidence
    })

    return {
        prediction_count: predictions.length,
        object_count: objects.length,
        matching_object_count: matches.length,
        text_count: texts.length,
        non_empty_text_count: nonEmptyTexts.length,
        sample_texts: nonEmptyTexts.slice(0, 3).map(text => text.slice(0, 160)),
        top_matches: matches.slice(0, 5).map(object => ({
            class: objectLabel(object),
            confidence: object.confidence,
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
        })),
    }
}

function sessionUuidFromUrl(baseUrl) {
    if (!baseUrl) {
        return ''
    }
    try {
        const parsed = new URL(baseUrl)
        return parsed.pathname.split('/').filter(Boolean)[0] || ''
    } catch {
        return ''
    }
}

function sessionUuidFromError(error) {
    const message = `${error?.message || error || ''}`
    const match = message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)
    return match?.[0] || ''
}

function errorSummary(error) {
    const name = error?.name || 'Error'
    const message = error?.message || `${error}`
    const cause = error?.cause
    if (cause?.message) {
        return `${name}: ${message}; cause: ${cause.message}`
    }
    if (typeof cause === 'string') {
        return `${name}: ${message}; cause: ${cause}`
    }
    return `${name}: ${message}`
}

function remainingMs(deadline) {
    return Math.max(1, deadline - Date.now())
}

async function withDeadline(promise, deadline, label) {
    let timer
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after smoke deadline`)), remainingMs(deadline))
            }),
        ])
    } finally {
        clearTimeout(timer)
    }
}

async function fetchSessionDetails(apiKey, eyepopUrl, sessionUuid) {
    const response = await fetch(`${eyepopUrl.replace(/\/+$/, '')}/v1/sessions/${sessionUuid}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
    })
    const body = await response.text()
    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            body: body.slice(0, 300),
        }
    }
    return {
        ok: true,
        status: response.status,
        body: JSON.parse(body),
    }
}

async function fetchTransientSessionUuids(apiKey, eyepopUrl) {
    const response = await fetch(`${eyepopUrl.replace(/\/+$/, '')}/v1/sessions`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
    })
    if (response.status === 404) {
        return new Set()
    }
    const body = await response.text()
    if (!response.ok) {
        throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${body.slice(0, 300)}`)
    }
    const sessions = JSON.parse(body)
    if (!Array.isArray(sessions)) {
        return new Set()
    }
    return new Set(
        sessions
            .filter(session => !session.persistent)
            .map(session => session.session_uuid)
            .filter(sessionUuid => typeof sessionUuid === 'string' && sessionUuid.length > 0),
    )
}

async function deleteTransientSession(apiKey, eyepopUrl, sessionUuid) {
    const response = await fetch(`${eyepopUrl.replace(/\/+$/, '')}/v1/sessions/${sessionUuid}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
    })
    const body = await response.text()
    const ok = [200, 202, 204, 404].includes(response.status)
    return {
        ok,
        status: response.status,
        result: response.status === 404 ? 'already_absent' : 'deleted',
        body: body && !ok ? body.slice(0, 300) : '',
    }
}

// The SDK's Node HTTP client (src/eyepop/shims/http_client.ts) with the same undici
// agent, except that it adds the session UUID of every successful POST /v1/sessions
// to createdSessionUuids. Cleanup trusts only these UUIDs: the fixture users are
// shared with other CI, and compute-api names a new transient eyepop-b-<uuid> rather
// than the requested session name, so a name never proves a session is this run's.
function sessionRecordingPlatformSupport(sdkModule, createdSessionUuids) {
    const undici = createRequire(require.resolve(resolveImportSpecifier(sdkModule)))('undici')
    return {
        createHttpClient: async () => {
            const agent = new undici.Agent({ keepAliveTimeout: 10000, connections: 5, pipelining: 0 })
            return {
                async fetch(input, init) {
                    const response = await undici.fetch(input, { ...init, dispatcher: agent })
                    const request = typeof input === 'object' && 'method' in input ? input : null
                    const method = (request?.method || init?.method || 'GET').toUpperCase()
                    const url = new URL(request ? request.url : `${input}`)
                    if (response.status === 200 && method === 'POST' && url.pathname.replace(/\/+$/, '').endsWith('/v1/sessions')) {
                        let sessions = []
                        try {
                            sessions = await response.clone().json()
                        } catch (error) {
                            void error
                        }
                        for (const session of Array.isArray(sessions) ? sessions : [sessions]) {
                            if (typeof session?.session_uuid === 'string' && session.session_uuid) {
                                createdSessionUuids.add(session.session_uuid)
                            }
                        }
                    }
                    return response
                },
                close: () => agent.close(),
                isFullDuplex: () => false,
            }
        },
    }
}

async function deleteCreatedSessions(apiKey, eyepopUrl, sessionUuids) {
    const deletions = []
    for (const sessionUuid of sessionUuids) {
        try {
            deletions.push({
                session_uuid: sessionUuid,
                ...(await withDeadline(deleteTransientSession(apiKey, eyepopUrl, sessionUuid), Date.now() + 30 * 1000, `deleting transient session ${sessionUuid}`)),
            })
        } catch (error) {
            deletions.push({
                session_uuid: sessionUuid,
                ok: false,
                result: 'error',
                error: errorSummary(error),
            })
        }
    }
    return deletions
}

async function collectInference(endpoint, step, deadline) {
    let stream
    try {
        stream = await withDeadline(
            endpoint.process({
                source: { path: step.image },
            }),
            deadline,
            `starting inference for ${step.name}`,
        )
        const predictions = []
        const iterator = stream[Symbol.asyncIterator]()
        while (true) {
            const next = await withDeadline(iterator.next(), deadline, `reading inference results for ${step.name}`)
            if (next.done) {
                break
            }
            predictions.push(next.value)
        }

        const predictionSummary = summarizePredictions(predictions, step.expectedClass, step.minConfidence)
        if (predictionSummary.prediction_count === 0) {
            predictionSummary.error = `Expected inference predictions; got 0`
        } else if (predictionSummary.matching_object_count < step.minObjects) {
            predictionSummary.error = `Expected at least ${step.minObjects} ${step.expectedClass} objects with confidence >= ${step.minConfidence}; got ${predictionSummary.matching_object_count}`
        } else if (predictionSummary.non_empty_text_count < step.minTexts) {
            predictionSummary.error = `Expected at least ${step.minTexts} non-empty texts; got ${predictionSummary.non_empty_text_count}`
        }
        return predictionSummary
    } finally {
        if (stream && typeof stream.cancel === 'function') {
            try {
                stream.cancel()
            } catch (error) {
                void error
            }
        }
    }
}

async function captureSession(endpoint, args, eyepopUrl, preexistingTransientSessionUuids, deadline) {
    const session = await withDeadline(endpoint.session(), deadline, 'reading worker session')
    const sessionUuid = sessionUuidFromUrl(session.baseUrl)
    const details = sessionUuid
        ? await withDeadline(fetchSessionDetails(args.apiKey, eyepopUrl, sessionUuid), deadline, 'fetching session details')
        : { ok: false, status: 0, body: 'missing session UUID' }

    return {
        sessionUuid,
        sessionUuidShort: sessionUuid.slice(0, 8),
        sessionReused: preexistingTransientSessionUuids.has(sessionUuid),
        pipelineId: session.pipelineId || '',
        details: details.ok
            ? {
                  status: details.body.session_status,
                  active: details.body.session_active,
                  persistent: details.body.persistent,
                  compute_resources: details.body.compute_resources || null,
                  pipelines: details.body.pipelines || null,
              }
            : details,
    }
}

async function runScenario(args, sdk, eyepopUrl, scenario) {
    const started = Date.now()
    const deadline = started + args.timeoutSeconds * 1000
    let preexistingTransientSessionUuids = new Set()
    const createdSessionUuids = new Set()
    const platformSupport = sessionRecordingPlatformSupport(args.sdkModule, createdSessionUuids)
    const firstStep = scenario.steps[0]
    const sessionName = args.sessionName ? `${args.sessionName}-${scenario.name}` : `node-session-smoke-${Date.now()}-${scenario.name}`
    const summary = {
        ok: false,
        scenario: scenario.name,
        start_mode: scenario.startMode,
        environment: args.environment,
        sdk_module: args.sdkModule,
        sdk_version: sdk.version || sdk.VERSION || 'n/a',
        eyepop_url: eyepopUrl,
        image: firstStep.image,
        image_name: basename(firstStep.image),
        pop_file: firstStep.popFile || '',
        ability: firstStep.ability,
        expected_class: firstStep.expectedClass,
        min_objects: firstStep.minObjects,
        min_confidence: firstStep.minConfidence,
        session_name: sessionName,
        session_uuid: '',
        session_uuid_short: '',
        pipeline_id: '',
        session_details: null,
        session_uuid_preserved: null,
        steps: [],
        preexisting_transient_sessions: preexistingTransientSessionUuids.size,
        preexisting_transient_sessions_deleted: 0,
        session_reused: false,
        created_session_uuids: [],
        cleanup: { ok: true, result: 'not_started' },
    }

    let endpoint
    let sessionUuid = ''
    try {
        preexistingTransientSessionUuids = await withDeadline(fetchTransientSessionUuids(args.apiKey, eyepopUrl), deadline, 'fetching existing sessions')
        summary.preexisting_transient_sessions = preexistingTransientSessionUuids.size
        if (args.cleanupPreexisting && preexistingTransientSessionUuids.size > 0) {
            for (const existingSessionUuid of preexistingTransientSessionUuids) {
                await withDeadline(deleteTransientSession(args.apiKey, eyepopUrl, existingSessionUuid), deadline, `deleting preexisting session ${existingSessionUuid}`)
                summary.preexisting_transient_sessions_deleted += 1
            }
        }

        const connectOptions = {
            auth: { apiKey: args.apiKey },
            eyepopUrl,
            sessionName,
            sessionReadyTimeoutSeconds: args.sessionReadyTimeoutSeconds,
            platformSupport,
        }
        if (scenario.startMode === 'constructor-pop') {
            connectOptions.pop = buildPop(firstStep, sdk)
        }

        endpoint = await withDeadline(
            sdk.EyePop.workerEndpoint(connectOptions).connect(),
            deadline,
            'connecting worker endpoint',
        )

        if (scenario.startMode === 'no-pop-then-change-pop') {
            await withDeadline(endpoint.changePop(buildPop(firstStep, sdk)), deadline, `setting worker pop for ${scenario.name}`)
        } else if (typeof endpoint.pop === 'function' && endpoint.pop() == null) {
            await withDeadline(endpoint.changePop(buildPop(firstStep, sdk)), deadline, 'setting worker pop')
        }

        const initialSession = await captureSession(endpoint, args, eyepopUrl, preexistingTransientSessionUuids, deadline)
        sessionUuid = initialSession.sessionUuid
        summary.session_reused = initialSession.sessionReused
        summary.session_uuid = initialSession.sessionUuid
        summary.session_uuid_short = initialSession.sessionUuidShort
        summary.pipeline_id = initialSession.pipelineId
        summary.session_details = initialSession.details

        const firstPredictionSummary = await collectInference(endpoint, firstStep, deadline)
        summary.steps.push({
            name: firstStep.name,
            image: firstStep.image,
            image_name: basename(firstStep.image),
            pop_file: firstStep.popFile || '',
            ability: firstStep.ability,
            expected_class: firstStep.expectedClass,
            min_objects: firstStep.minObjects,
            min_confidence: firstStep.minConfidence,
            min_texts: firstStep.minTexts,
            pipeline_id: summary.pipeline_id,
            ...firstPredictionSummary,
        })
        Object.assign(summary, firstPredictionSummary)

        if (firstPredictionSummary.error) {
            summary.error = firstPredictionSummary.error
        }

        if (!summary.error && scenario.startMode === 'reconnect-per-step' && scenario.steps.length > 1) {
            for (let stepIndex = 1; stepIndex < scenario.steps.length && !summary.error; stepIndex++) {
                const step = scenario.steps[stepIndex]

                await withDeadline(endpoint.disconnect(), Date.now() + 30 * 1000, `disconnecting before step ${stepIndex + 1}`)
                endpoint = null

                const reconnectOptions = {
                    auth: { apiKey: args.apiKey },
                    eyepopUrl,
                    sessionName,
                    sessionReadyTimeoutSeconds: args.sessionReadyTimeoutSeconds,
                    pop: buildPop(step, sdk),
                    platformSupport,
                }
                endpoint = await withDeadline(
                    sdk.EyePop.workerEndpoint(reconnectOptions).connect(),
                    deadline,
                    `reconnecting for step ${stepIndex + 1} (${step.name})`,
                )

                const reconnectedSession = await captureSession(endpoint, args, eyepopUrl, preexistingTransientSessionUuids, deadline)
                summary.session_uuid_preserved = sessionUuid === reconnectedSession.sessionUuid
                summary.pipeline_id = reconnectedSession.pipelineId
                summary.session_details = reconnectedSession.details

                if (!summary.session_uuid_preserved) {
                    summary.error = `Step ${stepIndex + 1}: session UUID changed from ${sessionUuid} to ${reconnectedSession.sessionUuid}`
                    break
                }

                const stepPredictions = await collectInference(endpoint, step, deadline)
                summary.steps.push({
                    name: step.name,
                    image: step.image,
                    image_name: basename(step.image),
                    pop_file: step.popFile || '',
                    ability: step.ability,
                    expected_class: step.expectedClass,
                    min_objects: step.minObjects,
                    min_confidence: step.minConfidence,
                    min_texts: step.minTexts,
                    pipeline_id: reconnectedSession.pipelineId,
                    ...stepPredictions,
                })
                Object.assign(summary, stepPredictions)

                if (stepPredictions.error) {
                    summary.error = stepPredictions.error
                }
            }
        } else if (!summary.error && scenario.steps.length > 1) {
            const nextStep = scenario.steps[1]
            await withDeadline(endpoint.changePop(buildPop(nextStep, sdk)), deadline, `upgrading pop for ${scenario.name}`)
            const upgradedSession = await captureSession(endpoint, args, eyepopUrl, preexistingTransientSessionUuids, deadline)
            summary.upgraded_session_uuid = upgradedSession.sessionUuid
            summary.upgraded_session_uuid_short = upgradedSession.sessionUuidShort
            summary.upgraded_pipeline_id = upgradedSession.pipelineId
            summary.upgraded_session_details = upgradedSession.details
            summary.session_uuid_preserved = sessionUuid === upgradedSession.sessionUuid
            summary.pipeline_id = upgradedSession.pipelineId
            summary.session_details = upgradedSession.details

            const upgradedPredictionSummary = await collectInference(endpoint, nextStep, deadline)
            summary.steps.push({
                name: nextStep.name,
                image: nextStep.image,
                image_name: basename(nextStep.image),
                pop_file: nextStep.popFile || '',
                ability: nextStep.ability,
                expected_class: nextStep.expectedClass,
                min_objects: nextStep.minObjects,
                min_confidence: nextStep.minConfidence,
                min_texts: nextStep.minTexts,
                pipeline_id: upgradedSession.pipelineId,
                ...upgradedPredictionSummary,
            })
            Object.assign(summary, upgradedPredictionSummary)

            if (!summary.session_uuid_preserved) {
                summary.error = `Expected upgrade to preserve session UUID ${sessionUuid}; got ${upgradedSession.sessionUuid}`
            } else if (upgradedPredictionSummary.error) {
                summary.error = upgradedPredictionSummary.error
            }
        }
    } catch (error) {
        if (!sessionUuid) {
            sessionUuid = sessionUuidFromError(error)
            if (sessionUuid) {
                summary.session_reused = preexistingTransientSessionUuids.has(sessionUuid)
                summary.session_uuid = sessionUuid
                summary.session_uuid_short = sessionUuid.slice(0, 8)
            }
        }
        summary.error = errorSummary(error)
    } finally {
        if (endpoint) {
            try {
                await withDeadline(endpoint.disconnect(), Date.now() + 30 * 1000, 'disconnecting worker endpoint')
            } catch (error) {
                summary.disconnect_error = errorSummary(error)
            }
        }

        // Only a session this scenario's own create returned, and that did not
        // exist before it connected, is this run's to delete.
        summary.created_session_uuids = [...createdSessionUuids].filter(uuid => !preexistingTransientSessionUuids.has(uuid))
        if (args.noCleanup) {
            summary.cleanup = { ok: true, result: 'skipped' }
        } else if (summary.created_session_uuids.length > 0) {
            const deletions = await deleteCreatedSessions(args.apiKey, eyepopUrl, summary.created_session_uuids)
            const failed = deletions.find(deletion => !deletion.ok)
            summary.cleanup = { ok: !failed, result: failed ? 'error' : 'deleted', error: failed?.error || failed?.body, sessions: deletions }
        } else if (summary.session_reused) {
            summary.cleanup = { ok: true, result: 'skipped_preexisting' }
        } else if (sessionUuid) {
            summary.cleanup = { ok: false, result: 'skipped_not_created', error: `session ${sessionUuid} was not created by this scenario; left in place` }
        } else {
            summary.cleanup = { ok: false, result: 'missing_session_uuid' }
        }
    }

    summary.duration_seconds = Math.round((Date.now() - started) / 100) / 10
    summary.ok = !summary.error && Boolean(summary.cleanup?.ok)
    return summary
}

async function runSmoke(args) {
    requireInputs(args)

    const eyepopUrl = args.eyepopUrl || ENV_URLS[args.environment]
    const sdk = await importSdk(args.sdkModule)
    const scenarios = selectedScenarioDefinitions(args)
    if (scenarios.length === 1) {
        return runScenario(args, sdk, eyepopUrl, scenarios[0])
    }

    const started = Date.now()
    const summaries = []
    for (const scenario of scenarios) {
        summaries.push(await runScenario({ ...args, noCleanup: true }, sdk, eyepopUrl, scenario))
    }

    const suiteCleanup = args.noCleanup
        ? []
        : await deleteCreatedSessions(args.apiKey, eyepopUrl, new Set(summaries.flatMap(summary => summary.created_session_uuids || [])))
    const failedCleanup = suiteCleanup.find(cleanup => !cleanup.ok)
    return {
        ok: summaries.every(summary => summary.ok) && suiteCleanup.every(cleanup => cleanup.ok),
        scenario: args.scenario,
        environment: args.environment,
        sdk_module: args.sdkModule,
        sdk_version: sdk.version || sdk.VERSION || 'n/a',
        eyepop_url: eyepopUrl,
        session_name: args.sessionName,
        scenarios: summaries,
        suite_cleanup: suiteCleanup,
        duration_seconds: Math.round((Date.now() - started) / 100) / 10,
        error:
            summaries.find(summary => !summary.ok)?.error ||
            (failedCleanup ? failedCleanup.error || failedCleanup.body || `cleanup failed with status ${failedCleanup.status}` : undefined),
    }
}

function writeSummary(path, summary) {
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)
}

async function main() {
    loadDotEnv()
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
        console.log(USAGE)
        process.exit(0)
    }
    let summary
    try {
        summary = await runSmoke(args)
    } catch (error) {
        summary = {
            ok: false,
            environment: args.environment,
            session_name: args.sessionName,
            error: errorSummary(error),
        }
    }

    writeSummary(args.summaryJson, summary)
    console.log(JSON.stringify(summary, null, 2))
    process.exit(summary.ok ? 0 : 1)
}

main()
