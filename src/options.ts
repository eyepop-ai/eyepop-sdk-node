export interface Options {
  /**
   * Defaults to process.env['EYEPOP_SECRET_KEY'].
   */
  secretKey?: string;

  /**
   * Defaults to process.env['EYEPOP_POP_ID'].
   */
  popId?: string;

  /**
   * Override the default base URL for the API, e.g., "https://api.eyepop.ai/"
   *
   * Defaults to process.env['EYEPOP_URL'].
   */
  eyepopUrl?: string | null | undefined;

  autoStart?: boolean;
  stopJobs?: boolean;
}
