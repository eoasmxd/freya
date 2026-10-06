import type http from 'node:http';
import type { Duplex } from 'node:stream';

export interface RouteContext {
  pathname: string;
  query: URLSearchParams;
  params?: Record<string, string>;
}

export interface RouteOptions {
  auth?: boolean;
}

export type HttpRouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  context: RouteContext
) => Promise<boolean | void> | boolean | void;

export interface StaticMountOptions extends RouteOptions {
  spaFallback?: boolean;
  injectLanguage?: boolean;
}

export type UpgradeRouteHandler = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface FreyaHttpService {
  /**
   * Register HTTP API route handler by path prefix
   */
  registerApi(pathPrefix: string, handler: HttpRouteHandler, options?: RouteOptions): () => void;

  /**
   * Unregister HTTP API route handler by path prefix
   */
  unregisterApi(pathPrefix: string): boolean;

  /**
   * Mount physical static directory
   */
  registerStatic(pathPrefix: string, localDir: string, options?: StaticMountOptions): () => void;

  /**
   * Unregister static directory mount
   */
  unregisterStatic(pathPrefix: string): boolean;

  /**
   * Register protocol upgrade route handler by path prefix
   */
  registerUpgrade(pathPrefix: string, handler: UpgradeRouteHandler, options?: RouteOptions): () => void;

  /**
   * Unregister protocol upgrade route handler by path prefix
   */
  unregisterUpgrade(pathPrefix: string): boolean;
}
