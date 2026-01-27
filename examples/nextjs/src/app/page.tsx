'use client'

import { useState, useRef, useEffect } from 'react'
import { EyePop, PopComponent, PopComponentType, WorkerEndpoint } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

export default function Home() {
    const [imagePreview, setImagePreview] = useState<string>('empty.png')
    const [jsonResults, setJsonResults] = useState<string>('{ ...JSON Will appear Here... }')
    const [timing, setTiming] = useState<number>(0)
    const [popName, setPopName] = useState<string>('...')

    const fileInputRef = useRef<HTMLInputElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const imageRef = useRef<HTMLImageElement>(null)

    const endpointRef = useRef<WorkerEndpoint | null>(null)
    // EyePop.ai state
    const [isUploadEnabled, setIsUploadEnabled] = useState<boolean>(false)

    // EyePop.ai setup function - generates session dynamically like webpack example
    const setup = async () => {
        try {
            const apiKey = process.env.NEXT_PUBLIC_EYEPOP_API_KEY
            const modelUuid = process.env.NEXT_PUBLIC_EYEPOP_MODEL_UUID
            if (!apiKey) {
                throw new Error('EYEPOP_API_KEY environment variable is required')
            }
            endpointRef.current = EyePop.workerEndpoint({
                auth: { apiKey: apiKey },
            })
            await endpointRef.current.connect()
            const session = await endpointRef.current.session()

            if (!session) {
                throw new Error('Session not found')
            }

            console.log('Session:', session)

            endpointRef.current.onStateChanged((from: string, to: string) => {
                console.log('Endpoint state transition from ' + from + ' to ' + to)
            })

            let popComponent: PopComponent
            if (modelUuid) {
                popComponent = {
                    type: PopComponentType.INFERENCE,
                    modelUuid,
                }
            } else {
                console.log('Model UUID not found. It will be set to the default model.')
                popComponent = {
                    type: PopComponentType.INFERENCE,
                    model: 'eyepop.person:latest',
                }
            }

            // Compose your Pop here
            await endpointRef.current.changePop({
                components: [popComponent],
            })

            const popNameValue = endpointRef.current.popName()
            if (popNameValue) {
                setPopName(popNameValue)
                console.log('Connected to pop:', popNameValue)
            }

            setIsUploadEnabled(true)
            console.log('Setup complete! Upload enabled.')
        } catch (error) {
            console.error('Setup failed:', error)
            const errorMessage = error instanceof Error ? error.message : String(error)
            setJsonResults(
                JSON.stringify(
                    {
                        error: 'Setup failed',
                        details: errorMessage,
                        note: 'Please check your EYEPOP_API_KEY environment variable',
                    },
                    null,
                    2,
                ),
            )
        }
    }

    // Run setup on mount
    useEffect(() => {
        setup()
    }, [])

    // Handle file input change
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) {
            return
        }

        const reader = new FileReader()
        reader.onload = e => {
            setImagePreview(e.target?.result as string)
            // Reset canvas when new image is loaded
            if (canvasRef.current) {
                const canvas = canvasRef.current
                const ctx = canvas.getContext('2d')
                if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                }
            }
        }
        reader.readAsDataURL(file)
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        console.log('Context:', context)
        if (!context || !canvas) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderer = Render2d.renderer(context as any)
        const startTime = performance.now()
        context.clearRect(0, 0, canvas.width, canvas.height)
        console.log('Processing file...')
        endpointRef.current?.process({ file: file }).then(async results => {
            console.log('Results:', results)
            for await (const result of results) {
                console.log('Result:', result)
                setJsonResults(JSON.stringify(result, null, 2))
                canvas.width = result.source_width
                canvas.height = result.source_height
                context.clearRect(0, 0, canvas.width, canvas.height)
                renderer.draw(result)
            }
            setTiming(Math.floor(performance.now() - startTime))
        })
    }

    return (
        <div
            className="container"
            style={{ maxWidth: '1200px' }}
        >
            {/* HEADER: Full width, Logo Image */}
            <header className="mt-4">
                <div className="container-fluid d-flex align-items-center">
                    <h1 className="p-2">
                        TypeScript/JavaScript SDK Demo: <span id="pop-name">{popName}</span>
                    </h1>
                </div>
            </header>

            {/* FORM UPLOAD ELEMENT: Centered, Full Width Row */}
            <div className="container-fluid mt-4">
                <div className="row justify-content-center">
                    <div
                        id="drop-area"
                        className="col-12"
                    >
                        <form>
                            <input
                                type="file"
                                className="form-control"
                                id="file-upload"
                                ref={fileInputRef}
                                accept="image/*"
                                onChange={handleFileInputChange}
                                disabled={!isUploadEnabled}
                            />
                        </form>
                    </div>
                </div>
            </div>

            {/* IMAGE PREVIEW AND TEXT AREA: Half and Half */}
            <div className="container-fluid mt-4">
                <div className="row">
                    <div className="col-md-6 d-flex">Preview image:</div>
                    <div className="col-md-6 d-flex">
                        EyePop.ai Results:{' '}
                        <h3
                            id="timing"
                            className="ms-auto"
                        >
                            {timing}ms
                        </h3>
                    </div>
                </div>
                <div className="row">
                    <div className="col-md-6">
                        <div className="preview-wrapper">
                            <img
                                id="image-preview"
                                className={'image-preview'}
                                ref={imageRef}
                                src={imagePreview}
                                alt="Image Preview"
                                onLoad={e => {
                                    const img = e.target as HTMLImageElement
                                    if (canvasRef.current) {
                                        // Set canvas to match image dimensions
                                        canvasRef.current.width = img.naturalWidth
                                        canvasRef.current.height = img.naturalHeight
                                        // Set canvas style to match image display size
                                        canvasRef.current.style.width = '100%'
                                        canvasRef.current.style.height = 'auto'
                                        // Ensure canvas is positioned correctly
                                        canvasRef.current.style.position = 'absolute'
                                        canvasRef.current.style.top = '0'
                                        canvasRef.current.style.left = '0'
                                    }
                                }}
                            />
                            <canvas
                                className={'result-overlay'}
                                id="result-overlay"
                                ref={canvasRef}
                            />
                        </div>
                    </div>
                    <div className="col-md-6">
                        <pre
                            id="txt_json"
                            className="form-control h-100"
                        >
                            {jsonResults}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    )
}
