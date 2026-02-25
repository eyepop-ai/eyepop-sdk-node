import { Point2d, Prediction, Session } from '../types'

export enum DataApiType {
    dataset = 'dataset',
    vlm = 'vlm'
}

export interface DataSession extends Session {
    readonly accountId: string
    readonly datasetApiUrl: string | undefined
    readonly vlmApiUrl: string | undefined
}

export function getBaseUrl(session: DataSession, dataApiType: DataApiType): string {
    switch (dataApiType) {
        case DataApiType.dataset:
            return session.datasetApiUrl ?? ''
        case DataApiType.vlm:
            return session.vlmApiUrl ?? ''
        default:
            throw new Error(`unsupported type ${dataApiType}`)
    }
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

export interface DatasetParent {
    dataset_uuid: string
    dataset_version: number
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
    parent?: DatasetParent
    searchable: boolean
}

export interface DatasetCreate {
    name: string
    description?: string
    tags?: string[]
    auto_annotates?: string[]
    auto_annotate_params?: AutoAnnotateParams
    searchable?: boolean
}

export interface DatasetUpdate {
    name?: string
    description?: string
    tags?: string[]
    auto_annotates?: string[]
    auto_annotate_params?: AutoAnnotateParams
    searchable?: boolean
}

export interface DatasetHeroAssetUpdate {
    uuid: string
}

export enum AutoAnnotateStatus {
    error = "error",
    requested = "requested",
    in_progress = "in_progress",
    completed = "completed"
}

export interface DatasetAutoAnnotateCreate {
    auto_annotate: string
    auto_annotate_params?: Map<string, any>
    source_model_uuid?: string
    status?: AutoAnnotateStatus
    status_message?: string
    source?: string
    metrics?: Map<string, any>
}


export interface DatasetAutoAnnotateUpdate {
    status?: AutoAnnotateStatus
    status_message?: string
    metrics?: Map<string, any>
}

export interface DatasetAutoAnnotate {
    created_at?: Date
    updated_at?: Date
    dataset_uuid: string
    dataset_version: number
    source_ability_uuid?: string
    source_model_uuid?: string
    auto_annotate?: string
    auto_annotate_params?: Map<string, any>
    status?: AutoAnnotateStatus
    status_message?: string
    source?: string
    metrics?: Map<string, any>
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
    image_classification = 'image_classification',
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
    auto_annotate?: string
    source?: string
    source_ability_uuid?: string
    uncertainty_score?: number
    predictions: Prediction[]
}

export enum TranscodeMode {
    original = 'original',
    video_original_size = 'video_original_size',
    image_original_size = 'image_original_size',
    image_fit_1024 = 'image_fit_1024',
    image_fit_640 = 'image_fit_640',
    image_fit_224 = 'image_fit_224',
    image_cover_1024 = 'image_cover_1024',
    image_cover_640 = 'image_cover_640',
    image_cover_224 = 'image_cover_224',
}

export enum AreaType {
    RECTANGLE = "rectangle",
    CONTOUR = "contour"
}

export interface BaseArea {
    type: AreaType
}

export interface RectangleArea extends BaseArea {
    x: number
    y: number
    width: number
    height: number
}

export interface ContourArea extends BaseArea {
    points: Point2d[]
}

export type Area = RectangleArea | ContourArea

export interface TimeSpan {
    start_timestamp?: number
    end_timestamp?: number
}

export interface Roi {
    name: string
    area?: Area
    time_span?: TimeSpan
}
export interface Asset {
    uuid: string
    external_id?: string
    mime_type: string
    file_size_bytes: number
    original_image_width?: number
    original_image_height?: number
    original_duration?: number
    original_frames?: number
    status: AssetStatus
    created_at: Date
    updated_at: Date
    partition?: string
    review_priority?: number
    model_relevance?: number
    annotations: Annotation[]
    rois: Roi[]
}

export enum ModelType {
    epdet_b1 = 'epdet_b1',
    imported = 'imported',
    vlm_ability = 'vlm_ability'
}

export enum ModelTask {
    object_detection = 'object_detection',
    image_classification = 'image_classification',
    keypoint_detection = 'keypoint_detection'
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
    workflow_started = 'workflow_started',
    workflow_succeeded = 'workflow_succeeded',
    workflow_failed = 'workflow_failed',
    workflow_task_started = 'workflow_task_started',
    workflow_task_succeeded = 'workflow_task_succeeded',
    workflow_task_failed = 'workflow_task_failed',
}


export interface ChangeEvent {
    change_type: ChangeType
    account_uuid: string
    dataset_uuid: string
    dataset_version?: number
    asset_uuid?: string
    mdl_uuid?: string
    message?: string
    workflow_task_name?: string
}

export type OnChangeEvent = (event: ChangeEvent) => Promise<void>

export interface CreateWorkflowConfig {
    dataset_uuid?: string
    dataset_version?: number
    model_uuid?: string
    config?: Record<string, any>
}

export interface CreateWorkflow {
    parameters?: CreateWorkflowConfig
}

export interface Workflow {
    workflow_id: string
}

export interface ListWorkflowItemMetadataLabels {
    account_uuid: string
    dataset_uuid?: string
    model_uuid?: string
    phase: WorkflowPhase
}

export interface ListWorkFlowItemMetadata {
    workflow_id: string
    created_at: Date
    labels: ListWorkflowItemMetadataLabels
}

export interface ListWorkFlowItem {
    metadata: ListWorkFlowItemMetadata
}

export enum WorkflowPhase {
    unknown = 'Unknown',
    pending = 'Pending',
    running = 'Running',
    succeeded = 'Succeeded',
    failed = 'Failed',
    error = 'Error',
}

export enum ModelFormat {
    TensorFlowLite = 'TensorFlowLite',
    TensorFlowGraphDef = 'TensorFlowGraphDef',
    ONNX = 'ONNX',
    TorchScript = 'TorchScript',
    TorchScriptCpu = 'TorchScriptCpu',
    TorchScriptCuda = 'TorchScriptCuda',
    PyTorch = 'PyTorch',
    ModelLess = 'ModelLess',
}

export enum ModelPrecisionType {
    float32 = 'float32',
    float16 = 'float16',
    int32 = 'int32',
    int8 = 'int8',
    uint8 = 'uint8',
}

export enum  AssetUrlType {
    gcs = 'gcs',
    s3 = 's3',
    https_signed = 'https_signed'
}

export interface DownloadResponse {
    url: string
    url_type: AssetUrlType
}

/** Experimental VLM API */

export interface InferRuntimeConfig {
    max_new_tokens?: number
    image_size?: number
    fps?: number
    max_frames?: number
    min_frames?: number
    max_aspect_ratio?: number
    context_length?: number
}

export interface TransformInto {
    classes?: string[]
}

export interface InferRequest {
    worker_release?: string
    text_prompt?: string
    config: InferRuntimeConfig
    refresh?: boolean
    transform_into?: TransformInto
}

export interface EvaluateFilter {
    partitions?: string[]
    ground_truth_classes?: string[]
}

export interface EvaluateRequest {
    ability_uuid?: string
    infer?: InferRequest
    dataset_uuid: string
    filter?: EvaluateFilter
    video_chunk_length_ns?: number
    video_chunk_overlap?: number
}

export enum EvaluationStatus {
    success = "success",
    failed = "failed"
}

export interface EvaluateRunInfo {
    num_images: number
    num_ground_truth_images: number
    num_videos: number
    num_ground_truth_videos: number
    total_tokens: number
    visual_tokens: number
    text_tokens: number
    output_tokens: number
}

export interface EvaluateResponse {
    dataset_uuid: string
    dataset_version: number
    status: EvaluationStatus
    status_message?: string
    source: string
    metrics?: Map<string, any>
    run_info: EvaluateRunInfo
}

export interface InferRunInfo {
    fps?: number
    image_size?: number
    total_tokens?: number
    visual_tokens?: number
    text_tokens?: number
    output_tokens?: number
    aspect_ratio?: number
}

export enum VlmAbilityStatus {
    draft = "draft",
    published = "published",
}

export interface AbilityAliasEntry {
    alias: string
    tag: string
}

export interface VlmAbilityCreate {
    name: string
    description: string
    worker_release: string
    text_prompt: string
    transform_into: TransformInto
    config: InferRuntimeConfig
    is_public: boolean
}

export interface  VlmAbilityUpdate {
    name?: string
    description?: string
    worker_release?: string
    text_prompt?: string
    transform_into?: TransformInto
    config?: InferRuntimeConfig
    is_public?: boolean
}

export interface VlmAbility {
    uuid: string
    created_at?: Date
    updated_at?: Date
    account_uuid: string
    status: VlmAbilityStatus
    is_public: boolean
    name: string
    description: string
    vlm_ability_group_uuid?: string
    worker_release: string
    text_prompt: string
    transform_into: TransformInto
    config: InferRuntimeConfig
    alias_entries?: AbilityAliasEntry[]
}

export interface VlmAbilityGroupCreate {
    name: string
    description: string
    default_alias_name?: string
    default_dataset_uuid?: string
}

export interface VlmAbilityGroupUpdate {
    name: string
    description: string
    default_alias_name?: string
    default_dataset_uuid?: string
}

export interface VlmAbilityGroup {
    uuid: string
    created_at?: Date
    updated_at?: Date
    account_uuid: string
    name: string
    description: string
    default_alias_name?: string
    default_dataset_uuid?: string
}
