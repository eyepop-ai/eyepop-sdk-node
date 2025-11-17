import { EndpointState, EyePop } from '@eyepop.ai/eyepop'
import { pino } from 'pino'

const logger = pino({ level: 'debug', name: 'eyepop-example' })

;(async () => {
    try {
        const endpoint = await EyePop.dataEndpoint({
            logger: logger,
            disableWs: false
        })
            .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
                logger.info('Endpoint changed state %s -> %s', fromState, toState)
            })
            .connect()

        endpoint.addAccountEventHandler(async event => {
            logger.info('EVENT -> from account: %s', JSON.stringify(event))
        })

        process.stdin.resume() // Keeps the process alive until Ctrl+C
    } catch (e) {
        logger.error(e)
    }
})()
