/**
 * N°1 Email Provider Boundary — 트랜잭션 이메일 중립 계약 + 어댑터 슬롯
 *
 * PG 경계(lib/paymentProvider.ts)와 같은 모양의 경계다. 가입·인증 플로우는
 * 어떤 이메일 공급자(SMTP/API) 내부에도 결속되지 않는다. provider가 연결되는 날
 * 어댑터 하나가 이 계약을 구현하면 되고, 가입 플로우는 그대로다.
 *
 * 현재 상태 (pre-provider):
 *  - resolveEmailProvider() 는 env(N1_EMAIL_PROVIDER)가 비어 있으면 noEmailProvider 만 돌려준다.
 *  - noEmailProvider 는 EMAIL_PROVIDER_NOT_CONFIGURED 로 정직하게 거절한다 — "보냈다"는 거짓말 없음.
 *  - bridgeEmailProvider 는 N1_EMAIL_PROVIDER=bridge 로 명시 켠 경우에만 존재하며,
 *    발송을 "실제 전송"이라 말하지 않는다 — 아웃바운드 큐 파일을 남기고 delivery:"bridge" 로 응답한다.
 *    (승인된 E2E 검증에서 Owner Gmail GUI leg가 이 큐의 이메일을 전달한다 / 개발·검증 전용)
 *
 * 시크릿 계약: 자격증명은 env로만(N1_EMAIL_* 네이밍) — 값을 반환하지도 로그에 싣지도 않는다.
 * 수신자 계약: to는 서버가 검증한 계정 이메일만 — 사용자 입력 URL/주소를 그대로 조립하지 않는다.
 */
import fs from "fs";
import path from "path";

export const EMAIL_PROVIDER_NOT_CONFIGURED = "EMAIL_PROVIDER_NOT_CONFIGURED";
export const EMAIL_PROVIDER_MSG_PREPARING = "이메일 발송 준비 중입니다.";

export interface VerificationEmail {
  to: string;
  username?: string;
  verifyUrl: string;
  expiresAt: string;
}

export interface EmailSendResult {
  ok: boolean;
  provider: string;
  /** "sent" = 실제 전송 / "bridge" = 아웃바운드 큐 적재(미전송) */
  delivery?: "sent" | "bridge";
  ref?: string;
  code?: string;
  message?: string;
}

export interface EmailProvider {
  readonly name: string;
  /** true = 실제 외부 전송 어댑터. false = disabled / 큐 전용 */
  readonly live: boolean;
  sendVerificationEmail(email: VerificationEmail): Promise<EmailSendResult>;
}

// ── NO_EMAIL_PROVIDER — provider 미연결 상태의 유일한 기본 어댑터 ──

export const noEmailProvider: EmailProvider = {
  name: "no_email_provider",
  live: false,
  async sendVerificationEmail() {
    return {
      ok: false,
      provider: this.name,
      code: EMAIL_PROVIDER_NOT_CONFIGURED,
      message: EMAIL_PROVIDER_MSG_PREPARING,
    };
  },
};

// ── BRIDGE — 아웃바운드 큐 (E2E·개발 전용, 실전송 아님) ──

const BRIDGE_RELATIVE_DIR = path.join("mission-20260909", "N1_EMAIL_BRIDGE", "outbound");

export function bridgeOutboundDir(cwd: string = process.cwd()): string {
  return path.join(cwd, BRIDGE_RELATIVE_DIR);
}

/** 인증 메일 본문 — 가입 확인 안내. 수신자에게 보여줄 문장만 담는다. */
export function renderVerificationEmail(email: VerificationEmail): { subject: string; text: string } {
  const who = email.username ? `${email.username}님` : "고객님";
  const subject = "[N°1] 이메일 인증 안내";
  const text = [
    `${who}, 안녕하세요.`,
    "",
    "N°1 가입 이메일 인증 요청입니다. 아래 링크를 눌러 인증을 완료해 주세요.",
    "",
    email.verifyUrl,
    "",
    `이 링크는 ${email.expiresAt} (10분) 까지 유효하며 1회만 사용할 수 있습니다.`,
    "본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다 — 계정은 생성되지 않습니다.",
    "",
    "— N°1",
  ].join("\n");
  return { subject, text };
}

export const bridgeEmailProvider: EmailProvider = {
  name: "bridge",
  live: false,
  async sendVerificationEmail(email) {
    const dir = bridgeOutboundDir();
    fs.mkdirSync(dir, { recursive: true });
    const { subject, text } = renderVerificationEmail(email);
    const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`;
    fs.writeFileSync(
      path.join(dir, ref),
      JSON.stringify(
        { queuedAt: new Date().toISOString(), to: email.to, subject, text, verifyUrl: email.verifyUrl },
        null,
        2,
      ),
      "utf8",
    );
    return { ok: true, provider: this.name, delivery: "bridge", ref };
  },
};

// ── 어댑터 해석 — 유일한 진입점 ──

/** §54 — 주문 라이프사이클 트랜잭션 이메일 (bridge 큐 적재 전용) */
export function queueBridgeTransactional(input: {
  to: string;
  subject: string;
  text: string;
  kind: string;
  refId: string;
}): EmailSendResult {
  const dir = bridgeOutboundDir();
  fs.mkdirSync(dir, { recursive: true });
  const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`;
  fs.writeFileSync(
    path.join(dir, ref),
    JSON.stringify(
      {
        queuedAt: new Date().toISOString(),
        kind: input.kind,
        refId: input.refId,
        to: input.to,
        subject: input.subject,
        text: input.text,
        delivery: "bridge",
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, provider: "bridge", delivery: "bridge", ref };
}

export interface ResolvedEmailProvider {
  provider: EmailProvider;
  /** 실제 외부 전송이 가능한 상태인가 (가입 플로우의 발송 확신도 판단용) */
  liveEmailAvailable: boolean;
  /** 현재 구성 요약 — 시크릿 값 없이 */
  configSummary: string;
}

/**
 * env → 어댑터 해석.
 *  - N1_EMAIL_PROVIDER 미설정/빈값 → no_email_provider (정직 거절)
 *  - "bridge" → bridge (아웃바운드 큐 — 실전송 아님, delivery:"bridge")
 *  - 실제 provider("smtp" 등) → 어댑터 미구현 — no_email_provider 폴백 + 요약 명시
 *    (런북: N1_EMAIL_ACTIVATION_RUNBOOK — 어댑터 구현 + 리뷰 + env 주입)
 */
export function resolveEmailProvider(
  env: Record<string, string | undefined> = process.env,
): ResolvedEmailProvider {
  const configured = (env.N1_EMAIL_PROVIDER || "").trim().toLowerCase();
  if (!configured) {
    return { provider: noEmailProvider, liveEmailAvailable: false, configSummary: "N1_EMAIL_PROVIDER unset → no_email_provider" };
  }
  if (configured === "bridge") {
    return { provider: bridgeEmailProvider, liveEmailAvailable: false, configSummary: "bridge (outbound queue — not live delivery)" };
  }
  return {
    provider: noEmailProvider,
    liveEmailAvailable: false,
    configSummary: `N1_EMAIL_PROVIDER=${configured} → adapter not implemented → no_email_provider`,
  };
}
