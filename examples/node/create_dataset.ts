import {Asset, AssetStatus, ChangeType, EndpointState, EyePop, Prediction} from '@eyepop.ai/eyepop'

import {pino} from 'pino'
import process from 'process';

import {openAsBlob} from "node:fs";
import mime from "mime-types";

const logger = pino({level: 'info', name: 'eyepop-example'})

const example_image_path = process.argv[2]


;(async () => {
    try {
        const endpoint = await EyePop.dataEndpoint({
            logger: logger
        }).onStateChanged((fromState: EndpointState, toState: EndpointState) => {
            logger.info("Endpoint changed state %s -> %s", fromState, toState)
        }).connect()
        try {
            endpoint.addAccountEventHandler(async (event) => {
                logger.info("EVENT -> from account: %s", JSON.stringify(event))
            })
            const dataset = await endpoint.createDataset({
                name: "a test dataset", description: "test", tags: [], auto_annotates: ["ep_coco"]
            })
            try {
                logger.info("created dataset %s", JSON.stringify(dataset))
                const modifiable_version = dataset.versions.find(v => v.modifiable)?.version
                const mime_type = mime.lookup(example_image_path) || undefined
                for (let i = 0; i < 100; i++) {
                    const file = await openAsBlob(example_image_path, {type: mime_type})
                    let asset = await endpoint.uploadAsset(dataset.uuid, modifiable_version, file)
                    logger.info("uploaded asset %s", JSON.stringify(asset))
                    const prediction: Prediction = {
                        source_width: 1.0,
                        source_height: 1.0,
                        objects: [

                        ]
                    }
                    await endpoint.updateAssetGroundTruth(asset.uuid, undefined, undefined, prediction)
                    logger.info("updated asset ground_truth annotations %s", JSON.stringify(asset))
                    // let asset_accepted = new Promise<Asset>(async (resolve, reject) => {
                    //     endpoint.addDatasetEventHandler(dataset.uuid, async (event) => {
                    //         if (event.change_type == ChangeType.asset_status_modified && asset !== undefined && asset.uuid == event.asset_uuid) {
                    //             asset = await endpoint.getAsset(asset.uuid)
                    //             if (asset.status == AssetStatus.accepted) {
                    //                 resolve(asset)
                    //             } else if (asset.status == AssetStatus.rejected || asset.status == AssetStatus.upload_failed || asset.status == AssetStatus.transform_failed) {
                    //                 reject(asset.status)
                    //             }
                    //         }
                    //     })
                    // })
                    // asset = await asset_accepted
                    // logger.info("accepted asset %s", JSON.stringify(asset))
                }
            } finally {
                endpoint.removeAllDatasetEventHandlers(dataset.uuid)
                await endpoint.deleteDataset(dataset.uuid)
                logger.info("deleted dataset %s", dataset.uuid)
            }
        } finally {
            await endpoint.disconnect()
        }
    } catch (e) {
        logger.error(e)
    }
})()

