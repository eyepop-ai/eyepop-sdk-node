import {SessionPlus} from "./types";
import {HttpClient} from "./shims/http_client";
import {Logger} from "pino";
import {WebrtcWhip} from "./webrtc_whip";


interface OfferData {
    iceUfrag: string
    icePwd: string
    medias: string[]
}
export abstract class WebrtcBase {
    protected readonly _getSession: () => Promise<SessionPlus>
    protected readonly _client: HttpClient
    protected readonly _requestLogger: Logger
    protected readonly _urlPath: string

    private readonly _ingressId: string

    protected _pc: RTCPeerConnection | null
    protected _eTag: string
    protected _queuedCandidates: RTCIceCandidate[]
    protected _offerData: OfferData | null

    constructor(getSession: () => Promise<SessionPlus>, client: HttpClient, ingressId: string, urlBasePath: string, requestLogger: Logger) {
        this._getSession = getSession
        this._client = client
        this._requestLogger = requestLogger
        this._ingressId = ingressId
        this._urlPath = `${urlBasePath}/${this._ingressId}`
        this._pc = null
        this._eTag = ''
        this._queuedCandidates = []
        this._offerData = null
    }

    public async close(): Promise<void> {
        const pc = this._pc
        this._pc = null
        if (pc) {
            return pc.close()
        }
    }

    public ingressId(): string {
        return this._ingressId
    }

    protected async onLocalOffer(offer: RTCSessionDescriptionInit): Promise<WebrtcBase> {
        if (!this._pc) {
            throw new Error('onLocalOffer no peer connection')
        }
        if (!offer.sdp) {
            throw new Error('onLocalOffer no sdp')
        }
        this._offerData = WebrtcBase.parseOffer(offer.sdp)
        await this._pc.setLocalDescription(offer)

        const session = await this._getSession()
        const ingressUrl = new URL(this._urlPath, session.baseUrl);
        this._requestLogger.debug("before POST: %s", ingressUrl)
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

    protected abstract onRemoteAnswer(answer: RTCSessionDescription): Promise<WebrtcBase>

    protected async sendLocalCandidates(candidates: RTCIceCandidate[]): Promise<WebrtcBase> {
        if (!this._offerData) {
            throw new Error('sendLocalCandidates no offerData')
        }
        const session = await this._getSession()
        const ingressUrl = new URL(this._urlPath, session.baseUrl);
        this._requestLogger.debug("before PATCH: %s", ingressUrl)
        const headers = {
            'Authorization': `Bearer ${session.accessToken}`,
            'Content-Type': 'application/trickle-ice-sdpfrag',
            'If-Match': this._eTag
        }
        const response = await this._client.fetch(ingressUrl, {
            headers: headers,
            method: 'PATCH',
            body: WebrtcBase.generateSdpFragment(this._offerData, candidates),
        })
        if (response.status != 204) {
            return Promise.reject(`unknown status code for PATCH '${ingressUrl}': ${response.status} (${response.statusText})`)
        }
        return this
    }

    protected async onLocalCandidate(evt: RTCPeerConnectionIceEvent): Promise<WebrtcBase> {
        if (evt.candidate !== null) {
            if (this._eTag === '') {
                this._queuedCandidates.push(evt.candidate)
            } else {
                await this.sendLocalCandidates([evt.candidate])
            }
        }
        return this
    }

    static linkToIceServers(links: string | null): RTCIceServer[] {
        const servers = (links !== null) ? links.split(', ').map((link) => {
            const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i)
            if (!m) {
                return null
            }
            const iceServer: RTCIceServer = {
                urls: [m[1]],
                username: WebrtcWhip.unquoteCredential(m[3]),
                credential: WebrtcWhip.unquoteCredential(m[4]),
                // credentialType: m[3]? "password" : undefined
            }
            return iceServer
        }) : []
        return <RTCIceServer[]>servers.filter(function (el: null | RTCIceServer) {
            return el != null
        })
    }

