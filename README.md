# EyePop.ai JavaScript SDK

The EyePop.ai JavaScript SDK provides TypeScript and JavaScript clients for EyePop worker sessions, inference results, and 2D result rendering.

## Packages

- [@eyepop.ai/eyepop](src/eyepop/README.md) - Node and browser SDK for worker sessions.
- [@eyepop.ai/eyepop-render-2d](src/eyepop-render-2d/README.md) - Canvas rendering helpers for predictions.
- [@eyepop.ai/react-native-eyepop](src/react-native-eyepop/README.md) - React Native SDK package.

## Authentication Model

Use `EYEPOP_API_KEY` only in trusted server-side environments. Browser and mobile applications should request an EyePop session from your backend and connect with `auth: { session }`.

Persistent worker deployments can be selected with `EYEPOP_SESSION_UUID` in the trusted server environment.
