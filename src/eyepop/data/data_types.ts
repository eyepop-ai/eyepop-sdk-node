import {Prediction, Session} from "EyePop/types";

export interface DataSession extends Session {
    readonly accountId: string;
    readonly baseUrl: string | undefined;
}

export interface DatasetVersion {
    version: number
    modifiable: boolean
    created_at: Date
    updated_at: Date
    asset_count: number
    hero_asset_uuid?: string
}

export interface Dataset {
    uuid: string
    name: string
    description?: string
    auto_annotates: string[]
    tags: string[]
    account_uuid: string
    created_at: Date
    updated_at: Date
    versions: DatasetVersion[]
}

export interface DatasetCreate {
    name: string
    description?: string
    tags?: string[]
    auto_annotates?: string[]
}

export interface DatasetUpdate {
    name: string
    description?: string
    tags?: string[]
    auto_annotates?: string[]
}

export enum AssetStatus {
    rejected = "rejected",
    upload_in_progress = "upload_in_progress",
    upload_failed = "upload_failed",
    transform_failed = "transform_failed",
    transform_in_progress = "transform_in_progress",
    accepted = "accepted"
}

export enum AnnotationType {
    manual = "manual",
    prediction = "prediction",
    auto = "auto"
}

export enum UserReview {
    approved = "approved",
    rejected = "rejected",
    unknown = "unknown"
}

export interface Annotation {
    type: AnnotationType
    user_review: UserReview
    auto_annotate?: string
    uncertainty_score?: number
    annotation: Prediction
}

export enum TranscodeMode {
    original = "original",
    image_original_size = "image_original_size",
    image_fit_1024 = "image_fit_1024",
    image_fit_640 = "image_fit_640",
    image_fit_224 = "image_fit_224",
    image_cover_1024 = "image_cover_1024",
    image_cover_640 = "image_cover_640",
    image_cover_224 = "image_cover_224"
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
}

export enum ModelType {
    epdet_b1 = "epdet_b1"
}

export enum ModelStatus {
    error = "error",
    draft = "draft",
    requested = "requested",
    in_progress = "in_progress",
    available = "available",
    published = "published"
}

export interface Model {
    uuid: string
    name: string
    description?: string
    type: ModelType
    status: ModelStatus
    account_uuid: string
    created_at: Date
    updated_at: Date
    dataset_uuid: string
    dataset_version: number
}

export interface ModelCreate {
    name: string
    description?: string
    type: ModelType
}

export interface ModelUpdate {
    name: string
    description?: string
}

export enum ChangeType {
    dataset_added = "dataset_added",
    dataset_removed = "dataset_removed",
    dataset_modified = "dataset_modified",
    dataset_version_modified = "dataset_version_modified",
    asset_added = "asset_added",
    asset_removed = "asset_removed",
    asset_status_modified = "asset_status_modified",
    asset_annotation_modified = "asset_annotation_modified",
    model_added = "model_added",
    model_removed = "model_removed",
    model_modified = "model_modified",
    model_status_modified = "model_status_modified"
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