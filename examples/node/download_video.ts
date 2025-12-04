
import * as fs from 'fs/promises';
import {EyePop} from '@eyepop.ai/eyepop'
import process from 'process'
import {pino} from 'pino'
import {AssetUrlType, DownloadResponse, TranscodeMode} from "EyePop/data/data_types";

const logger = pino({ level: 'info', name: 'eyepop-example' })

async function download_video(asset_uuid: string, output_path: string, start_timestamp_ns?: number, end_timestamp_ns?: number) {
    const endpoint = await EyePop.dataEndpoint({ logger: logger }).connect()
    try {
        const download_response = await endpoint.downloadAsset(
            asset_uuid, undefined, undefined, TranscodeMode.video_original_size, start_timestamp_ns, end_timestamp_ns, AssetUrlType.gcs
        ) as DownloadResponse
        logger.info('asset %s is stored in the Cloud at %s', asset_uuid, download_response.url)
        const download_blob = await endpoint.downloadAsset(
            asset_uuid, undefined, undefined, TranscodeMode.video_original_size, start_timestamp_ns, end_timestamp_ns
        ) as Blob
        const buffer = Buffer.from(await download_blob.arrayBuffer());
        await fs.writeFile(output_path, buffer);
        logger.info('asset %s downloaded locally to %s', asset_uuid, output_path)
    } finally {
        await endpoint.disconnect()
    }
}

;(async () => {
    try {
        const asset_uuid = process.argv[2]
        const output_path = process.argv[3]
        await download_video(asset_uuid, output_path, 1 * 1000 * 1000 * 1000, 3 * 1000 * 1000 * 1000)
    } catch (e) {
        console.error(e)
    }
})()
