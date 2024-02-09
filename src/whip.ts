import {v4 as uuidv4} from 'uuid';
import {LiveIngress, SessionPlus} from "./types";
import {HttpClient} from "./shims/http_client";
import {Logger} from "pino";
import {WebRtcBase} from "./web_rtc_base";

export class Whip extends WebRtcBase implements LiveIngress {
    private _ingressId: string
    private _stream: MediaStream | null
    constructor(stream: MediaStream, getSession: () => Promise<SessionPlus>, client: HttpClient, requestLogger: Logger) {
        super(getSession, client, requestLogger)
        this._ingressId = uuidv4().toString()
        this._stream = stream
    }

    public ingressId(): string {
        if (!this._ingressId) {
            throw new Error("not initialized")
        }
        return this._ingressId
    }

    public async start(): Promise<Whip> {
        const session = await this._getSession()
        const ingressUrl = new URL('/liveIngress/whip/' + this._ingressId, session.baseUrl);
        this._requestLogger.debug("before GET: %s", ingressUrl)
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
        const response = await this._client.fetch(ingressUrl, {
            headers: headers, method: 'GET'
        })
        if (response.status >= 300) {
            return Promise.reject(`unknown status code for GET '${ingressUrl}': ${response.status} (${response.statusText})`)
        }
        return this.onIceServers(response)
    }

    private async onIceServers(response: Response): Promise<Whip> {
        if (!this._stream) {
            throw new Error('onIceServers no stream')
        }
        const stream = this._stream
        const pc = new RTCPeerConnection({
            iceServers: Whip.linkToIceServers(response.headers.get('Link'))
        })

        this._pc = pc
        pc.onicecandidate = (evt) => this.onLocalCandidate(evt)

        return new Promise(async (resolve, reject) => {
            pc.oniceconnectionstatechange = () => {
                switch (pc.iceConnectionState) {
                    case "failed":
                    case "disconnected":
                        reject(`peer connection: ${pc.iceConnectionState}`)
                        break
                    case "connected":
                        resolve(this)
                        break
                }
            }
            stream.getTracks().forEach((track) => {
                this._requestLogger.debug('onIceServers our stream has track: %s', track)
                pc.addTrack(track, stream)
            });
            stream.addEventListener("addtrack", (trackEvent) => {
                this._requestLogger.debug('onIceServers got lazy track: ', trackEvent.track)
                pc.addTrack(trackEvent.track, stream)
            });
            await this.onLocalOffer(await pc.createOffer())
        })
    }

    private async onLocalCandidate(evt: RTCPeerConnectionIceEvent): Promise<Whip> {
        if (evt.candidate !== null) {
            if (this._eTag === '') {
                this._queuedCandidates.push(evt.candidate)
            } else {
                await this.sendLocalCandidates([evt.candidate])
            }
        }
        return this
    }

    private async onLocalOffer(offer: RTCSessionDescriptionInit): Promise<Whip> {
        if (!this._pc) {
            throw new Error('onLocalOffer no peer connection')
        }
        if (!offer.sdp) {
            throw new Error('onLocalOffer no sdp')
        }
        this._offerData = Whip.parseOffer(offer.sdp)
        await this._pc.setLocalDescription(offer)

        const session = await this._getSession()
        const ingressUrl = new URL('/liveIngress/whip/' + this._ingressId, session.baseUrl);
        this._requestLogger.debug("before GET: %s", ingressUrl)
        const headers = {
            'Authorization': `Bearer ${session.accessToken}`,
            'Content-Type': 'application/sdp',
        }
        const response = await this._client.fetch(ingressUrl, {
            headers: headers,
            method: 'POST',
            body: offer.sdp
        })
        if (response.status != 201) {
            return Promise.reject(`unknown status code for POST '${ingressUrl}': ${response.status} (${response.statusText})`)
        }

        this._eTag = response.headers.get('ETag')??''

        return this.onRemoteAnswer(new RTCSessionDescription({
            type: 'answer',
            sdp: await response.text()
        }))
    }

    private async onRemoteAnswer(answer: RTCSessionDescription): Promise<Whip> {
        if (!this._pc) {
            throw new Error('onLocalOffer no peer connection')
        }
        answer = new RTCSessionDescription({
            type: 'answer',
            sdp: Whip.editAnswer(
                answer.sdp,
                'h264/90000',
                undefined,
                5000,
                undefined,
                true,
            ),
        })

        await this._pc.setRemoteDescription(new RTCSessionDescription(answer))

        if (this._queuedCandidates.length !== 0) {
            await this.sendLocalCandidates(this._queuedCandidates)
            this._queuedCandidates = []
        }
        return this
    }

    private async sendLocalCandidates(candidates: RTCIceCandidate[]): Promise<Whip> {
        if (!this._offerData) {
            throw new Error('sendLocalCandidates no offerData')
        }
        const session = await this._getSession()
        const ingressUrl = new URL('/liveIngress/whip/' + this._ingressId, session.baseUrl);
        this._requestLogger.debug("before PATCH: %s", ingressUrl)
        const headers = {
            'Authorization': `Bearer ${session.accessToken}`,
            'Content-Type': 'application/trickle-ice-sdpfrag',
            'If-Match': this._eTag
        }
        const response = await this._client.fetch(ingressUrl, {
            headers: headers,
            method: 'PATCH',
            body: Whip.generateSdpFragment(this._offerData, candidates),
        })
        if (response.status != 204) {
            return Promise.reject(`unknown status code for PATCH '${ingressUrl}': ${response.status} (${response.statusText})`)
        }
        return this
    }

    public async close(): Promise<void> {
        const pc = this._pc
        const stream = this._stream
        this._stream = null
        this._pc = null
        if (stream) {
            const tracks = stream.getTracks();
            tracks.forEach((track) => {
                track.stop();
            });
        }
        if (pc) {
            return pc.close()
        }
    }
}