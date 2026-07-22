import { EyePop } from '@eyepop.ai/eyepop'
import { NextResponse } from 'next/server'

export async function GET() {
    const apiKey = process.env.EYEPOP_API_KEY
    if (!apiKey) {
        return NextResponse.json({ error: 'EYEPOP_API_KEY is required' }, { status: 500 })
    }

    const endpoint = await EyePop.workerEndpoint({
        apiKey,
    }).connect()

    try {
        return NextResponse.json(await endpoint.session())
    } finally {
        await endpoint.disconnect()
    }
}
