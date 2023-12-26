import {EyePopSdk} from "../src";

test('EyePopSdk connect returns', () => {
  const endpoint = EyePopSdk.endpoint();
  expect(endpoint).toBeDefined();
});
