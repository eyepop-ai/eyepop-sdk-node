import 'react-native-polyfill-globals/auto';
import { PathSource, StreamSource } from '@eyepop.ai/eyepop';
import { Logger } from 'pino';

import { FileSystem } from 'react-native-file-access';

export async function resolvePathRN(
  source: PathSource,
  _: Logger
): Promise<StreamSource> {
  const bufferSize = 1024 * 1024;
  let pos = 0;
  const size = (await FileSystem.stat(source.path)).size;
  let eof = false;
  const stream = new ReadableStream({
    async pull(controller: any) {
      if (eof) {
        return;
      }
      const chunkSize = Math.min(bufferSize, size - pos);
      const chunkAsB64 = await FileSystem.readFileChunk(
        source.path,
        pos,
        chunkSize,
        'base64'
      );
      if (chunkAsB64.length > 0) {
        const chunk = Buffer.from(chunkAsB64, 'base64').subarray(0, chunkSize);
        controller.enqueue(chunk);
        pos += chunk.length;
      } else {
        eof = true;
        controller.close();
      }
    },
  });
  return {
    stream: stream,
    size: size,
    mimeType: source.mimeType || 'image/*',
  };
}
