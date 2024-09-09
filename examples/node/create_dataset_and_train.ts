import {
    Asset,
    AssetImport,
    ChangeType,
    DataEndpoint,
    Dataset,
    EyePop,
    Model,
    ModelCreate,
    ModelStatus,
    Prediction
} from '@eyepop.ai/eyepop'

import {pino} from 'pino'

import sampleAssets from "./sample_assets.json"

const logger = pino({level: 'info', name: 'eyepop-example'})

;

(async () => {
    try {
        const endpoint = await EyePop.dataEndpoint({
            logger: logger
        }).connect()
        try {
            const dataset = await create_sample_dataset(endpoint)
            try {
                const training_promise = new Promise<void>((resolve, reject) => {
                    logger.info("created dataset %s", JSON.stringify(dataset))
                    endpoint.addDatasetEventHandler(dataset.uuid, async (event) => {
                        if (event.change_type == ChangeType.asset_added) {
                            logger.info("asset %s imported", event.asset_uuid)
                        } else if (event.change_type == ChangeType.model_added) {
                            logger.info("model %s created", event.mdl_uuid)
                        } else if (event.change_type == ChangeType.model_status_modified) {
                            await on_model_status_changed(endpoint, event.mdl_uuid as string, resolve, reject)
                        } else if (event.change_type == ChangeType.model_progress) {
                            await on_model_training_progress(endpoint, event.mdl_uuid as string)
                        }
                    })
                })
                const assets = await import_sample_assets(endpoint, dataset)
                const model = await start_training(endpoint, dataset)
                await training_promise
                console.log("training succeeded for model %s with %d assets", model.uuid, assets.length)
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



async function create_sample_dataset(endpoint: DataEndpoint): Promise<Dataset> {
    const dataset = await endpoint.createDataset({
        name: "a sample dataset", description: "", tags: [], auto_annotates: []
    })
    return dataset
}

async function import_sample_assets(endpoint: DataEndpoint, dataset: Dataset): Promise<Asset[]> {
    const assets = []
    for (let i = 0; i < sampleAssets.length; i++) {
        const assetImport: AssetImport = {
            "url": sampleAssets[i].asset_url,
            "ground_truth": sampleAssets[i].prediction as Prediction
        }
        assets.push(await endpoint.importAsset(dataset.uuid, undefined, assetImport))
    }
    return assets
}

async function start_training(endpoint: DataEndpoint, dataset: Dataset): Promise<Model> {
    dataset = await endpoint.freezeDatasetVersion(dataset.uuid)
    logger.info("dataset frozen: %s", JSON.stringify(dataset))
    const dataset_version = dataset.versions[1]
    const model_create: ModelCreate = {
        "name": "sample model",
        "description": ""
    }
    const model = await endpoint.createModel(dataset.uuid, dataset_version.version, model_create)
    logger.info("model created: %s", JSON.stringify(model))
    return model
}

async function on_model_status_changed(endpoint: DataEndpoint, model_uuid: string, resolve: () => void, reject: (reason?: any) => void): Promise<void> {
    const model = await endpoint.getModel(model_uuid)
    logger.info("model status modified: %s [%s]", model.status, model.status_message)
    if (model.status == ModelStatus.available) {
        resolve()
    } else if (model.status == ModelStatus.error) {
        reject(`model ${model.uuid} failed with: ${model.status_message}`)
    }
}

async function on_model_training_progress(endpoint: DataEndpoint, model_uuid: string): Promise<void> {
    const model_progress = await endpoint.getModelTrainingProgress(model_uuid)
    logger.info("model training progress: %s", JSON.stringify(model_progress))
}

