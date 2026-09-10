/**
 * N°1 Saved Payments — PG 관리 결제 수단 저장 계층 (빌링키 아키텍처)
 *
 * 절대 계약 (미션 목표 3~5):
 *  - N°1은 raw 카드 데이터(카드번호·CVV·유효기간·인증값)를 저장·경유·로그하지 않는다.
 *    카드 등록은 PG 위젯/iframe에서 일어나고, N°1 서버가 받는 것은 PG가 발급한
 *    **빌링키(PG 관리 토큰)**와 표시용 메타데이터(카드사·끝4자리)뿐이다.
 *  - 빌링키는 고객에게 반환되지 않는다(toDisplay 제외). 등록 확정은 클라이언트 응답이
 *    아니라 서버→PG 재조회(verifyBillingKeyRegistration)로만 한다 — webhook·주문 확정과
 *    같은 서버 검증 계약.
 *  - 소유 경계: method_id만으로는 아무것도 할 수 없다 — 모든 조회·삭제는 세션 이메일과
 *    소유자 일치를 함께 확인한다(IDOR 방지).
 *  - pre-PG: 등록·사용 경로는 모두 PAYMENT_PROVIDER_NOT_CONFIGURED 정직 거절 —
 *    결제 수단이 "준비 중"임을 숨기지 않는다.
 */
import { GoogleSpreadsheet } from "google-spreadsheet";
import { randomUUID } from "crypto";

export const PAYMENT_METHODS_SHEET = "Payment_Methods";

export const PAYMENT_METHOD_HEADERS = [
  "method_id",
  "이메일",
  "provider",
  "provider_billing_key",
  "카드사",
  "끝4자리",
  "상태",
  "test_flag",
  "등록일",
  "마지막사용일",
];

export type SavedMethodStatus = "ACTIVE" | "DELETED";

export interface SavedPaymentMethod {
  methodId: string;
  email: string; // 소유자 — 세션 이메일과만 일치 조회된다
  provider: string;
  providerBillingKey: string; // PG 관리 토큰 — 클라이언트 반환 금지
  cardCorp: string; // PG가 돌려준 표시 메타데이터만
  last4: string; // PG가 돌려준 끝4자리만 (전체 번호가 아니다)
  status: SavedMethodStatus;
  testFlag: string;
  createdAt: string;
  lastUsedAt: string;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function newMethodId(): string {
  return `M-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

/** 고객 응답용 표시 프로젝션 — providerBillingKey는 절대 포함되지 않는다 */
export interface SavedPaymentMethodDisplay {
  method_id: string;
  provider: string;
  card_corp: string;
  last4: string;
  status: SavedMethodStatus;
  created_at: string;
  last_used_at: string;
}

export function toDisplay(m: SavedPaymentMethod): SavedPaymentMethodDisplay {
  return {
    method_id: m.methodId,
    provider: m.provider,
    card_corp: m.cardCorp,
    last4: m.last4,
    status: m.status,
    created_at: m.createdAt,
    last_used_at: m.lastUsedAt,
  };
}

export async function getPaymentMethodsSheet(doc: GoogleSpreadsheet) {
  const existing = doc.sheetsByTitle[PAYMENT_METHODS_SHEET];
  if (existing) return existing;
  return await doc.addSheet({ title: PAYMENT_METHODS_SHEET, headerValues: PAYMENT_METHOD_HEADERS });
}

function rowToMethod(get: (h: string) => string): SavedPaymentMethod | null {
  const methodId = str(get("method_id"));
  const email = str(get("이메일")).toLowerCase();
  const billingKey = str(get("provider_billing_key"));
  if (!methodId || !email || !billingKey) return null;
  return {
    methodId,
    email,
    provider: str(get("provider")),
    providerBillingKey: billingKey,
    cardCorp: str(get("카드사")),
    last4: str(get("끝4자리")),
    status: (str(get("상태")) || "ACTIVE") as SavedMethodStatus,
    testFlag: str(get("test_flag")),
    createdAt: str(get("등록일")),
    lastUsedAt: str(get("마지막사용일")),
  };
}

/** 등록 확정 레코드 적재 — verifyBillingKeyRegistration이 통과한 PG 조회값만 받는다 */
export async function createSavedMethod(
  doc: GoogleSpreadsheet,
  input: {
    email: string;
    provider: string;
    providerBillingKey: string;
    cardCorp?: string;
    last4?: string;
    testFlag?: string;
  },
): Promise<{ ok: boolean; method: SavedPaymentMethod }> {
  const method: SavedPaymentMethod = {
    methodId: newMethodId(),
    email: input.email.toLowerCase(),
    provider: input.provider,
    providerBillingKey: input.providerBillingKey,
    cardCorp: input.cardCorp || "",
    last4: input.last4 || "",
    status: "ACTIVE",
    testFlag: input.testFlag || "",
    createdAt: new Date().toISOString(),
    lastUsedAt: "",
  };
  try {
    const sheet = await getPaymentMethodsSheet(doc);
    await sheet.addRow({
      method_id: method.methodId,
      "이메일": method.email,
      provider: method.provider,
      provider_billing_key: method.providerBillingKey,
      "카드사": method.cardCorp,
      "끝4자리": method.last4,
      "상태": method.status,
      test_flag: method.testFlag,
      "등록일": method.createdAt,
      "마지막사용일": method.lastUsedAt,
    });
    return { ok: true, method };
  } catch (e) {
    console.error("[savedPayments] 결제 수단 저장 실패", e instanceof Error ? e.message : e);
    return { ok: false, method };
  }
}

/** 소유자의 결제 수단 목록 — 상태 무관 전체(관리 화면용). 표시는 toDisplay로. */
export async function findMethodsByOwner(
  doc: GoogleSpreadsheet,
  email: string,
): Promise<SavedPaymentMethod[]> {
  const sheet = await getPaymentMethodsSheet(doc);
  const rows = await sheet.getRows();
  return rows
    .map((r) => rowToMethod((h) => str(r.get(h))))
    .filter((m): m is SavedPaymentMethod => Boolean(m) && m!.email === email.toLowerCase())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 소유자 일치가 확인된 단일 수단 — method_id만으로는 절대 조회되지 않는다 (IDOR 방지) */
export async function findOwnedMethod(
  doc: GoogleSpreadsheet,
  email: string,
  methodId: string,
): Promise<SavedPaymentMethod | null> {
  const methods = await findMethodsByOwner(doc, email);
  return methods.find((m) => m.methodId === methodId && m.status === "ACTIVE") ?? null;
}

/** 삭제 = 상태 전이만 (PG 측 키 폐기는 어댑터 deleteBillingKey가 별도 수행) */
export async function markMethodDeleted(
  doc: GoogleSpreadsheet,
  email: string,
  methodId: string,
): Promise<boolean> {
  const sheet = await getPaymentMethodsSheet(doc);
  const rows = await sheet.getRows();
  const hit = rows.find(
    (r) => str(r.get("method_id")) === methodId && str(r.get("이메일")).toLowerCase() === email.toLowerCase(),
  );
  if (!hit) return false;
  hit.set("상태", "DELETED");
  await hit.save();
  return true;
}

export async function markMethodUsed(
  doc: GoogleSpreadsheet,
  methodId: string,
  usedAt: string,
): Promise<void> {
  try {
    const sheet = await getPaymentMethodsSheet(doc);
    const rows = await sheet.getRows();
    const hit = rows.find((r) => str(r.get("method_id")) === methodId);
    if (hit) {
      hit.set("마지막사용일", usedAt);
      await hit.save();
    }
  } catch {
    // 사용 표시 실패는 결제 흐름을 막지 않는다
  }
}
