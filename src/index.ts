import {Endpoint} from "./endpoint";
import {Options} from "./options";
import {EyePopPlot} from "./visualize";
import {CanvasRenderingContext2D} from "canvas";
import {pino} from 'pino';

export class EyePopSdk {
  public static endpoint({
      secretKey = readEnv('EYEPOP_SECRET_KEY'),
      popId = readEnv('EYEPOP_POP_ID'),
      eyepopUrl = readEnv('EYEPOP_URL'),
      autoStart = true,
      stopJobs = true,
      jobQueueLength = 1024,
      logger,
                   ...opts
  }: Options = {}): Endpoint {
      const options: Options = {
          secretKey: secretKey,
          popId : popId,
          eyepopUrl: eyepopUrl ?? 'https://api.eyepop.ai',
          autoStart: autoStart,
          stopJobs: stopJobs,
          jobQueueLength: jobQueueLength,
          logger: logger,
      };
      const endpoint = new Endpoint(options);
      return endpoint;
  }

  public static plot(context: CanvasRenderingContext2D) : EyePopPlot {
      return new EyePopPlot(context)
  }
}

const readEnv = (env: string): string | undefined => {
  if (typeof process !== 'undefined') {
    return process.env?.[env] ?? undefined;
  }
  return undefined;
};