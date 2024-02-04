import {Logger} from "pino"

export interface Options {
  /**
   * Authentication secret for server side execution.
   * Defaults to process.env['EYEPOP_SECRET_KEY'].
   */
  secretKey?: string | undefined;

  /**
   * Temporary authentication token for client side execution.
   */
  accessToken?: string | undefined;
  /**
   * Temporary authentication token for client side execution expires in seconds.
   * Defaults to 3600
   */
  accessTokenExpiresIn?: number | undefined;

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
