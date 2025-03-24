import { Asset, AssetImport, AutoAnnotateParams, ChangeType, DataEndpoint, Dataset, EyePop, Model, ModelCreate, ModelStatus, Prediction, UserReview } from '@eyepop.ai/eyepop'

import { pino } from 'pino'

import sampleAssets from './sample_assets.json'

const logger = pino({ level: 'info', name: 'eyepop-example' })

const auto_annotate: string = 'grounding_dino_base'
const auto_annotate_params: AutoAnnotateParams = {
    candidate_labels: ['person', 'car', 'toy'],
}

;(async () => {
    try {
        const endpoint = await EyePop.dataEndpoint({
            logger: logger,
        }).connect()
        try {
            const dataset = await create_sample_dataset(endpoint)
            if (dataset.modifiable_version === undefined) {
                throw Error('panic')
            }
            try {
                logger.info('created dataset %s', JSON.stringify(dataset))
                await import_sample_assets(endpoint, dataset)
                await analyze_dataset(endpoint, dataset.uuid)
                await auto_annotate_dataset(endpoint, dataset.uuid, auto_annotate, auto_annotate_params)
                await approve_all(endpoint, dataset.uuid, dataset.modifiable_version, auto_annotate)
                const model = await create_model(endpoint, dataset.uuid)
                await train_model(endpoint, model)
            } finally {
                endpoint.removeAllDatasetEventHandlers(dataset.uuid)
                await endpoint.deleteDataset(dataset.uuid)
                logger.info('deleted dataset %s', dataset.uuid)
            }
        } finally {
            await endpoint.disconnect()
        }
    } catch (e) {
        console.error(e)
        logger.error(e)
    }
})()

async function create_sample_dataset(endpoint: DataEndpoint): Promise<Dataset> {
    const dataset = await endpoint.createDataset({
        name: 'a sample dataset',
        description: '',
        tags: [],
        auto_annotates: [],
    })
    return dataset
}

async function import_sample_assets(endpoint: DataEndpoint, dataset: Dataset): Promise<Asset[]> {
    logger.info('before importing %d assets to %s', sampleAssets.length, dataset.uuid)
    const assets = []
    for (let i = 0; i < sampleAssets.length; i++) {
        const assetImport: AssetImport = {
            url: sampleAssets[i].asset_url,
            ground_truth: sampleAssets[i].prediction as Prediction,
        }
        assets.push(await endpoint.importAsset(dataset.uuid, undefined, assetImport))
    }
    logger.info('imported %d assets to %s', sampleAssets.length, dataset.uuid)
    return assets
}

async function analyze_dataset(endpoint: DataEndpoint, dataset_uuid: string): Promise<void> {
    logger.info('before analysis start for dataset %s', dataset_uuid)
    await endpoint.analyzeDatasetVersion(dataset_uuid)
    logger.info('analysis started for dataset %s', dataset_uuid)
}

async function auto_annotate_dataset(endpoint: DataEndpoint, dataset_uuid: string, auto_annotate: string, auto_annotate_params: AutoAnnotateParams): Promise<void> {
    logger.info('before auto annotate update dataset %s', dataset_uuid)
    await endpoint.updateDataset(
        dataset_uuid,
        {
            auto_annotates: [auto_annotate],
            auto_annotate_params: auto_annotate_params,
        },
        false,
    )
    logger.info('before auto annotate start for dataset %s', dataset_uuid)
    const auto_annotate_promise = new Promise<void>((resolve, reject) => {
        endpoint.addDatasetEventHandler(dataset_uuid, async event => {
            if (event.dataset_version && event.change_type in [ChangeType.dataset_version_modified, ChangeType.events_lost]) {
                try {
                    const updated_dataset = await endpoint.getDataset(event.dataset_uuid, true)
                    const updated_version = updated_dataset.versions.find(value => value.version == event.dataset_version)
                    if (updated_version && updated_version.asset_stats && (updated_version.asset_stats?.annotated ?? 0) >= (updated_version.asset_stats?.auto_annotated ?? 0)) {
                        resolve()
                    }
                } catch (e) {
                    reject(e)
                }
            }
        })
    })
    await endpoint.autoAnnotateDatasetVersion(dataset_uuid)
    logger.info('auto annotate started for dataset %s', dataset_uuid)
    await auto_annotate_promise
    logger.info('auto annotate succeeded for dataset %s', dataset_uuid)
}

async function approve_all(endpoint: DataEndpoint, dataset_uuid: string, dataset_version: number, auto_annotate: string): Promise<void> {
    logger.info('before approving all for dataset %s', dataset_uuid)
    const assets = await endpoint.listAssets(dataset_uuid, dataset_version, false)
    for (let asset of assets) {
        await endpoint.updateAutoAnnotationStatus(asset.uuid, auto_annotate, UserReview.approved)
    }
    logger.info('%d auto annotations approved for dataset %s', assets.length, dataset_uuid)
}

async function create_model(endpoint: DataEndpoint, dataset_uuid: string): Promise<Model> {
    logger.info('before model creation for dataset: %s', dataset_uuid)
    const dataset = await endpoint.freezeDatasetVersion(dataset_uuid)
    logger.info('dataset frozen: %s', JSON.stringify(dataset))
    const dataset_version = dataset.versions[1]
    const model_create: ModelCreate = {
        name: 'sample model',
        description: '',
    }
    const model = await endpoint.createModel(dataset.uuid, dataset_version.version, model_create, false)
    logger.info('model created: %s', JSON.stringify(model))
    return model
}

async function train_model(endpoint: DataEndpoint, model: Model): Promise<Model> {
    const training_promise = new Promise<void>((resolve, reject) => {
        endpoint.addDatasetEventHandler(model.dataset_uuid, async event => {
            if (event.change_type in [ChangeType.model_status_modified, ChangeType.events_lost]) {
                await on_model_status_changed(endpoint, event.mdl_uuid as string, resolve, reject)
            } else if (event.change_type == ChangeType.model_progress) {
                await on_model_training_progress(endpoint, event.mdl_uuid as string)
            }
        })
    })
    logger.info('before training start for model %s', model.uuid)
    model = await endpoint.trainModel(model.uuid)
    logger.info('training started for model %s', model.uuid)
    await training_promise
    logger.info('training succeeded for model %s', model.uuid)
    return model
}

async function on_model_status_changed(endpoint: DataEndpoint, model_uuid: string, resolve: () => void, reject: (reason?: any) => void): Promise<void> {
    const model = await endpoint.getModel(model_uuid)
    logger.info('model status modified: %s [%s]', model.status, model.status_message)
    if (model.status == ModelStatus.available) {
        resolve()
    } else if (model.status == ModelStatus.error) {
        reject(`model ${model.uuid} failed with: ${model.status_message}`)
    }
}

async function on_model_training_progress(endpoint: DataEndpoint, model_uuid: string): Promise<void> {
    const model_progress = await endpoint.getModelTrainingProgress(model_uuid)
    logger.info('model training progress: %s', JSON.stringify(model_progress))
}
