import {Prediction, Session} from "EyePop/types";

export interface WorkerSession extends Session {
    readonly popId: string;
    readonly baseUrl: string | undefined;
    readonly pipelineId: string | undefined;
    readonly sandboxId: string | undefined;
}

export interface LiveMedia {
    ingressId(): string

    stream(): Promise<MediaStream>

    close(): Promise<void>
}

export interface IngressEvent {
    readonly ingressId: string
    readonly event: "stream-ready" | "stream-ready"
}

export interface FileSource {
    readonly file: File;
}

export interface StreamSource {
    readonly stream: ReadableStream<Uint8Array>;
    readonly mimeType: string;
}

export interface PathSource {
    readonly path: string;
}

export interface LiveSource {
    readonly ingressId: string;
}

export interface UrlSource {
    readonly url: string;
}

export type Source = FileSource | StreamSource | PathSource | LiveSource | UrlSource

export interface ResultStream extends AsyncIterable<Prediction> {
    cancel(): void
}

export type SourcesEntry = {
    readonly authority: string;
    readonly manifest: string;
};

export enum ModelFormat {
    TensorFlowLite = "TensorFlowLite",
    TensorFlowGraphDef = "TensorFlowGraphDef",
    ONNX = "ONNX",
    TorchScript = "TorchScript",
    TorchScriptCpu = "TorchScriptCpu",
    TorchScriptCuda = "TorchScriptCuda"
}

export enum ModelPrecisionType {
    float32 = "float32",
    float16 = "float16",
    int32 = "int32",
    int8 = "int8",
    uint8 = "uint8"
}

export interface ModelInstanceDef {
    id?: string;
    model_id: string;
    dataset: string;
    version: string | undefined;
    format: ModelFormat;
    type: ModelPrecisionType;
}