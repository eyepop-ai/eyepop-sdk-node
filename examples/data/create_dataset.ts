import { EndpointState, EyePop, Prediction, UserReview } from '@eyepop.ai/eyepop'

import { pino } from 'pino'
import process from 'process'

import { openAsBlob } from 'node:fs'
import mime from 'mime-types'

const logger = pino({ level: 'info', name: 'eyepop-example' })

const example_image_path = process.argv[2]

;(async () => {
    try {
        const endpoint = await EyePop.dataEndpoint({
            logger: logger,
        })
            .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
                logger.info('Endpoint changed state %s -> %s', fromState, toState)
            })
            .connect()
        try {
            endpoint.addAccountEventHandler(async event => {
                logger.info('EVENT -> from account: %s', JSON.stringify(event))
            })
            const dataset = await endpoint.createDataset({
                name: 'a test dataset',
                description: 'test',
                tags: [],
                auto_annotates: ['ep_coco'],
            })
            const source = 'example_source_1'
            try {
                await endpoint.createDatasetAutoAnnotate(
                    {
                        auto_annotate: 'ep_evaluate',
                        source: source,
                    },
                    dataset.uuid,
                )
                const modifiable_version = dataset.versions.find(v => v.modifiable)?.version
                const mime_type = mime.lookup(example_image_path) || undefined
                for (let i = 0; i < 1; i++) {
                    const file = await openAsBlob(example_image_path, { type: mime_type })
                    let asset = await endpoint.uploadAsset(dataset.uuid, modifiable_version, file)
                    logger.info('uploaded asset %s', JSON.stringify(asset))
                    const prediction: Prediction = {
                        source_width: 1.0,
                        source_height: 1.0,
                        objects: [],
                    }
                    const auto_prediction: Prediction = {
                        source_width: 1.0,
                        source_height: 1.0,
                        classes: [{ classLabel: 'auto_class', confidence: 1.0 }],
                    }
                    await endpoint.addAssetAnnotation(asset.uuid, undefined, undefined, [prediction], undefined, undefined, UserReview.approved)
                    await endpoint.addAssetAnnotation(asset.uuid, undefined, undefined, [auto_prediction], 'ep_evaluate', source)
                    logger.info('updated asset ground_truth annotations %s', JSON.stringify(asset))
                }
                logger.info('created dataset %s', JSON.stringify(dataset))
                let ds = await endpoint.getDataset(dataset.uuid)
                logger.info('default: %s', JSON.stringify(ds))
                ds = await endpoint.getDataset(dataset.uuid, true)
                logger.info('with stats: %s', JSON.stringify(ds))
                ds = await endpoint.getDataset(dataset.uuid, true, 1)
                logger.info('v1: %s', JSON.stringify(ds))
                ds = await endpoint.getDataset(dataset.uuid, true, undefined, true)
                logger.info('modifiable: %s', JSON.stringify(ds))
                const auto_annotates = await endpoint.listDatasetAutoAnnotates(dataset.uuid)
                logger.info('auto_annotates: %s', JSON.stringify(auto_annotates))
                try {
                    await endpoint.getDataset(dataset.uuid, true, 2)
                } catch (e) {
                    logger.info('v2 not found, as expected')
                }
            } finally {
                endpoint.removeAllDatasetEventHandlers(dataset.uuid)
                await endpoint.deleteDataset(dataset.uuid)
                logger.info('deleted dataset %s', dataset.uuid)
            }
        } finally {
            await endpoint.disconnect()
        }
    } catch (e) {
        logger.error(e)
    }
})()
