import 'react-native-polyfill-globals/auto';

import { Logger } from 'pino';
import { ResponseParser } from './rn_http_response_parser';
import { ReadableStream } from 'web-streams-polyfill/ponyfill/es6';

export async function reactNativeStreamingFetch(
  url: URL,
  method: string,
  headers: Headers,
  body: ReadableStream<Uint8Array> | undefined,
  contentLength: number | undefined,
  sockets: any,
  logger: Logger,
  signal?: AbortSignal
): Promise<Response> {
  const isHttps = url.protocol === 'https:';
  const port = url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const connectOptions = {
      port: port,
      host: url.hostname,
      reuseAddress: true,
    };
    const clientSocket = new sockets.Socket();
    const client = isHttps ? new sockets.TLSSocket(clientSocket) : clientSocket;

    let error: any;
    const responseParser = new ResponseParser(logger, resolve, (reason) => {
      error = reason;
      reject(error);
      client.destroy();
    });

    client.on('data', function (data: Buffer) {
      responseParser.processResponseReadBuffer(data);
    });

    client.on('error', function (err: any) {
      logger.info(`error: ${err}`);
      if (!error) {
        error = err;
        reject(error);
      }
      client.destroy();
    });

    // Cancelling the request closes its socket, also while the response
    // streams after this promise has resolved.
    const onAbort = () => {
      if (!error) {
        error = abortReason(signal!);
        reject(error);
      }
      client.destroy();
    };
    signal?.addEventListener('abort', onAbort);

    client.on('close', function () {
      signal?.removeEventListener('abort', onAbort);
      if (!error) {
        error = 'socket closed';
        reject(error);
      }
    });

    client.connect(connectOptions, async () => {
      const headerLines = [
        `${method} ${url.pathname}${url.search} HTTP/1.1\r\n`,
        `Host: ${url.host}\r\n`,
      ];
      headers.forEach((value: string, key: string) => {
        headerLines.push(`${key}: ${value}\r\n`);
      });
      headerLines.push('\r\n');

      const textEncoder = new TextEncoder();
      const headerChunk = headerLines.join('');
      const bodyReader = body ? body.getReader() : undefined;

      let headerEnqueued = false;
      let eof = false;
      const readableHeaderChunkedBody = new ReadableStream<Uint8Array>({
        async pull(controller: any) {
          if (!headerEnqueued) {
            controller.enqueue(headerChunk);
            headerEnqueued = true;
            return;
          }
          if (eof) {
            controller.close();
            return;
          }
          if (!bodyReader) {
            controller.close();
            return;
          }
          const chunk = await bodyReader.read();
          if (chunk.value) {
            let outputChunk;
            if (contentLength) {
              outputChunk = chunk.value;
            } else {
              outputChunk = Buffer.concat([
                textEncoder.encode(`${chunk.value.length.toString(16)}\r\n`),
                chunk.value,
                textEncoder.encode(`\r\n`),
              ]);
            }
            controller.enqueue(outputChunk);
          } else if (chunk.done) {
            if (!contentLength) {
              controller.enqueue(Buffer.from(`0\r\n\r\n`, 'utf8'));
            }
            eof = true;
          }
        },
      });

      const readableHeaderChunkedBodyReader =
        readableHeaderChunkedBody.getReader();
      const pipeChunk = async () => {
        while (true) {
          try {
            const chunk = await readableHeaderChunkedBodyReader.read();
            if (chunk.value) {
              if (!client.write(chunk.value)) {
                // interrupt this loop and wait for "drain" event
                break;
              }
            } else if (chunk.done) {
              break;
            }
          } catch (e) {
            logger.error(e);
            break;
          }
        }
      };
      client.on('drain', pipeChunk);
      await pipeChunk();
    });
  });
}

function abortReason(signal: AbortSignal): any {
  if (signal.reason !== undefined) {
    return signal.reason;
  }
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
