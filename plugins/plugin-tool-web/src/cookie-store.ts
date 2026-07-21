/** Cookie 状态管理器：按域名存储，记录总是执行，发送可选控制 */

function extractDomain(urlString: string): string {
    const url = new URL(urlString);
    return url.hostname;
}

function parseSetCookieHeaders(setCookieHeaders: string[] | string): Map<string, string> {
    const result = new Map<string, string>();
    const raw = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const header of raw) {
        const semiIndex = header.indexOf(';');
        const kvPart = semiIndex === -1 ? header.trim() : header.slice(0, semiIndex).trim();
        const eqIndex = kvPart.indexOf('=');
        if (eqIndex === -1) continue;

        const key = kvPart.slice(0, eqIndex).trim();
        const value = kvPart.slice(eqIndex + 1).trim();
        if (key) {
            result.set(key, value);
        }
    }

    return result;
}

function serializeCookieHeader(cookieMap: Map<string, string>): string {
    const pairs: string[] = [];
    for (const [key, value] of cookieMap) {
        pairs.push(`${key}=${value}`);
    }
    return pairs.join('; ');
}

export class CookieStore {
    private jar: Map<string, Map<string, string>> = new Map();

    /** 获取指定域名的 Cookie 请求头 */
    getCookieHeader(domain: string): string | null {
        const cookies = this.jar.get(domain);
        if (!cookies || cookies.size === 0) return null;
        return serializeCookieHeader(cookies);
    }

    /** 从 HTTP 响应的 Set-Cookie 记录 Cookie */
    recordFromResponse(url: string, setCookieHeaders: string[] | string | undefined): void {
        if (!setCookieHeaders) return;
        if (Array.isArray(setCookieHeaders) && setCookieHeaders.length === 0) return;

        const domain = extractDomain(url);
        const newCookies = parseSetCookieHeaders(setCookieHeaders);

        if (newCookies.size === 0) return;

        const existing = this.jar.get(domain) || new Map<string, string>();
        for (const [key, value] of newCookies) {
            existing.set(key, value);
        }

        this.jar.set(domain, existing);
    }

    getAllDomains(): string[] {
        return Array.from(this.jar.keys());
    }
}
