# Welcome to your Expo app 👋

This is a simple EyePop get-started with ReactNative created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Pre-requisites

EyePop has been tested with `react-native==0.76.7` and `expo==52.0.36` and the EyePop SDK does not require
any additional dependencies for its base functionality. There is no strict dependency on using `expo`, but 
EyePop does not provide those tested configurations and examples (e.g. using `@react-native-community/cli`).

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
## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
    npx expo run:android
   ```
or 
```bash
    npx expo run:ios
```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).
