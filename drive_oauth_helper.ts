/**
 * drive_oauth_helper — Next.js 서버에서 drive_oauth.py와 동일 토큰 재사용
 * token.json (디렉터 계정 OAuth)을 읽어 Drive 서비스를 반환한다.
 * SSL 우회 포함 (로컬 인증서 체인 문제).
 */
import fs from "fs";
import path from "path";
import { JWT } from "google-auth-library";

let cachedService: any = null;

export function get_service() {
  if (cachedService) return cachedService;

  // requests 전역 SSL 우회 (google-auth 내부 httpx 대신 google-auth-library JWT 사용)
  // JWT는 google-auth-library의 것이므로 Node https를 씀 → NODE_TLS_REJECT_UNAUTHORIZED=0로 우회됨

  // token.json은 OAuth user token이라 JWT(service account)와 다름.
  // 여기서는 OAuth client 토큰을 직접 갱신하는 대신,
  // drive_oauth.py가 저장한 token.json의 refresh_token을 사용해 갱신한다.
  const tokenPath = path.join(process.cwd(), "..", "token.json");
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));

  const clientSecretPath = path.join(process.cwd(), "..", "oauth_client.json");
  const client = JSON.parse(fs.readFileSync(clientSecretPath, "utf-8"));
  const clientId = client.installed.client_id;
  const clientSecret = client.installed.client_secret;

  // 간단한 OAuth2 클라이언트 구현 (googleapis 없이 fetch 사용)
  class OAuth2UserClient {
    accessToken = token.access_token || "";
    private refreshToken = token.refresh_token || "";
    private expiresAt = token.expiry_date || 0;

    private async ensureToken() {
      if (this.accessToken && Date.now() < this.expiresAt - 60_000) return;
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: this.refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const data = await res.json();
      if (!data.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(data)}`);
      this.accessToken = data.access_token;
      this.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      // 갱신된 토큰 저장
      fs.writeFileSync(tokenPath, JSON.stringify({ ...token, access_token: this.accessToken, expiry_date: this.expiresAt }));
    }

    async request(opts: { url: string; method?: string; body?: any; headers?: Record<string, string> }) {
      await this.ensureToken();
      const res = await fetch(opts.url, {
        method: opts.method || "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json();
    }
  }

  const client2 = new OAuth2UserClient();

  cachedService = {
    files: {
      list: async (opts: any) => {
        const params = new URLSearchParams({ fields: opts.fields || "files(id,name)", supportsAllDrives: "true", ...(opts.q ? { q: opts.q } : {}) });
        const data = await client2.request({ url: `https://www.googleapis.com/drive/v3/files?${params}` });
        return { files: data.files || [] };
      },
      get: async (opts: any) => client2.request({ url: `https://www.googleapis.com/drive/v3/files/${opts.fileId}?fields=${opts.fields || "*"}` }),
    },
  };
  return cachedService;
}
