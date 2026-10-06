import type { FreyaContext, RouteContext } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import type http from 'node:http';

/**
 * Lightweight authentication service for Web and WebSocket connections
 */
export class FreyaAuthService {
  private validTokens = new Set<string>();

  private jsonResponse(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Sec-WebSocket-Protocol'
    });
    res.end(JSON.stringify(data));
  }

  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) {
          req.destroy();
          reject(new Error('Request body too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
    });
  }

  hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  extractToken(req: http.IncomingMessage): string | null {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    const wsProtocol = req.headers['sec-websocket-protocol'];
    if (wsProtocol) {
      const parts = wsProtocol.split(',').map(p => p.trim());
      if (parts.length >= 2 && parts[0] === 'freya-auth') {
        return parts[1];
      }
      if (parts.length === 1 && parts[0] !== 'freya-auth') {
        return parts[0];
      }
    }

    return null;
  }

  isAuthRequired(ctx?: FreyaContext, bypassNoAuth?: boolean): boolean {
    if (bypassNoAuth) return false;
    if (!ctx) return false;
    const authConfig = (ctx.config as any)?.server?.auth;
    return authConfig?.enabled === true && Boolean(authConfig?.password);
  }

  isAuthorized(req: http.IncomingMessage, ctx?: FreyaContext, bypassNoAuth?: boolean): boolean {
    if (!this.isAuthRequired(ctx, bypassNoAuth)) {
      return true;
    }
    const token = this.extractToken(req);
    if (!token) {
      return false;
    }
    return this.validTokens.has(token);
  }

  async handleAuthApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    context: RouteContext,
    ctx?: FreyaContext,
    bypassNoAuth?: boolean
  ): Promise<boolean> {
    const pathname = context.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Sec-WebSocket-Protocol'
      });
      res.end();
      return true;
    }

    if (pathname === '/api/auth/status' && req.method === 'GET') {
      const requireAuth = this.isAuthRequired(ctx, bypassNoAuth);
      const token = this.extractToken(req);
      const authenticated = !requireAuth || (token ? this.validTokens.has(token) : false);
      this.jsonResponse(res, 200, {
        success: true,
        requireAuth,
        authenticated
      });
      return true;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const requireAuth = this.isAuthRequired(ctx, bypassNoAuth);
      if (!requireAuth) {
        const token = crypto.randomBytes(32).toString('hex');
        this.validTokens.add(token);
        this.jsonResponse(res, 200, { success: true, token });
        return true;
      }

      try {
        const { password } = await this.parseBody(req);
        if (typeof password !== 'string') {
          this.jsonResponse(res, 400, { success: false, error: 'Password required', code: 'PASSWORD_REQUIRED' });
          return true;
        }

        const inputHash = this.hashPassword(password);
        const configuredPassword = String((ctx?.config as any)?.server?.auth?.password || '');
        const matched = inputHash === configuredPassword || password === configuredPassword;

        if (!matched) {
          this.jsonResponse(res, 401, { success: false, error: 'Invalid password', code: 'INVALID_PASSWORD' });
          return true;
        }

        const token = crypto.randomBytes(32).toString('hex');
        this.validTokens.add(token);
        this.jsonResponse(res, 200, { success: true, token });
        return true;
      } catch (err: any) {
        this.jsonResponse(res, 400, { success: false, error: err.message });
        return true;
      }
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = this.extractToken(req);
      if (token) {
        this.validTokens.delete(token);
      }
      this.jsonResponse(res, 200, { success: true });
      return true;
    }

    return false;
  }
}
