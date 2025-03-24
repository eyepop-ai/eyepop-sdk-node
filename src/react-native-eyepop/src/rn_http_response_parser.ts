import 'react-native-polyfill-globals/auto';

import { EyepopLineDecoder } from '@eyepop.ai/eyepop';
import { parseHttpHeader } from './rn_http_header_parser';
import { Logger } from 'pino';
import {
  ReadableStream,
  ReadableStreamDefaultController,
} from 'web-streams-polyfill/ponyfill/es6';

enum ResponseState {
  RECEIVING_HEADER,
  RECEIVING_BODY,
  RECEIVING_BODY_CHUNKED,
  RECEIVING_COMPLETED,
}

export class ResponseParser {
  private error: any;
  private readonly logger: Logger;
  private readonly resolve: (value: Response | PromiseLike<Response>) => void;
  private readonly reject: (reason?: any) => void;
  private responseChunkRemainder = 0;
  private responseReadBuffer: Buffer | undefined;
  private responseState: ResponseState;

  private pullController: any;
  private pullResolve: (() => void) | undefined;
  private pullReject: ((reason?: any) => void) | undefined;

  constructor(
    logger: Logger,
    resolve: (value: Response | PromiseLike<Response>) => void,
    reject: (reason?: any) => void
  ) {
    this.logger = logger;
    this.resolve = resolve;
    this.reject = reject;
    this.error = null;
    this.responseReadBuffer = undefined;
    this.responseState = ResponseState.RECEIVING_HEADER;
    this.pullController = undefined;
    this.pullResolve = undefined;
    this.pullReject = undefined;
  }

