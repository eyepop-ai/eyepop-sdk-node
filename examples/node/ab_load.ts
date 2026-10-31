/**
 * Load client for the pipeline mode A/B runs: the Node SDK's twin of eyepop-instance examples/demo/account.py, with the
 * same summary lines so report.sh reads both. EYEPOP_URL names the compute API, SAMPLES the folder with images/ and
 * video/, RTSP_BASE the stream server whose cam-01, cam-02, ... the streams run read, and SOCKETS sets pipelineSockets.
 *   EYEPOP_ACCESS_TOKEN=... npx tsx examples/node/ab_load.ts images 500 --pop "common objects" --for 240 --every 1
 *   ... streams 4 --first-cam 1 --pop "common objects" --for 600
 *   ... video explosion_2.mp4 --pop "common objects" --every 5 --for 480
 */
import { EyePop, PipelineCommandError, PipelineSocketClosedError, PipelineSourceError } from '@eyepop.ai/eyepop'
import { readdirSync } from 'fs'
import { pino } from 'pino'
import process from 'process'

const SAMPLES = process.env['SAMPLES'] ?? 'samples'
const RTSP = (cam: number) => `${process.env['RTSP_BASE']}/cam-${String(cam).padStart(2, '0')}`
const POPS: Record<string, any> = {
    'common objects': { components: [{ type: 'inference', ability: 'eyepop.common-objects.large:latest' }] },
    'person, then faces': {
        components: [{
            type: 'inference', ability: 'eyepop.person:latest',
            forward: { operator: { type: 'crop', crop: { maxItems: 128, boxPadding: 0.25 } }, targets: [{ type: 'inference', ability: 'eyepop.person.face.short-range:latest' }] },
        }],
    },
}

const argv = process.argv.slice(2)
const opt = (name: string, dflt?: string) => {
    const i = argv.indexOf(name)
    if (i < 0) return dflt
    const v = argv[i + 1]
    argv.splice(i, 2)
    return v
}
const popName = opt('--pop', 'common objects')!
const duration = Number(opt('--for', '300')) * 1000
const everyArg = opt('--every')
const every = everyArg !== undefined ? Number(everyArg) : undefined
const firstCam = Number(opt('--first-cam', '1'))
const [what, arg] = argv
const account = process.env['ACCOUNT'] ?? 'node'
const logger = pino({ level: 'warn', name: 'ab-load' })
const hms = () => new Date().toTimeString().slice(0, 8)
const token = process.env['EYEPOP_ACCESS_TOKEN']
if (!token) throw new Error('EYEPOP_ACCESS_TOKEN is not set')
if (!['images', 'video', 'streams'].includes(what ?? '') || arg === undefined) throw new Error('usage: ab_load.ts images <count> | video <file> | streams <count> [options]')
if (POPS[popName] === undefined) throw new Error(`unknown --pop ${popName}; one of ${Object.keys(POPS).join(', ')}`)
// Jobs that failed, so that the exit status says the run had failures.
let failures = 0

const newEp = () => EyePop.workerEndpoint({ isPipelineMode: true, pipelineSockets: Number(process.env['SOCKETS'] ?? 4), accessToken: token, eyepopUrl: process.env['EYEPOP_URL'], logger, pop: POPS[popName] })

function errorKind(e: any): string {
    if (e instanceof PipelineSourceError) return `source ended ${e.reason}`
    if (e instanceof PipelineCommandError) return `error ${e.error}`
    if (e instanceof PipelineSocketClosedError) return `socket closed ${e.code} ${e.reason}`
    return `${e?.name}: ${String(e?.message).slice(0, 80)}`
}

