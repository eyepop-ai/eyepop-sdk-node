# Welcome to your Expo app 👋

This is a simple EyePop get-started with ReactNative created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Pre-requisites

EyePop has been tested with `react-native==0.76.7` and `expo==52.0.36` and the EyePop SDK does not require
any additional dependencies for its base functionality. There is no strict dependency on using `expo`, but 
EyePop does not provide those tested configurations and examples (e.g. using `@react-native-community/cli`).

### Required packages and polyfills

Unfortunately debugging and solving configuration and version issues involving Node, Npm, Npx, Babel, React Native,
Metro, Expo etc can be difficult and confusing. Below, we provide some of the lessons we have learned.

#### Http
The `fetch` implementation in React Native does not support streamed request bodies (some versions _do_ support 
streamed response bodies). For large uploads, either from the local file system or retrieved by your application
through some other remote protocol, this can lead to out of memory errors in your application code. 
We strongly recommend to include `react-native-tcp-socket>=^6.2.0` in you application. If the EyePop SDK identifies 
this package at runtime, it will use a custom implementation to upload large files.

#### Native Fs  
To enable local file uploads vie the `PathSource` parameter type include _either_ `react-native-fs>=2.20.0` 
_or_ `expo-file-system>=18.0.11`. The presence of one of those libraries will enable the EyePop SDK to read 
and upload local files in chunks.

#### Other polyfills and Buffer
For the required polyfills add the following to your package.json 
```json
{
  "dependencies": {
    "react-native-polyfill-globals": "^3.1.0"
  }
}
```
And this on top of your central source file 
```typescript
import 'react-native-polyfill-globals/auto'
global.Buffer = require('buffer').Buffer
```

#### Async Iterable, i.e. for await (x of iterable)
In some versions of react native, you might encounter a runtime error `TypeError: Object is not async iterable`. 
In this case your environment does not provide the symbol `Symbol.asyncIterator`. Fix this by adding to your package.json
```json
{
  "dependencies": {
      "@azure/core-asynciterator-polyfill": "^1.0.2"
  }
}
```
And this on top of your central source file 
```typescript
import '@azure/core-asynciterator-polyfill'
```

#### Others 

If you encounter an error `response body is empty` then you are not using the most recent version of `react-native-fetch-api`.
Our expo-based example will automatically use recent versions of React Native packages and should not have this issue.
To solve this error you can try to include the most recent version of `react-native-fetch-api` or provide follow the instructions 
uin the Http section above to force streamed HTTP responses using Tcp sockets. 

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
