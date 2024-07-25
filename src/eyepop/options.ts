import {Logger} from "pino"
import {Session} from "./types";

export interface Auth0Options {
  domain: string
  clientId: string
  audience: string
  scope: string
}

export interface SecretKeyAuth {
  /**
   * Authentication secret for server side execution.
   * Defaults to process.env['EYEPOP_SECRET_KEY'].
   */
  secretKey: string;
}

export interface SessionAuth {
  /**
   * Temporary authentication token for client side execution.
   */
  session: Session;
}

export interface OAuth2Auth {
  /**
   * For development mode, authenticate with your dashboard.eyepop.ai account
   */
  oAuth2: true | Auth0Options;
}

export type Authentication = undefined | SecretKeyAuth | SessionAuth | OAuth2Auth

export interface Options {

  auth?: Authentication | undefined;

  /**
   * Override the default base URL for the API, e.g., "https://api.eyepop.ai/"
   *
   * Defaults to process.env['EYEPOP_URL'].
   */
  eyepopUrl?: string;

  jobQueueLength?: number;

  logger?: Logger | undefined;
}

