import type http from 'node:http';

export interface RouteContext {
  pathname: string;
  query: URLSearchParams;
  params?: Record<string, string>;
}

export type HttpRouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  context: RouteContext
) => Promise<boolean | void> | boolean | void;

export interface StaticMountOptions {
  spaFallback?: boolean;
  injectLanguage?: boolean;
}

export interface FreyaHttpService {
  /**
   * Register HTTP API route handler by path prefix
   */
  registerApi(pathPrefix: string, handler: HttpRouteHandler): () => void;

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
}
