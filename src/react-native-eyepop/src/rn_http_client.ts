import 'react-native-polyfill-globals/auto';
import { Logger } from 'pino';
import { reactNativeStreamingFetch } from './rn_streaming_fetch';
import { HttpClient } from '@eyepop.ai/eyepop';
import TcpSockets from 'react-native-tcp-socket';
import { ReadableStream } from 'web-streams-polyfill/ponyfill/es6';

/** HTTP client that will work around the RN fetch implementation and truly stream request and response bodies.
 *
 * While '{ textStreaming: true }' helps somewhat for the response body, it does not truly stream the response
 * body, instead it keeps a large buffer and does not stream bytes to the consumer as they come in.
 * Additionally, it does not support streaming request bodies which forces the consumer to load large files
 * into memory w/o any possibility to avoid OOMs.
 *
 * This implementation implements selected HTTP interactions by using TCP sockets directly. The implementation
 * is minimal and far from complete, e.g. no redirect support. For that reason, EyePop wil prefer to use the
 * built-in fetch() except for cases when (a) the request requires a ReadableStream request body, or
 * (b) the response is supposed to truly stream as indicated by the proprietary init parameter
 * '{ eyepop: { responseStreaming: true}  }'.
 *
 * */
export async function createHttpClientRN(logger: Logger): Promise<HttpClient> {
  class ReactNativeHttpClient {
    private readonly logger: Logger;

    constructor(logger_: Logger) {
      this.logger = logger_;
    }

    public async fetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      init ||= {};
      let streamBody: ReadableStream<Uint8Array> | undefined;
      if (input instanceof Request && input.body instanceof ReadableStream) {
        // Request body streaming not supported by RN fetch
        streamBody = input.body;
      } else if (init?.body instanceof ReadableStream) {
        streamBody = init.body;
      } else if (init?.eyepop?.responseStreaming) {
        const requestBody = input instanceof Request ? input.body : init?.body;
        if (requestBody !== undefined) {
          // The limited HTTP post requires a ReadableStream request body
          if (typeof requestBody === 'string') {
            streamBody = new ReadableStream({
              start: (controller) => {
                controller.enqueue(Buffer.from(requestBody as string, 'utf8'));
                controller.close();
              },
            });
          } else if (requestBody instanceof Uint8Array) {
            streamBody = new ReadableStream({
              start: (controller) => {
                controller.enqueue(requestBody as Uint8Array);
                controller.close();
              },
            });
          } else {
            this.logger.warn(
              `EyePop responseStreaming requires a request body of type ReadableStream | string | Uint8Array but is ${typeof requestBody}`
            );
          }
        }
      }
      if (streamBody) {
        let url: URL;
        let method: string;
        let headers: Headers;
        if (input instanceof Request) {
          url = new URL(input.url);
          method = input.method;
          headers = input.headers;
        } else {
          if (input instanceof URL) {
            url = input;
          } else {
            url = new URL(input);
          }
          method = init?.method || 'POST';
          headers = new Headers(init?.headers);
        }
        let contentLength;
        if (headers.has('content-length')) {
          contentLength = parseInt(headers.get('content-length') || '', 10);
        } else {
          headers.append('Transfer-Encoding', 'chunked');
        }
        this.logger.debug(
          `reactNativeStreamingFetch() BEFORE ${method} ${url}`
        );
        const response = await reactNativeStreamingFetch(
          url,
          method,
          headers,
          streamBody,
          contentLength,
          TcpSockets,
          this.logger
        );
        this.logger.debug(`AFTER ${method} ${url} -> ${response.status}`);
        return response;
      }
      init.reactNative = { textStreaming: true };
      const logLine = logLineFromRequest(input, init);
      this.logger.debug(`ReactNative fetch() BEFORE ${logLine}`);
      const response = await fetch(input, init);
      this.logger.debug(`AFTER ${logLine} -> ${response.status}`);
      return response;
    }

    public async close(): Promise<void> {}

    public isFullDuplex() {
      return true;
    }
  }

  return new ReactNativeHttpClient(logger);
}

function logLineFromRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): string {
  const url = input instanceof Request ? input.url : input;
  const method =
    input instanceof Request
      ? input.method
      : init?.method || (init?.body !== undefined ? 'POST' : 'GET');
  return `${method} ${url}`;
}
