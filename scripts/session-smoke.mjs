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

function parseArgs(argv) {
    const args = {
        environment: process.env.EYEPOP_ENV || 'production',
        eyepopUrl: process.env.EYEPOP_URL || '',
        apiKey: process.env.EYEPOP_API_KEY || '',
        sessionName: process.env.EYEPOP_SESSION_NAME || '',
        image: 'tests/test.jpg',
        popFile: process.env.EYEPOP_SMOKE_POP_FILE || '',
        ability: process.env.EYEPOP_SMOKE_ABILITY || 'eyepop.person:latest',
        expectedClass: process.env.EYEPOP_SMOKE_EXPECTED_CLASS || 'person',
        minObjects: Number(process.env.EYEPOP_SMOKE_MIN_OBJECTS || '1'),
        minConfidence: Number(process.env.EYEPOP_SMOKE_MIN_CONFIDENCE || '0.5'),
        timeoutSeconds: Number(process.env.EYEPOP_SMOKE_TIMEOUT_SECONDS || '600'),
        summaryJson: process.env.EYEPOP_SMOKE_SUMMARY_JSON || 'session-smoke-summary.json',
        sdkModule: process.env.EYEPOP_SMOKE_SDK_MODULE || './src/eyepop/dist/eyepop.index.js',
        noCleanup: false,
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
        throw new Error('Missing EYEPOP_API_KEY')
    }
    if (!Number.isFinite(args.minObjects) || args.minObjects < 1) {
        throw new Error('--min-objects must be at least 1')
    }
    if (!Number.isFinite(args.minConfidence) || args.minConfidence < 0 || args.minConfidence > 1) {
        throw new Error('--min-confidence must be between 0.0 and 1.0')
    }
    if (!existsSync(args.image)) {
        throw new Error(`Image fixture does not exist: ${args.image}`)
    }
    if (args.popFile && !existsSync(args.popFile)) {
        throw new Error(`Pop fixture does not exist: ${args.popFile}`)
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

function buildPop(args, sdk) {
    if (args.popFile) {
        return JSON.parse(readFileSync(args.popFile, 'utf8'))
    }
    return {
        components: [
            {
                type: sdk.PopComponentType?.INFERENCE || 'inference',
                ability: args.ability,
                categoryName: args.expectedClass,
            },
        ],
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
    const objects = predictions.flatMap(prediction => (Array.isArray(prediction.objects) ? prediction.objects : []))
    const expected = expectedClass.trim().toLowerCase()
    const matches = objects.filter(object => {
        const confidence = object?.confidence ?? 0
        return objectLabel(object).trim().toLowerCase() === expected && typeof confidence === 'number' && confidence >= minConfidence
    })

    return {
        prediction_count: predictions.length,
        object_count: objects.length,
        matching_object_count: matches.length,
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

async function runSmoke(args) {
    requireInputs(args)

    const started = Date.now()
    const deadline = started + args.timeoutSeconds * 1000
    const eyepopUrl = args.eyepopUrl || ENV_URLS[args.environment]
    const sdk = await importSdk(args.sdkModule)
    const preexistingTransientSessionUuids = await withDeadline(fetchTransientSessionUuids(args.apiKey, eyepopUrl), deadline, 'fetching existing sessions')
    const summary = {
        ok: false,
        environment: args.environment,
        sdk_module: args.sdkModule,
        sdk_version: sdk.version || sdk.VERSION || 'n/a',
        eyepop_url: eyepopUrl,
        image: args.image,
        image_name: basename(args.image),
        pop_file: args.popFile || '',
        ability: args.ability,
        expected_class: args.expectedClass,
        min_objects: args.minObjects,
        min_confidence: args.minConfidence,
        session_name: args.sessionName,
        session_uuid: '',
        session_uuid_short: '',
        pipeline_id: '',
        session_details: null,
        preexisting_transient_sessions: preexistingTransientSessionUuids.size,
        session_reused: false,
        cleanup: { ok: true, result: 'not_started' },
    }

    let endpoint
    let stream
    let sessionUuid = ''
    const requestedPop = buildPop(args, sdk)
    try {
        endpoint = await withDeadline(
            sdk.EyePop.workerEndpoint({
                auth: { apiKey: args.apiKey },
                eyepopUrl,
                pop: requestedPop,
                sessionName: args.sessionName,
            }).connect(),
            deadline,
            'connecting worker endpoint',
        )

        if (typeof endpoint.pop === 'function' && endpoint.pop() == null) {
            await withDeadline(endpoint.changePop(requestedPop), deadline, 'setting worker pop')
        }

        const session = await withDeadline(endpoint.session(), deadline, 'reading worker session')
        sessionUuid = sessionUuidFromUrl(session.baseUrl)
        summary.session_reused = preexistingTransientSessionUuids.has(sessionUuid)
        summary.session_uuid = sessionUuid
        summary.session_uuid_short = sessionUuid.slice(0, 8)
        summary.pipeline_id = session.pipelineId || ''

        const details = sessionUuid
            ? await withDeadline(fetchSessionDetails(args.apiKey, eyepopUrl, sessionUuid), deadline, 'fetching session details')
            : { ok: false, status: 0, body: 'missing session UUID' }
        summary.session_details = details.ok
            ? {
                  status: details.body.session_status,
                  active: details.body.session_active,
                  persistent: details.body.persistent,
                  compute_resources: details.body.compute_resources || null,
                  pipelines: details.body.pipelines || null,
              }
            : details

        stream = await withDeadline(
            endpoint.process({
                source: { path: args.image },
            }),
            deadline,
            'starting inference',
        )
        const predictions = []
        const iterator = stream[Symbol.asyncIterator]()
        while (true) {
            const next = await withDeadline(iterator.next(), deadline, 'reading inference results')
            if (next.done) {
                break
            }
            predictions.push(next.value)
        }

        const predictionSummary = summarizePredictions(predictions, args.expectedClass, args.minConfidence)
        Object.assign(summary, predictionSummary)

        if (predictionSummary.prediction_count === 0 || predictionSummary.matching_object_count < args.minObjects) {
            summary.error = `Expected at least ${args.minObjects} ${args.expectedClass} objects with confidence >= ${args.minConfidence}; got ${predictionSummary.matching_object_count}`
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
        if (stream && typeof stream.cancel === 'function') {
            try {
                stream.cancel()
            } catch (error) {
                summary.stream_cancel_error = errorSummary(error)
            }
        }

        if (endpoint) {
            try {
                await withDeadline(endpoint.disconnect(), Date.now() + 30 * 1000, 'disconnecting worker endpoint')
            } catch (error) {
                summary.disconnect_error = errorSummary(error)
            }
        }

        if (sessionUuid && summary.session_reused) {
            summary.cleanup = { ok: true, result: 'skipped_preexisting' }
        } else if (sessionUuid && !args.noCleanup) {
            try {
                summary.cleanup = await withDeadline(deleteTransientSession(args.apiKey, eyepopUrl, sessionUuid), Date.now() + 30 * 1000, 'deleting transient session')
            } catch (error) {
                summary.cleanup = {
                    ok: false,
                    result: 'error',
                    error: errorSummary(error),
                }
            }
        } else if (args.noCleanup) {
            summary.cleanup = { ok: true, result: 'skipped' }
        } else {
            summary.cleanup = { ok: false, result: 'missing_session_uuid' }
        }
    }

    summary.duration_seconds = Math.round((Date.now() - started) / 100) / 10
    summary.ok = !summary.error && Boolean(summary.cleanup?.ok)
    return summary
}

function writeSummary(path, summary) {
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
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
