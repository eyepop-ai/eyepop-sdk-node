import { Prediction, Session } from 'EyePop/types'
import { ModelFormat } from 'EyePop/worker/worker_types'

export interface DataSession extends Session {
    readonly accountId: string
    readonly baseUrl: string | undefined
}

export interface DatasetVersionAssetStats {
    total?: number
    accepted?: number
    rejected?: number
    annotated?: number
    auto_annotated?: number
    auto_annotated_approved?: number
    ground_truth_annotated?: number
}

export interface DatasetVersion {
    version: number
    modifiable: boolean
    created_at: Date
    updated_at: Date
    assets_modified_at: Date
    last_analysed_at?: Date
    hero_asset_uuid?: string
    asset_stats?: DatasetVersionAssetStats
    default_source_model_uuid?: string
}

export interface Dataset {
    uuid: string
    name: string
    description?: string
    auto_annotates: string[]
    auto_annotate_params?: AutoAnnotateParams
    tags: string[]
    account_uuid: string
    created_at: Date
    updated_at: Date
    modifiable_version?: number
    versions: DatasetVersion[]
}

export interface DatasetCreate {
    name: string
    description?: string
    tags?: string[]
    auto_annotates?: string[]
    auto_annotate_params?: AutoAnnotateParams
}

export interface DatasetUpdate {
    name?: string
    description?: string
    tags?: string[]
    auto_annotates?: string[]
    auto_annotate_params?: AutoAnnotateParams
}

export interface DatasetHeroAssetUpdate {
    uuid: string
}

export interface AssetImport {
    url: string
    ground_truth?: Prediction
}

export enum AssetStatus {
    rejected = 'rejected',
    upload_in_progress = 'upload_in_progress',
    upload_failed = 'upload_failed',
    transform_failed = 'transform_failed',
    transform_in_progress = 'transform_in_progress',
    accepted = 'accepted',
}

export enum AnnotationType {
    ground_truth = 'ground_truth',
    prediction = 'prediction',
    auto = 'auto',
}

export enum UserReview {
    approved = 'approved',
    rejected = 'rejected',
    unknown = 'unknown',
}

export interface AutoAnnotatePrompt {
    prompt: string
    label: string
}

export enum AutoAnnotateTask {
    object_detection = 'object_detection',
    image_classification = 'image_classification'
}

export interface AutoAnnotateParams {
    /**
    * @deprecated use prompts instead
    */
    candidate_labels?: string[]
    prompts?: AutoAnnotatePrompt[]
    task?: AutoAnnotateTask
    confidence_threshold?: number
}

export interface Annotation {
    type: AnnotationType
    user_review: UserReview
    approved_threshold?: number
    source_model_uuid?: string
    auto_annotate?: string
    auto_annotate_params?: AutoAnnotateParams
    uncertainty_score?: number
    annotation: Prediction
}

export enum TranscodeMode {
    original = 'original',
    image_original_size = 'image_original_size',
    image_fit_1024 = 'image_fit_1024',
    image_fit_640 = 'image_fit_640',
    image_fit_224 = 'image_fit_224',
    image_cover_1024 = 'image_cover_1024',
    image_cover_640 = 'image_cover_640',
    image_cover_224 = 'image_cover_224',
}

export interface Asset {
    uuid: string
    external_id?: string
    mime_type: string
    file_size_bytes: number
    status: AssetStatus
    created_at: Date
    updated_at: Date
    annotations: Annotation[]
    partition?: string
    review_priority?: number
    model_relevance?: number
}

export enum ModelType {
    epdet_b1 = 'epdet_b1',
}

export enum ModelTask {
    object_detection = 'object_detection',
    image_classification = 'image_classification'
}

export enum ModelStatus {
    error = 'error',
    draft = 'draft',
    requested = 'requested',
    in_progress = 'in_progress',
    available = 'available',
    published = 'published',
}

export interface ModelMetrics {
    cpr?: number[][3]
}

export enum ModelExportStatus {
    in_progress = 'in_progress',
    finished = 'finished',
    error = 'error',
}

export enum ExportedBy {
    eyepop = 'eyepop',
    qc_ai_hub = 'qc_ai_hub',
}

export enum ArtifactType {
    eyepop_bundle = 'eyepop_bundle',
    weights_file = 'weights_file',
}

export interface QcAiHubExportParams {
    device_name: string
}

export interface ModelExport {
    format: ModelFormat
    exported_by: ExportedBy
    export_params?: QcAiHubExportParams
    status: ModelExportStatus
    status_message?: string
}

export interface Model {
    uuid: string
    name: string
    description?: string
    external_id?: string
    pretrained_model_uuid?: string
    extra_params?: Map<string, any>
    task?: ModelTask
    classes?: string[]
    type: ModelType
    status: ModelStatus
    status_message?: string
    metrics?: ModelMetrics
    account_uuid: string
    created_at: Date
    updated_at: Date
    dataset_uuid: string
    dataset_version: number
    exports?: ModelExport[]
}

export interface ModelCreate {
    name: string
    description: string
    external_id?: string
    pretrained_model_uuid?: string
    extra_params?: Map<string, any>
    task?: ModelTask
    classes?: string[]
}

export interface ModelUpdate {
    name: string
    description: string
    external_id?: string
    task?: ModelTask
    classes?: string[]
}

export enum ModelTrainingStage {
    waiting = 'waiting',
    scheduling = 'scheduling',
    preparing = 'preparing',
    training = 'training',
    exporting = 'exporting',
}

export interface ModelSample {
    asset_uuid: string
    prediction: Prediction
}

export interface ModelTrainingProgress {
    stage: ModelTrainingStage
    queue_length?: number
    started_at: Date
    finished_at?: Date
    metrics?: ModelMetrics
    samples?: ModelSample[]
    remaining_seconds_min?: number
    remaining_seconds_max?: number
}

export enum ChangeType {
    dataset_added = 'dataset_added',
    dataset_removed = 'dataset_removed',
    dataset_modified = 'dataset_modified',
    dataset_version_modified = 'dataset_version_modified',
    asset_added = 'asset_added',
    asset_removed = 'asset_removed',
    asset_status_modified = 'asset_status_modified',
    asset_annotation_modified = 'asset_annotation_modified',
    model_added = 'model_added',
    model_removed = 'model_removed',
    model_modified = 'model_modified',
    model_status_modified = 'model_status_modified',
    model_progress = 'model_progress',
    events_lost = 'events_lost',
}

export interface ChangeEvent {
    change_type: ChangeType
    account_uuid: string
    dataset_uuid: string
    dataset_version?: number
    asset_uuid?: string
    mdl_uuid?: string
}

export type OnChangeEvent = (event: ChangeEvent) => Promise<void>
