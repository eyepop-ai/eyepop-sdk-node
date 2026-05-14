# EyePop Next.js Example

This [Next.js](https://nextjs.org) example uploads images from the browser and renders EyePop inference results.

The browser never receives an API key. The API key stays in the Next.js server environment, where `/api/eyepop-session` creates an EyePop session and returns session JSON to the client.

## Prerequisites

- Node 22
- EyePop API key for the server environment
- Optional EyePop model alias or model UUID

## Getting Started

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
EYEPOP_API_KEY=your_api_key_here
NEXT_PUBLIC_EYEPOP_MODEL_ALIAS=eyepop.person:latest
```

Or use a model UUID:

```bash
EYEPOP_API_KEY=your_api_key_here
NEXT_PUBLIC_EYEPOP_MODEL_UUID=your_model_uuid_here
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
