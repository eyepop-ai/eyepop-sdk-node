import { v4 as uuidv4 } from 'uuid'
import { HttpClient } from '../shims/http_client'
import { Logger } from 'pino'
import { WebrtcBase } from './webrtc_base'
import { LiveMedia, WorkerSession } from '../worker/worker_types'

export class WebrtcWhip extends WebrtcBase implements LiveMedia {
    private _stream: MediaStream | null
    constructor(stream: MediaStream, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(getSession, client, uuidv4().toString(), '/liveIngress/whip', requestLogger)
        this._stream = stream
    }
    public async start(): Promise<WebrtcWhip> {
        const session = await this._getSession()
        const ingressUrl = new URL(this._urlPath, session.baseUrl)
        this._requestLogger.debug('before GET: %s', ingressUrl)
        const headers = {
            Authorization: `Bearer ${session.accessToken}`,
        }
        /* According to https://www.ietf.org/archive/id/draft-ietf-wish-whip-01.html
           this should be a `OPTIONS` request. Unfortunately a lot of CORS middlewares
           hijack the OPTIONS request and only return those headers that are necessary
           for the CORS preflight protocol.
           As workaround, our media endpoint expose a equivalent `GET` request to fake
           the `OPTIONS` request and bypass the CORS preflight trap
         */
        const response = await this._client.fetch(ingressUrl, {
            headers: headers,
            method: 'GET',
        })
        if (response.status >= 300) {
            return Promise.reject(`unknown status code for GET '${ingressUrl}': ${response.status} (${response.statusText})`)
        }
        return this.onIceServers(response)
    }

    public async stream(): Promise<MediaStream> {
        if (this._stream) {
            return Promise.resolve(this._stream)
        } else {
            return Promise.reject('fetching stream failed')
        }
    }

    protected async onRemoteAnswer(answer: RTCSessionDescription): Promise<WebrtcBase> {
        if (!this._pc) {
            throw new Error('onLocalOffer no peer connection')
        }
        await this._pc.setRemoteDescription(new RTCSessionDescription(answer))

        if (this._queuedCandidates.length !== 0) {
            await this.sendLocalCandidates(this._queuedCandidates)
            this._queuedCandidates = []
        }
        return this
    }

    private async onIceServers(response: Response): Promise<WebrtcWhip> {
        if (!this._stream) {
            throw new Error('onIceServers no stream')
        }
        const stream = this._stream
        const pc = new RTCPeerConnection({
            iceServers: WebrtcBase.linkToIceServers(response.headers.get('Link')),
        })

        this._pc = pc
        pc.onicecandidate = evt => this.onLocalCandidate(evt)

        return new Promise(async (resolve, reject) => {
            pc.oniceconnectionstatechange = () => {
                switch (pc.iceConnectionState) {
                    case 'failed':
                    case 'disconnected':
                        reject(`peer connection: ${pc.iceConnectionState}`)
                        break
                    case 'connected':
                        resolve(this)
                        break
                }
            }
            stream.getTracks().forEach(track => {
                this._requestLogger.debug('onIceServers our stream has track: %s', track)
                pc.addTrack(track, stream)
            })
            stream.addEventListener('addtrack', trackEvent => {
                this._requestLogger.debug('onIceServers got lazy track: ', trackEvent.track)
                pc.addTrack(trackEvent.track, stream)
            })
            await this.onLocalOffer(await pc.createOffer())
        })
    }

    public override async close(): Promise<void> {
        const stream = this._stream
        this._stream = null
        if (stream) {
            const tracks = stream.getTracks()
            tracks.forEach(track => {
                track.stop()
            })
        }
        return super.close()
    }
}
