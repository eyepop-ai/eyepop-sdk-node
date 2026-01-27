# EyePop Next.js Example

This is a [Next.js](https://nextjs.org) project that demonstrates how to integrate with the EyePop SDK. It provides examples of uploading images and working with EyePop's AI-powered computer vision capabilities.


## Prerequisites

- Node 18+
- **EyePop API Key** - Authentication credential (required)
- **EyePop Model UUID** - Specific AI model identifier (optional, defaults to 'eyepop.person:latest')

## Getting Started

First, install the dependencies:

```bash
npm install
```

Then, set up your environment variables (see Environment Variables section below).

Finally, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment Variables

This project requires the following environment variables to be set:

- `NEXT_PUBLIC_EYEPOP_API_KEY` - Your EyePop API key (required)
- `NEXT_PUBLIC_EYEPOP_MODEL_UUID` - The EyePop Model UUID (optional, defaults to 'eyepop.person:latest')
 

Create a `.env.local` file in the root of this project and add these variables:

```bash
NEXT_PUBLIC_EYEPOP_MODEL_UUID=your_model_uuid_here
NEXT_PUBLIC_EYEPOP_API_KEY=your_api_key_here
```
