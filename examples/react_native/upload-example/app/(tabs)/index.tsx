import React, { useEffect, useState, useRef } from 'react'
import { Alert, Image, StyleSheet, Text } from 'react-native'
import Canvas from 'react-native-canvas'
import Spinner from 'react-native-loading-spinner-overlay'
import Video, { VideoRef } from 'react-native-video'

import { HelloWave } from '@/components/HelloWave'
import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import * as ImagePicker from 'expo-image-picker'
import Queue from 'queue-fifo'
import { Prediction, WorkerEndpoint } from '@eyepop.ai/eyepop'
import { EyePop } from '@eyepop.ai/react-native-eyepop'
import EyepopRender2d from '@eyepop.ai/eyepop-render-2d'

import type { OnProgressData, OnVideoTracksData } from 'react-native-video/src/specs/VideoNativeComponent'

const RENDER_RULES = [EyepopRender2d.renderBox()]

export default function homeScreen() {
    /** Keep an EyePop Endpoint alive for the lifetime of this component */
    const [workerEndpoint, setWorkerEndpoint] = useState<WorkerEndpoint | null>(null);

    /** UI state */
    const [spinner, setSpinner] = useState<string | false>(false);
    const [imageSource, setImageSource] = useState<string | null>(null);
    const [videoSource, setVideoSource] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState<string | null>(null);
    const [previewWidth, setPreviewWidth] = useState<number>(0);
    const [previewHeight, setPreviewHeight] = useState<number>(0)

    /** Refs to UI components */
    const previewImage = useRef<Image>(null);
    const previewVideo = useRef<VideoRef>(null);
    const previewCanvas = useRef<Canvas>(null)

    /** Inference results to render */
    const [previewResult, setPreviewResult] = useState<Prediction | null>(null);
    const [resultSummary, setResultSummary] = useState<string | null>(null);
    const [videoResultQueue, setVideoResultQueue] = useState<Queue<Prediction> | null>(null)
    const [lastVideoResultRendered, setLastVideoResultRendered] = useState<number>(-1)

    /** Initialize an EyePop Endpoint and keeping it alive while this component lives */
    useEffect(() => {
        const endpoint = EyePop.workerEndpoint({
            auth: { secretKey: process.env.EXPO_PUBLIC_EYEPOP_API_KEY || '' },
            popId: process.env.EXPO_PUBLIC_EYEPOP_POP_UUID,
            eyepopUrl: process.env.EXPO_PUBLIC_EYEPOP_URL || undefined,
        })
        setSpinner('Connecting to EyePop...')
        endpoint.connect().then(value => {
            setWorkerEndpoint(value)
        }).catch(reason => {
            console.error(reason)
            Alert.alert(`got error ${reason}`)
        }).finally(() => {
            setSpinner(false)
        })
        return () => {
            endpoint.disconnect().catch(reason => {
                console.error(reason);
            }).finally(() => {
                if (endpoint === workerEndpoint) {
                    setWorkerEndpoint(null)
                }
            })
        }
    }, [])

    /** Submit picked files for processing to EyePop endpoint */
    useEffect(() => {
        const sourceUri = imageSource? imageSource: videoSource;
        const sourceMimeType = mimeType;
        const endpoint = workerEndpoint;

        if (!sourceUri || !sourceMimeType) {
            return;
        }
        if (!endpoint) {
            Alert.alert('Asset picked but endpoint is not connected');
            return;
        }
        endpoint.process({
            path: sourceUri.substring('file://'.length),
            mimeType: sourceMimeType,
        }).then(results => {
            processResults(results, sourceMimeType.startsWith("video/") || false).catch(reason => {
                console.error(reason);
            }).finally(() => {
                setSpinner(false);
            })
        }).catch(reason => {
            console.error(reason);
            setSpinner(false);
        })
    }, [imageSource, videoSource, workerEndpoint])

        /** Let the user pick a local image or video and submit to EyePop for processing */
    const pickAsset = () => {
        ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            quality: 1,
            base64: false
        }).then(picked => {
            if (picked.canceled || !picked.assets[0]?.uri) {
                return
            }
            const file = picked.assets[0];
            const { current: video } = previewVideo;
            if (video) {
                video.pause();
            }
            setSpinner(`Processing '${file.fileName}'...`)
            if (file.mimeType?.startsWith("image/")) {
                setImageSource(file.uri);
                setVideoSource(null);
                setMimeType(file.mimeType);
            } else if (file.mimeType?.startsWith("video/")) {
                setImageSource(null);
                setVideoSource(file.uri);
                setMimeType(file.mimeType);
            }
            setPreviewResult(null);
            setResultSummary(null);
        })
    }

    /** Resizing the preview area based on the actual image dimensions */
    useEffect(() => {
        const imageUri = imageSource;
        if (imageUri) {
            Image.getSize(imageUri, (width, height) => {
                setPreviewHeight(previewWidth * height / width);
            });
        }
    }, [imageSource]);

    /** Calculate the true width/height ration after rotation */
    const onVideoTrack = (event: OnVideoTracksData) : void => {
        if (event.videoTracks && event.videoTracks[0] && event.videoTracks[0].height && event.videoTracks[0].width) {
            // @ts-ignore
            const alpha = (event.videoTracks[0].rotation || 0) * Math.PI/180;
            const w = Math.abs(event.videoTracks[0].width * Math.cos(alpha) - event.videoTracks[0].height * Math.sin(alpha));
            const h = Math.abs(event.videoTracks[0].width * Math.sin(alpha) + event.videoTracks[0].height * Math.cos(alpha));
            setPreviewHeight(previewWidth * h / w);
        }
    };

    /** Re-render preview if new results are reported */
    const renderImageOverlay = () => {
        const { current: canvas } = previewCanvas;
        if (canvas && previewResult) {
            canvas.width = previewWidth;
            canvas.height = previewHeight;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            console.debug(`redraw canvas.width=${canvas.width}, canvas.height=${canvas.height}`)
            // @ts-ignore
            let renderer = EyepopRender2d.renderer(ctx, RENDER_RULES);
            renderer.draw(previewResult);
        }
    }
    useEffect(() => {
        renderImageOverlay();
    }, [previewResult]);
    useEffect(() => {
        const { current: canvas } = previewCanvas;
        if (canvas) {
            console.debug(`height change ${canvas.width}x${canvas.height} => ${previewWidth}x${previewHeight}`)
            canvas.width = previewWidth;
            canvas.height = previewHeight;
        }
        setTimeout(renderImageOverlay, 100);
    }, [previewHeight])

    /** Synchronize playback with inference results */
    const onVideoProgress = (event: OnProgressData) : void => {
        const {current: video } = previewVideo;
        const { current: canvas } = previewCanvas;
        let lastRendered = lastVideoResultRendered;
        let queue = videoResultQueue
        if (video !== null && queue !== null && canvas !== null) {
            const ctx = canvas.getContext('2d');
            // @ts-ignore
            let renderer = EyepopRender2d.renderer(ctx, RENDER_RULES);
            while (event.currentTime > lastRendered && !queue.isEmpty()) {
                let result;
                // react-native-canvas is versy slow, so we skip forward if video playback is faster
                do {
                    result = queue.dequeue();
                } while (result !== null && (result.seconds || 0) < event.currentTime && !queue.isEmpty());
                if (result) {
                    if (canvas && ctx) {
                        canvas.width = previewWidth;
                        canvas.height = previewHeight;
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        renderer.draw(result);
                    }
                    lastRendered = result.seconds || 0;
                }
            }
            setLastVideoResultRendered(lastRendered);
        }
    }

    /** Helper to demonstrate basic programmatic usage of Prediction results */
    const calculateSummary = (result: Prediction): void => {
        const summary = new Map();
        for (const o of result.objects || []) {
            summary.set(o.classLabel, (summary.get(o.classLabel) || 0) + 1);
        }
        if (summary.size > 0) {
            setResultSummary(`Found object counts: ${JSON.stringify(Object.fromEntries(summary.entries()))}`)
        } else {
            setResultSummary(`No objects found`)
        }
    };

    const processResults = async (results: AsyncIterable<Prediction>, isVideo: boolean) : Promise<void> => {
        if (!isVideo) {
            for await (const result of results) {
                setPreviewResult(result);
                calculateSummary(result);
            }
        } else {
            const queue = new Queue<Prediction>();
            try {
                setSpinner('Waiting for first results ...');
                setVideoResultQueue(queue);
                setLastVideoResultRendered(-1);
                console.debug(`queue = ${queue}`)
                for await (const result of results) {
                    setSpinner(`Buffering results for: ${result.seconds?.toFixed(1)} secs`);
                    queue.enqueue(result);
                }
            } finally {
                const { current: video } = previewVideo;
                if (video) {
                    await video.resume();
                }
            }
        }
    }

    return (
        <ParallaxScrollView
            headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
            headerImage={
                <Image
                    source={require('@/assets/images/colored-eyepop-octopus-p-1080.png')}
                    style={styles.eyepopLogo}
                />
            }
        >
            <ThemedView style={styles.titleContainer}>
                <ThemedText type="title">Welcome!</ThemedText>
                <HelloWave />
            </ThemedView>
            <ThemedView style={styles.stepContainer}>
                <Spinner
                    visible={spinner !== false}
                    textContent={spinner || ''}
                    textStyle={styles.spinnerTextStyle}
                />
                <ThemedText>
                    Click{' '}
                    <Text
                        style={styles.link}
                        onPress={pickAsset}
                    >
                        here
                    </Text>{' '}
                    to select a local image or video and process it using your Pop.
                </ThemedText>
            </ThemedView>
            <ThemedView style={styles.previewContainer}
                        onLayout={(event) => {setPreviewWidth(event.nativeEvent.layout.width)}} >
                <Image ref={previewImage}
                       source={imageSource? {uri: imageSource}: undefined}
                       style={Object.assign({}, styles.previewImage, {height: imageSource? previewHeight: 0})}
                />
                <Video ref={previewVideo}
                       source={videoSource? {uri: videoSource}: undefined}
                       onVideoTracks={onVideoTrack}
                       onProgress={onVideoProgress}
                       progressUpdateInterval={100}
                       style={Object.assign({}, styles.previewVideo, {height: videoSource? previewHeight: 0})}
                />
                <Canvas ref={previewCanvas} style={Object.assign({}, styles.previewCanvas, {width: previewWidth, height: previewHeight})}/>
            </ThemedView>
            <ThemedView style={styles.stepContainer}>
                <ThemedText>
                    <Text>{resultSummary}</Text>
                </ThemedText>
            </ThemedView>

        </ParallaxScrollView>
    )
}

const styles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    stepContainer: {
        gap: 8,
        marginBottom: 0,
    },
    eyepopLogo: {
        height: '80%',
        width: '80%',
        bottom: 0,
        left: 0,
        position: 'absolute',
        resizeMode: 'contain',
        margin: '10%',
    },

    link: {
        color: 'blue',
        textDecorationLine: 'underline',
    },

    spinnerTextStyle: {
        color: '#FFF',
    },

    previewContainer: {
        width: "100%",
    },

    previewCanvas: {
        width: "100%",
        position: 'absolute',
        borderStyle: "solid",
        borderColor: "black",
        zIndex:9999
    },

    previewImage : {
        width: "100%",
        backgroundColor: "grey",
        resizeMode: 'contain',
        objectFit: 'contain',
        position: 'relative',
        zIndex:1
    },
    previewVideo : {
        width: "100%",
        backgroundColor: "grey",
        resizeMode: 'contain',
        objectFit: 'contain',
        position: 'relative',
        zIndex:1
    }
})