    protected static editAnswer(answer: string, videoCodec: string, audioCodec: string | undefined, videoBitrate: number, audioBitrate: number | undefined, audioVoice: boolean): string {
        const sections = answer.split('m=');

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section.startsWith('video')) {
                sections[i] = WebrtcWhip.setVideoBitrate(WebrtcWhip.setCodec(section, videoCodec), videoBitrate);
            } else if (section.startsWith('audio')) {
                sections[i] = WebrtcWhip.setAudioBitrate(WebrtcWhip.setCodec(section, audioCodec), audioBitrate, audioVoice);
            }
        }

        return sections.join('m=');
    };

    private static setCodec(section: string, codec: string | undefined): string {
        const lines = section.split('\r\n');
        const lines2 = [];
        const payloadFormats = [];

        for (const line of lines) {
            if (!line.startsWith('a=rtpmap:')) {
                lines2.push(line);
            } else {
                if (codec && line.toLowerCase().includes(codec)) {
                    payloadFormats.push(line.slice('a=rtpmap:'.length).split(' ')[0]);
                    lines2.push(line);
                }
            }
        }

        const lines3 = [];

        for (const line of lines2) {
            if (line.startsWith('a=fmtp:')) {
                if (payloadFormats.includes(line.slice('a=fmtp:'.length).split(' ')[0])) {
                    lines3.push(line);
                }
            } else if (line.startsWith('a=rtcp-fb:')) {
                if (payloadFormats.includes(line.slice('a=rtcp-fb:'.length).split(' ')[0])) {
                    lines3.push(line);
                }
            } else {
                lines3.push(line);
            }
        }

        return lines3.join('\r\n');
    };

    private static setVideoBitrate(section: string, bitrate: number): string {
        let lines = section.split('\r\n');

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('c=')) {
                lines = [...lines.slice(0, i + 1), 'b=TIAS:' + (bitrate * 1024).toString(), ...lines.slice(i + 1)];
                break
            }
        }

        return lines.join('\r\n');
    };

    private static setAudioBitrate(section: string, bitrate: number | undefined, voice: boolean) {
        let opusPayloadFormat = '';
        let lines = section.split('\r\n');

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('a=rtpmap:') && lines[i].toLowerCase().includes('opus/')) {
                opusPayloadFormat = lines[i].slice('a=rtpmap:'.length).split(' ')[0];
                break;
            }
        }

        if (opusPayloadFormat === '') {
            return section;
        }

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('a=fmtp:' + opusPayloadFormat + ' ')) {
                if (voice) {
                    lines[i] = 'a=fmtp:' + opusPayloadFormat + ' minptime=10;useinbandfec=1;maxaveragebitrate='
                        + ((bitrate ?? 0) * 1024).toString();
                } else {
                    lines[i] = 'a=fmtp:' + opusPayloadFormat + ' maxplaybackrate=48000;stereo=1;sprop-stereo=1;maxaveragebitrate'
                        + ((bitrate ?? 0) * 1024).toString();
                }
            }
        }

        return lines.join('\r\n');
    };

    static parseOffer(offer: string): OfferData {
        let medias = []
        let iceUfrag = ''
        let icePwd = ''

        for (const line of offer.split('\r\n')) {
            if (line.startsWith('m=')) {
                medias.push(line.slice('m='.length));
            } else if (iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
                iceUfrag = line.slice('a=ice-ufrag:'.length);
            } else if (icePwd === '' && line.startsWith('a=ice-pwd:')) {
                icePwd = line.slice('a=ice-pwd:'.length);
            }
        }

        return {
            iceUfrag: iceUfrag,
            icePwd: icePwd,
            medias: medias,
        }
    }

    static generateSdpFragment(offerData: OfferData, candidates: RTCIceCandidate[]) {
        const candidatesByMedia = new Map<number, RTCIceCandidate[]>()
        for (const candidate of candidates) {
            if (candidate.sdpMLineIndex !== null) {
                const mid = candidate.sdpMLineIndex
                let matched = candidatesByMedia.get(mid)
                if (matched === undefined) {
                    matched = []
                    candidatesByMedia.set(mid, matched)
                }
                matched.push(candidate)
            }
        }

        let frag = 'a=ice-ufrag:' + offerData.iceUfrag + '\r\n'
            + 'a=ice-pwd:' + offerData.icePwd + '\r\n';
        let mid = 0;

        for (const media of offerData.medias) {
            let matched = candidatesByMedia.get(mid)
            if (matched !== undefined) {
                frag += 'm=' + media + '\r\n'
                    + 'a=mid:' + mid + '\r\n';

                for (const candidate of matched) {
                    frag += 'a=' + candidate.candidate + '\r\n';
                }
            }
            mid++;
        }
        return frag
    }

    static unquoteCredential(v: string | undefined): string {
        if (!v) {
            return ''
        }
        return JSON.parse(`"${v}"`)
    };
}