async function images(ep: any, count: number) {
    const files = readdirSync(`${SAMPLES}/images`).filter(f => /\.(jpe?g|png)$/i.test(f)).sort()
    const batch = Array.from({ length: count }, (_, i) => `${SAMPLES}/images/${files[i % files.length]}`)
    const t0 = performance.now()
    const errors: Record<string, number> = {}
    // Every upload goes out at once on the one socket, as account.py does.
    const results = await Promise.allSettled(batch.map(async path => {
        let took: number | undefined
        try {
            for await (const _ of await ep.process({ source: { path } })) took ??= (performance.now() - t0) / 1000
        } catch (e) {
            // Counted as it fails, in case the batch never settles before --for ends the run.
            failures += 1
            throw e
        }
        return took
    }))
    for (const r of results) if (r.status === 'rejected') errors[errorKind(r.reason)] = (errors[errorKind(r.reason)] ?? 0) + 1
    const firsts = results.flatMap(r => (r.status === 'fulfilled' && r.value !== undefined ? [r.value] : [])).sort((a, b) => a - b)
    const failed = Object.values(errors).reduce((a, b) => a + b, 0)
    let line = `${hms()} ${account}: batch of ${count} images on ${popName} took ${((performance.now() - t0) / 1000).toFixed(1)} s`
    line += firsts.length ? `; ${firsts.length} predicted, ${count - firsts.length - failed} without a prediction, first after ${firsts[0].toFixed(1)} s, median ${firsts[firsts.length >> 1].toFixed(1)} s` : '; none predicted'
    console.log(line + (failed ? `; ${failed} failed: ${JSON.stringify(errors)}` : ''))
}

async function video(ep: any, name: string) {
    const t0 = performance.now()
    let frames = 0
    let first: number | undefined
    try {
        for await (const _ of await ep.process({ source: { path: `${SAMPLES}/video/${name}` } })) {
            first ??= (performance.now() - t0) / 1000
            frames++
        }
    } catch (e) {
        // Counted and logged, so --every goes on to the next run.
        failures += 1
        console.log(`${hms()} ${account}: video ${name} on ${popName} failed after ${frames} frames: ${errorKind(e)}`)
        return
    }
    const took = (performance.now() - t0) / 1000
    console.log(`${hms()} ${account}: video ${name} on ${popName}, first result after ${(first ?? 0).toFixed(1)} s, ${frames} frames in ${took.toFixed(1)} s (${(frames / took).toFixed(1)} per second)`)
}

async function streams(count: number, stop: Promise<void>) {
    const cams = Array.from({ length: count }, (_, i) => firstCam + i)
    const arrivals = new Map<number, number[]>(cams.map(c => [c, []]))
    const ended = new Map<number, string>()
    const eps: any[] = []
    const jobs: any[] = []
    for (const cam of cams) {
        ;(async () => {
            try {
                const ep = await newEp().connect()
                eps.push(ep)
                const job = await ep.process({ source: { url: RTSP(cam) } })
                jobs.push(job)
                for await (const _ of job) arrivals.get(cam)!.push(performance.now())
                ended.set(cam, 'closed')
            } catch (e) {
                ended.set(cam, errorKind(e))
                failures += 1
                console.log(`  cam-${cam} ${hms()} raised ${errorKind(e)}`)
            }
        })()
    }
    const tick = setInterval(() => {
        const now = performance.now()
        const fps = cams.map(c => arrivals.get(c)!.filter(t => t > now - 15000).length / 15)
        for (const c of cams) arrivals.set(c, arrivals.get(c)!.filter(t => t > now - 15000))
        console.log(`${hms()} ${account}: ${fps.filter(f => f > 0).length}/${count} predicting, fps min ${Math.min(...fps).toFixed(2)} total ${fps.reduce((a, b) => a + b, 0).toFixed(1)}` + (ended.size ? `; ended: ${JSON.stringify(Object.fromEntries(ended))}` : ''))
    }, 15000)
    await stop
    clearInterval(tick)
    for (const job of jobs) job.cancel()
    await Promise.allSettled(eps.map(ep => ep.disconnect()))
}

;(async () => {
    const stop = new Promise<void>(resolve => setTimeout(resolve, duration))
    let stopped = false
    stop.then(() => (stopped = true))
    if (what === 'streams') {
        await streams(Number(arg), stop)
    } else {
        const ep = await newEp().connect()
        try {
            const run = what === 'images' ? () => images(ep, Number(arg)) : () => video(ep, arg)
            while (!stopped) {
                const began = performance.now()
                await Promise.race([run(), stop])
                if (every === undefined || stopped) break
                await new Promise(r => setTimeout(r, Math.max(0, began + every * 1000 - performance.now())))
            }
        } finally {
            await Promise.race([ep.disconnect(), new Promise(r => setTimeout(r, 10000))])
        }
    }
    console.log(`${hms()} ${account}: stopped after ${duration / 1000} s (--for)`)
    process.exit(failures > 0 ? 1 : 0)
})()
