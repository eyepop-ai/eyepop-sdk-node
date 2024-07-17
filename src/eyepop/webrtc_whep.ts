import {WebrtcBase} from './webrtc_base'
import {LiveMedia, WorkerSession} from './types'
import {HttpClient} from './shims/http_client'
import {Logger} from 'pino'

export class WebrtcWhep extends WebrtcBase implements LiveMedia {
    private _stream: MediaStream | null
    constructor(ingressId: string, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(getSession, client, ingressId, '/liveIngress/whep', requestLogger)
        this._stream = null
    }
    public override async close(): Promise<void> {
        const stream = this._stream
        this._stream = null
        if (stream) {
            const tracks = stream.getTracks();
            tracks.forEach((track) => {
                track.stop();
            });
        }
        return super.close()
    }

    public async stream(): Promise<MediaStream> {
        if (this._stream) {
            return Promise.resolve(this._stream)
        } else {
            return Promise.reject('fetching stream failed')
        }
    }

    public async start(): Promise<WebrtcWhep> {
        const session = await this._getSession()
        const egressUrl = new URL(this._urlPath, session.baseUrl);
        this._requestLogger.debug("before GET: %s", egressUrl)
        const headers = {
            'Authorization': `Bearer ${session.accessToken}`
        }
        /* According to https://www.ietf.org/archive/id/draft-ietf-wish-whip-01.html
           this should be a `OPTIONS` request. Unfortunately a lot of CORS middlewares
           hijack the OPTIONS request and only return those headers that are necessary
           for the CORS preflight protocol.
           As workaround, our media endpoint expose a equivalent `GET` request to fake
           the `OPTIONS` request and bypass the CORS preflight trap
         */
        const response = await this._client.fetch(egressUrl, {
            headers: headers, method: 'GET'
        })
        if (response.status >= 300) {
            return Promise.reject(`unknown status code for GET '${egressUrl}': ${response.status} (${response.statusText})`)
        }
        return this.onIceServers(response)
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

    private async onIceServers(response: Response): Promise<WebrtcWhep> {
        if (this._stream) {
            throw new Error('onIceServers has stream')
        }
        const pc = new RTCPeerConnection({
            iceServers: WebrtcBase.linkToIceServers(response.headers.get('Link'))
        })

        const direction = "sendrecv"
        pc.addTransceiver("video", {direction})
        pc.onicecandidate = (evt) => this.onLocalCandidate(evt)

        this._pc = pc

        this._requestLogger.info("before", pc.iceConnectionState);

        return new Promise(async (resolve, reject) => {
            pc.ontrack = (evt) => {
                this._requestLogger.debug("new track:", evt.track.kind);
                this._stream = evt.streams[0];
                resolve(this)
            }
            pc.oniceconnectionstatechange = () => {
                switch (pc.iceConnectionState) {
                    case "failed":
                    case "disconnected":
                        this._requestLogger.debug("disconnected")
                        reject(`peer connection: ${pc.iceConnectionState}`)
                        break
                    case "connected":
                        this._requestLogger.debug("connected")
                        break
                }
            }
            await this.onLocalOffer(await pc.createOffer())
        })
    }
}