  public processResponseReadBuffer(data: Buffer): boolean {
    if (this.error) {
      this.logger.info(
        `RN http streamed response, received ${data.length} bytes in error mode`
      );
      return false;
    }
    if (this.responseReadBuffer) {
      this.responseReadBuffer = Buffer.concat([this.responseReadBuffer, data]);
    } else {
      this.responseReadBuffer = Buffer.from(data.subarray());
    }

    if (this.responseState === ResponseState.RECEIVING_COMPLETED) {
      if (this.pullController) {
        this.pullController.close();
        if (this.pullResolve) {
          this.pullResolve();
        }
      }
      return false;
    } else if (this.responseState === ResponseState.RECEIVING_HEADER) {
      const headerEnd = this.responseReadBuffer.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        let headerChunk = this.responseReadBuffer.subarray(0, headerEnd + 4);
        this.responseReadBuffer = Buffer.from(
          this.responseReadBuffer.subarray(headerEnd + 4)
        );
        const maxHeaderLines = 128;
        let responseHeaderLines: string[] = [];
        const lineDecoder = new EyepopLineDecoder();
        for (const line of lineDecoder.decode(headerChunk)) {
          if (line.length > 0) {
            responseHeaderLines.push(line);
            if (responseHeaderLines.length > maxHeaderLines) {
              this.error = `Response header exceeds ${maxHeaderLines} lines`;
              this.reject(this.error);
              return false;
            }
          }
        }
        let responseHeader: any = parseHttpHeader(responseHeaderLines, false);
        if (responseHeader.statusCode === undefined) {
          this.logger.warn(
            `Could not find status header in HTTP response ${JSON.stringify(responseHeader)}`
          );
          this.reject('missing status header in HTTP response');
          return false;
        }

        const headers = new Headers(responseHeader.headers);
        if (headers.has('transfer-encoding')) {
          if (headers.get('transfer-encoding')?.toLowerCase() === 'chunked') {
            this.responseState = ResponseState.RECEIVING_BODY_CHUNKED;
            this.responseChunkRemainder = 0;
          } else {
            this.error = `Response with unsupported transfer-encoding '${headers.get('transfer-encoding')}'`;
            this.reject(this.error);
            return false;
          }
        } else if (headers.has('content-length')) {
          this.responseState = ResponseState.RECEIVING_BODY;
          this.responseChunkRemainder = parseInt(
            headers.get('content-length') || '-1',
            10
          );
        } else {
          this.responseState = ResponseState.RECEIVING_BODY_CHUNKED;
          this.responseChunkRemainder = 0;
        }
        const responseBody = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (
              this.error ||
              this.responseState === ResponseState.RECEIVING_COMPLETED
            ) {
              // done with the whole request
              return;
            }
            if (this.pull(controller)) {
              // one chunk enqueued, fulfilled the pull() protocol
              return;
            }
            // nothing to enqueue yet, need to defer top a promise
            return new Promise((resolve, reject) => {
              if (this.pullController) {
                if (this.pullReject) {
                  this.pullReject('pull, we got a pending controller already');
                }
              }
              this.pullController = controller;
              this.pullResolve = resolve;
              this.pullReject = reject;
            });
          },
          cancel: (reason) => {
            if (!this.error) {
              this.error = `cancelled: ${reason}`;
              this.reject(this.error);
            }
          },
        });
        this.resolve(
          // @ts-ignore
          new Response(responseBody, {
            status: responseHeader.statusCode,
            statusText: responseHeader.statusText,
            headers: headers,
          })
        );
      }
    } else if (this.pullController) {
      if (this.pull(this.pullController)) {
        this.pullController = undefined;
        if (this.pullResolve) {
          this.pullResolve();
        }
        this.pullResolve = undefined;
        this.pullReject = undefined;
      }
    }
    return true;
  }

  private pull(
    controller: ReadableStreamDefaultController<Uint8Array>
  ): boolean {
    if (this.responseState === ResponseState.RECEIVING_COMPLETED) {
      controller.close();
      return false;
    }
    if (this.responseReadBuffer === undefined) {
      return false;
    }
    if (this.responseState === ResponseState.RECEIVING_BODY) {
      controller.enqueue(this.responseReadBuffer);
      this.responseChunkRemainder -= this.responseReadBuffer.length;
      this.responseReadBuffer = undefined;
      if (this.responseChunkRemainder <= 0) {
        this.responseState = ResponseState.RECEIVING_COMPLETED;
        controller.close();
      }
      return true;
    } else if (this.responseState === ResponseState.RECEIVING_BODY_CHUNKED) {
      while (this.responseReadBuffer.length > 1) {
        if (this.responseChunkRemainder === 0) {
          // need to find the new chunk length
          let chunkHeaderEnd = 0;
          while (this.responseReadBuffer.length >= 2 && chunkHeaderEnd === 0) {
            chunkHeaderEnd = this.responseReadBuffer.indexOf('\r\n');
            if (chunkHeaderEnd === 0) {
              // skip closing \r\n line of a previous chunk
              this.responseReadBuffer = Buffer.from(
                this.responseReadBuffer.subarray(2)
              );
            }
          }
          if (chunkHeaderEnd > 0) {
            this.responseChunkRemainder = parseInt(
              Buffer.from(this.responseReadBuffer, 0, chunkHeaderEnd).toString(
                'utf8'
              ),
              16
            );
            this.responseReadBuffer = Buffer.from(
              this.responseReadBuffer.subarray(chunkHeaderEnd + 2)
            );
            if (this.responseChunkRemainder <= 0) {
              this.responseState = ResponseState.RECEIVING_COMPLETED;
              controller.close();
              return true;
            }
          } else if (this.responseReadBuffer.length > 64) {
            this.error =
              'Cannot find chunked encoding header within 64 bytes, given up';
            controller.error(this.error);
          }
        }
        if (
          this.responseChunkRemainder > 0 &&
          this.responseReadBuffer.length > 0
        ) {
          const chunk = Buffer.from(
            this.responseReadBuffer.subarray(0, this.responseChunkRemainder)
          );
          this.responseReadBuffer = Buffer.from(
            this.responseReadBuffer.subarray(this.responseChunkRemainder)
          );
          controller.enqueue(chunk);
          this.responseChunkRemainder -= chunk.length;
          return true;
        } else {
          break;
        }
      }
    } else {
      this.error = `Received more data in wrong state ${this.responseState}`;
      controller.error(this.error);
    }
    return false;
  }
}
