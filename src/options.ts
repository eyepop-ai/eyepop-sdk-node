export interface Options {
  /**
   * Defaults to process.env['EYEPOP_SECRET_KEY'].
   */
  secretKey?: string | undefined;

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
}
