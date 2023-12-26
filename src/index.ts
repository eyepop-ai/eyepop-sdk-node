import {Endpoint} from "./endpoint";
import {Options} from "./options";

export class EyePopSdk {
  public static endpoint({
      secretKey = readEnv('EYEPOP_SECRET_KEY'),
      popId = readEnv('EYEPOP_POP_ID'),
      eyepopUrl = readEnv('EYEPOP_URL'),
      autoStart = true,
      stopJobs = true,
                   ...opts
  }: Options = {}): Endpoint {
      const options: Options = {
          secretKey: secretKey,
          popId : popId,
          eyepopUrl: eyepopUrl ?? 'https://api.eyepop.ai',
          autoStart: autoStart,
          stopJobs: stopJobs
      };
      const endpoint = new Endpoint(options);
      return endpoint;
  }
}

const readEnv = (env: string): string | undefined => {
  if (typeof process !== 'undefined') {
    return process.env?.[env] ?? undefined;
  }
  return undefined;
};