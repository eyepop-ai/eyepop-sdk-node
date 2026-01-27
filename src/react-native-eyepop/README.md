# react-native-eyepop

The official Typescript library for EyePop.ai's inference API for React Native

## Usage

### Required packages

EyePop provides a ReactNative specific package that replaces some underlying packages to support local
file access, WebRTC-based live streaming and uniform networking including fast streamed HTTP request and
response bodies. The latter is necessary because the EyePop protocol is designed to operate in streaming
mode for all media types and inference responses.

```shell
npm i @eyepop.ai/react-native-eyepop --save
```

In the current version, the application still has to include some extra libraries in their own `package.json`.
Although those packages are defined as `peerDependencies`, they will be included, but neither expo nor
react-native/cli will autolink their native implementations (_note: there must be a better solution, feedback from ReactNative experts is welcome_).

Theses are all the dependencies to add to the application's `package.json`:

```json
{
  "dependencies": {
    "@eyepop.ai/react-native-eyepop": "1.15.1",
    "react-native-canvas": "^0.1.40",
    "react-native-file-access": "^3.1.1",
    "react-native-polyfill-globals": "^3.1.0",
    "react-native-tcp-socket": "^6.2.0",
    "react-native-webrtc": "^124.0.5",
    "web-streams-polyfill": "^3.3.3"
  }
}
```

Use the `EyePop` namespace from `react-native-eyepop` with the identical Api as the original `eyepop` package.
```js
import { EyePop } from 'react-native-eyepop';

const endpoint = EyePop.workerEndpoint({
    auth: { apiKey: process.env.EXPO_PUBLIC_EYEPOP_API_KEY || '' },
    eyepopUrl: process.env.EXPO_PUBLIC_EYEPOP_URL || undefined,
})

// ....
```


## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
