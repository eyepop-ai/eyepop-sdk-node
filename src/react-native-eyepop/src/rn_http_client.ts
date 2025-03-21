import 'react-native-polyfill-globals/auto';
import { Logger } from 'pino';
import { reactNativeStreamingFetch } from './rn_streaming_fetch';
import { HttpClient } from '@eyepop.ai/eyepop';
import TcpSockets from 'react-native-tcp-socket';

import { ReadableStream } from 'web-streams-polyfill/ponyfill';

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
      if (input instanceof Request) {
        if (input.body instanceof ReadableStream) {
          streamBody = input.body;
        }
      } else if (init?.body instanceof ReadableStream) {
        streamBody = init.body;
      } else if (typeof init?.body === 'string') {
        streamBody = new ReadableStream({
          start: (controller) => {
            controller.enqueue(Buffer.from(init?.body as string, 'utf8'));
            controller.close();
          },
        });
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

        return await reactNativeStreamingFetch(
          url,
          method,
          headers,
          streamBody,
          contentLength,
          TcpSockets,
          this.logger
        );
      }

      // @ts-ignore
      init.reactNative = { textStreaming: true };
      return await fetch(input, init);
    }

    public async close(): Promise<void> {}

    public isFullDuplex() {
      return true;
    }
  }

  return new ReactNativeHttpClient(logger);
}
