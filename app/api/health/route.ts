/**
 * N°1 Health/Liveness API (SESSION M — Runtime Resilience, TASK 30)
 *
 * GET /api/health → 200 { ok, service, pid, uptimeSec, startedAt, checks }
 *
 * 설계 원칙:
 * - 프로세스 생존 판정 전용이다. Sheets·Telegram 등 외부 의존을 호출하지 않는다 —
 *   헬스체크 주기가 외부 서비스 쿼터/채널을 소모하지 않는다 (외부 의존 판정은
 *   supervisor의 slow readiness probe 소관: /api/orders 400 계약, /api/stock 계약).
 * - 시크릿을 반환하지 않는다 — env는 "이름의 존재 여부"만 boolean으로 노출한다.
 * - 이 파일은 읽기 전용·부수효과 0이며 다른 세션 소유 파일을 만지지 않는다.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const startedAtMs = Date.now();

function bridgeLedgerReadable(): boolean {
  try {
    const file = path.join(process.cwd(), "mission-20260909", "N1_STOCK_BRIDGE", "ledger.json");
    if (!fs.existsSync(file)) return false;
    JSON.parse(fs.readFileSync(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function bridgeDirsPresent(): boolean {
  const base = path.join(process.cwd(), "mission-20260909", "N1_STOCK_BRIDGE");
  return ["inbound", "outbound", "escalations"].every((d) => {
    try {
      return fs.existsSync(path.join(base, d));
    } catch {
      return false;
    }
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "n1-storefront",
    pid: process.pid,
    startedAt: new Date(startedAtMs).toISOString(),
    uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
    checks: {
      bridgeLedgerReadable: bridgeLedgerReadable(),
      bridgeDirsPresent: bridgeDirsPresent(),
      // 존재 여부만 — 값은 절대 응답에 포함하지 않는다 (미션 §48 시크릿 비노출).
      envConfigured: {
        sheetId: Boolean((process.env.N1_SHEET_ID || "").trim()),
        googleServiceAccount: Boolean((process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim()),
        csTelegram: Boolean(
          (process.env.N1_CS_BOT_TOKEN || "").trim() && (process.env.N1_CS_CHAT_ID || "").trim(),
        ),
      },
    },
  });
}
