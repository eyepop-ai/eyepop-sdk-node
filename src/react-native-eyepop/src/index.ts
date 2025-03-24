import 'react-native-polyfill-globals/auto';
globalThis.Buffer = require('buffer').Buffer;

import '@azure/core-asynciterator-polyfill';

import { RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
// @ts-ignore
globalThis.RTCPeerConnection = RTCPeerConnection;
// @ts-ignore
globalThis.RTCSessionDescription = RTCSessionDescription;

import { pino } from 'pino';

import {
  DataEndpoint,
  DataOptions,
  EyePop as _EyePop,
  WorkerEndpoint,
  WorkerOptions,
} from '@eyepop.ai/eyepop';
import { resolvePathRN } from './rn_local_file';
import { createHttpClientRN } from './rn_http_client'

export namespace EyePop {
  export function workerEndpoint(opts?: WorkerOptions): WorkerEndpoint {
    opts = opts || {};
    if (opts.logger === undefined) {
      opts.logger = pino({ level: 'debug', name: 'eyepop' });
    }
    opts.platformSupport = {
      resolvePath: resolvePathRN,
      createHttpClient: createHttpClientRN,
    };
    return _EyePop.workerEndpoint(opts);
  }

  export function dataEndpoint(opts?: DataOptions): DataEndpoint {
    opts = opts || {};
    if (opts.logger === undefined) {
      opts.logger = pino({ level: 'debug', name: 'eyepop' });
    }
    opts.platformSupport = {
      resolvePath: resolvePathRN,
      createHttpClient: createHttpClientRN,
    };
    return _EyePop.dataEndpoint(opts);
  }
}
