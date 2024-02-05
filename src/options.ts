import {Logger} from "pino"
import {Session} from "./types";

export interface Authentication {
  /**
   * Authentication secret for server side execution.
   * Defaults to process.env['EYEPOP_SECRET_KEY'].
   */
  secretKey?: string | undefined;

  /**
   * Temporary authentication token for client side execution.
   */
  session?: Session | undefined;

  /**
   * For development mode, attempt to fetch an session from a logged in EyePop user in the same browser session.
   * Either pass the Url of the dashboard, or true fro the default url 'https://dashboard.eyepop.ai/sdkauth'
   */
  oAuth?: true | string | undefined;
}

export interface Options {

  auth?: Authentication | undefined;

  /**
   * Defaults to process.env['EYEPOP_POP_ID'].
   */
  popId?: string | undefined;

  /**
   * Override the default base URL for the API, e.g., "https://api.eyepop.ai/"
   *
   * Defaults to process.env['EYEPOP_URL'].
   */
  eyepopUrl?: string;

  autoStart?: boolean;
  stopJobs?: boolean;
  jobQueueLength?: number;
  logger?: Logger | undefined;
}
