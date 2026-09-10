/**
 * N°1 Payment Provider Boundary — PG 중립 계약 + 어댑터 슬롯 (미션 §15·§16·§17)
 *
 * 체크아웃 UI와 주문 플로우는 토스·NICE·KCP 어느 PG 내부에도 결속되지 않는다.
 * PG가 연결되는 날 새 어댑터 하나가 이 계약을 구현하면 되고, 체크아웃은 그대로다.
 *
 * 현재 상태 (pre-PG):
 *  - resolvePaymentProvider() 는 env(N1_PG_PROVIDER)가 비어 있으면 noLivePgProvider 만 돌려준다.
 *  - noLivePgProvider 는 **모든** 호출을 PAYMENT_PROVIDER_NOT_CONFIGURED 로 정직하게 거절한다.
 *    "결제 완료"를 위조하지 않고, 주문을 PAID로 만지지 않는다 (미션 §17).
 *  - testOnlyProvider 는 N1_PG_TEST_ONLY=true 로 명시 켠 경우에만 존재하며, TEST- 접두
 *    주문번호에만 응답한다 — 프로덕션 주문과 구조적으로 격리 (미션 §17 TEST_ONLY 계약).
 *
 * 시크릿 계약: 자격증명은 env로만(N1_PG_* 네이밍) — 이 모듈은 값을 반환하지도 로그에 싣지도 않는다.
 * 카드 데이터 계약: 민감 카드 데이터는 어댑터를 경유하지 않는다 — 결제 입력은 PG 위젯/iframe 위임.
 */

export const PAYMENT_PROVIDER_NOT_CONFIGURED = "PAYMENT_PROVIDER_NOT_CONFIGURED";
export const PAYMENT_PROVIDER_TEST_FORBIDDEN = "PAYMENT_PROVIDER_TEST_ORDER_FORBIDDEN";
export const CUSTOMER_MSG_PG_PREPARING = "결제 시스템 준비 중입니다.";

export type PaymentCurrency = "KRW";

/** 결제 요청의 입력 — 주문 draft 가 서버에서 확정된 뒤에만 만들어진다 */
export interface ProviderOrderRef {
  order_id: string;
  amount: number;
  currency: PaymentCurrency;
  order_name: string;
  customer_name?: string;
  customer_email?: string;
  success_url?: string;
  fail_url?: string;
  /** 세이브드 결제 수단 사용 — PG 관리 빌링키로 청구 (빌링키 미지원 어댑터는 거절).
   *  소유 검증(세션 이메일 일치)은 이 값을 넘기기 전에 호출자가 끝낸다. */
  saved_method?: { method_id: string; provider_billing_key: string };
}

export interface ProviderRequestResult {
  ok: boolean;
  provider: string;
  /** 거절 코드 — PAYMENT_PROVIDER_NOT_CONFIGURED 등 (ok:false 일 때) */
  code?: string;
  /** 고객에게 그대로 보여줘도 되는 문구 — 내부 원문 금지 (Session L 위생 계약) */
  customer_message?: string;
  /** PG가 발급한 결제 고유번호 (우리 payment_id 와 별개) */
  provider_payment_id?: string;
  /** 고객을 보낼 결제창 URL (redirect 방식) 또는 위젯 파라미터 */
  checkout_url?: string;
  requested_amount?: number;
  raw_ref?: string;
}

export type ProviderPayStatus = "PENDING" | "AUTHORIZED" | "CONFIRMED" | "FAILED" | "CANCELLED";

/** 서버측 검증 결과 — webhook payload 가 아니라 **PG 조회 응답**을 담는다 (미션 §20) */
export interface ProviderVerification {
  ok: boolean;
  provider: string;
  code?: string;
  customer_message?: string;
  provider_payment_id: string;
  status: ProviderPayStatus;
  /** PG가 확정한 금액 — 주문 금액과 대조한다 (불일치 = 절대 확정 금지) */
  amount?: number;
  currency?: PaymentCurrency;
  paid_at?: string;
  failure_code?: string;
  failure_message?: string;
  raw_ref?: string;
}

export interface PaymentProvider {
  /** 어댑터 식별자 — Payments 시트 provider 컬럼·로그에 기록 ("no_live_pg" | "test_only" | …) */
  readonly name: string;
  /** true = 실제 자금이 움직이는 라이브 어댑터. false = disabled / test 전용 */
  readonly live: boolean;
  /** PG → 서버 webhook 의 서명 검증 (미설정·불일치 = false — 그 webhook 은 폐기) */
  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean;
  createPaymentRequest(order: ProviderOrderRef): Promise<ProviderRequestResult>;
  /** 서버가 PG에 직접 조회해 거래를 검증한다 — webhook 본문의 금액·상태를 신뢰하지 않는다 */
  verifyPayment(ref: { payment_id: string; provider_payment_id: string; order_id: string }): Promise<ProviderVerification>;
  cancelPayment(ref: { payment_id: string; provider_payment_id: string; reason?: string }): Promise<ProviderVerification>;
  refundPayment(ref: { payment_id: string; provider_payment_id: string; amount: number; reason?: string }): Promise<ProviderVerification>;
  getPaymentStatus(ref: { payment_id: string; provider_payment_id: string; order_id: string }): Promise<ProviderVerification>;

  /* ── 빌링키(세이브드 페이) — PG 관리 결제 수단 (선택 구현; 미구현 어댑터는 슬롯만 노출) ──
   * 계약: raw 카드 데이터는 어댑터 경유 금지 — 등록은 PG 위젯에서, 서버가 받는 것은
   * PG가 발급한 빌링키와 표시 메타데이터(카드사·끝4자리)뿐. 등록 확정은 클라이언트
   * 응답이 아니라 서버→PG 재조회로만 한다 (webhook 검증과 같은 서버 검증 계약). */
  /** PG 등록 위젯 발급 — 고객이 이 URL/파라미터에서 카드를 등록한다 (서버 비경유) */
  createBillingKeyRegistration?(req: {
    member: { email: string; customer_name?: string };
    success_url?: string;
    fail_url?: string;
  }): Promise<BillingKeyRegistrationResult>;
  /** 등록 확정 — 서버가 PG를 직접 조회해 빌링키·표시 메타데이터를 받는다 (클라이언트 응답 신뢰 금지) */
  verifyBillingKeyRegistration?(ref: { registration_ref: string; member_email: string }): Promise<BillingKeyVerification>;
  /** 빌링키 폐기 (회원 삭제 요청 시) */
  deleteBillingKey?(ref: { provider_billing_key: string }): Promise<{ ok: boolean; provider: string; code?: string; customer_message?: string }>;
}

export interface BillingKeyRegistrationResult {
  ok: boolean;
  provider: string;
  code?: string;
  customer_message?: string;
  /** PG 등록 위젯 URL (redirect 방식) 또는 위젯 파라미터 */
  registration_url?: string;
  /** 서버가 이후 PG 재조회에 쓰는 등록 참조 번호 */
  registration_ref?: string;
}

export interface BillingKeyVerification {
  ok: boolean;
  provider: string;
  code?: string;
  customer_message?: string;
  /** PG가 발급한 빌링키 — 저장은 되지만 클라이언트 반환은 금지 */
  provider_billing_key?: string;
  /** PG가 돌려준 표시 메타데이터만 (카드번호·CVC 등은 구조적으로 존재하지 않는다) */
  card_corp?: string;
  last4?: string;
}

// ── NO_LIVE_PG — pre-PG 상태의 유일한 기본 어댑터 (미션 §17) ──

const notConfigured = (provider: string, code = PAYMENT_PROVIDER_NOT_CONFIGURED) => ({
  ok: false,
  provider,
  code,
  customer_message: CUSTOMER_MSG_PG_PREPARING,
});

export const noLivePgProvider: PaymentProvider = {
  name: "no_live_pg",
  live: false,
  verifyWebhookSignature() {
    return false; // PG 미연결 — 어떤 webhook 도 수용하지 않는다
  },
  async createPaymentRequest() {
    return notConfigured(this.name);
  },
  async verifyPayment(ref) {
    return {
      ...notConfigured(this.name),
      provider_payment_id: ref.provider_payment_id,
      status: "FAILED",
      failure_code: PAYMENT_PROVIDER_NOT_CONFIGURED,
    };
  },
  async cancelPayment(ref) {
    return { ...notConfigured(this.name), provider_payment_id: ref.provider_payment_id, status: "CANCELLED" };
  },
  async refundPayment(ref) {
    return { ...notConfigured(this.name), provider_payment_id: ref.provider_payment_id, status: "FAILED" };
  },
  async getPaymentStatus(ref) {
    return { ...notConfigured(this.name), provider_payment_id: ref.provider_payment_id, status: "FAILED" };
  },
  async createBillingKeyRegistration() {
    return notConfigured(this.name);
  },
  async verifyBillingKeyRegistration() {
    return { ok: false, provider: this.name, code: PAYMENT_PROVIDER_NOT_CONFIGURED, customer_message: CUSTOMER_MSG_PG_PREPARING };
  },
  async deleteBillingKey() {
    return { ok: false, provider: this.name, code: PAYMENT_PROVIDER_NOT_CONFIGURED, customer_message: CUSTOMER_MSG_PG_PREPARING };
  },
};

// ── TEST_ONLY 합성 PG — E2E 검증용 (프로덕션 주문과 구조적 격리) ──

/** TEST 접두 주문번호만 — 일반 주문이 합성 PG에 닿는 것을 타입 레벨이 아니라 여기서 차단 */
export function isTestOrderId(orderId: string): boolean {
  return /^TEST-\d{8}-/.test(orderId || "");
}

interface TestPgTx {
  providerPaymentId: string;
  orderId: string;
  amount: number;
  currency: PaymentCurrency;
  status: ProviderPayStatus;
  settledAt?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __n1_test_pg_tx: Map<string, TestPgTx> | undefined;
}

function testTxStore(): Map<string, TestPgTx> {
  if (!global.__n1_test_pg_tx) global.__n1_test_pg_tx = new Map();
  return global.__n1_test_pg_tx;
}

/** 테스트 세션 초기화 (테스트 harness 용) */
export function resetTestPg(): void {
  global.__n1_test_pg_tx = undefined;
}

function testVerification(tx: TestPgTx): ProviderVerification {
  return {
    ok: tx.status === "CONFIRMED" || tx.status === "AUTHORIZED",
    provider: "test_only",
    provider_payment_id: tx.providerPaymentId,
    status: tx.status,
    amount: tx.amount,
    currency: tx.currency,
    paid_at: tx.settledAt,
    failure_code: tx.status === "FAILED" ? "TEST_DECLINED" : undefined,
    raw_ref: "test_pg_tx",
  };
}

export const testOnlyProvider: PaymentProvider = {
  name: "test_only",
  live: false,
  verifyWebhookSignature() {
    // 합성 webhook 은 서버 내부(test-webhook 라우트)에서만 발화 — 외부 서명 계약 없음.
    // 그래도 호출자 식별은 한다: 테스트 라우트가 secret 헤더를 env 값과 대조해야 한다.
    return true;
  },
  async createPaymentRequest(order) {
    if (!isTestOrderId(order.order_id)) {
      return {
        ok: false,
        provider: this.name,
        code: PAYMENT_PROVIDER_TEST_FORBIDDEN,
        customer_message: "테스트 결제는 테스트 주문에만 사용할 수 있습니다.",
      };
    }
    const providerPaymentId = `testpay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    testTxStore().set(providerPaymentId, {
      providerPaymentId,
      orderId: order.order_id,
      amount: order.amount,
      currency: order.currency || "KRW",
      status: "PENDING",
    });
    return {
      ok: true,
      provider: this.name,
      provider_payment_id: providerPaymentId,
      requested_amount: order.amount,
      // 합성 결제창 — 실제 PG 결제창이 올 자리. 운영 UI는 이 URL을 열지 않는다(테스트 전용).
      checkout_url: `/checkout/payment/test?pid=${providerPaymentId}`,
      raw_ref: "test_pg_tx",
    };
  },
  async verifyPayment(ref) {
    const tx = testTxStore().get(ref.provider_payment_id);
    if (!tx || tx.orderId !== ref.order_id) {
      return {
        ok: false,
        provider: this.name,
        provider_payment_id: ref.provider_payment_id,
        status: "FAILED",
        failure_code: "TEST_TX_NOT_FOUND",
      };
    }
    return testVerification(tx);
  },
  async cancelPayment(ref) {
    const tx = testTxStore().get(ref.provider_payment_id);
    if (tx && tx.status === "PENDING") tx.status = "CANCELLED";
    return tx
      ? testVerification(tx)
      : { ok: false, provider: this.name, provider_payment_id: ref.provider_payment_id, status: "FAILED", failure_code: "TEST_TX_NOT_FOUND" };
  },
  async refundPayment(ref) {
    const tx = testTxStore().get(ref.provider_payment_id);
    if (tx && tx.status === "CONFIRMED") tx.status = "CANCELLED";
    return tx
      ? testVerification(tx)
      : { ok: false, provider: this.name, provider_payment_id: ref.provider_payment_id, status: "FAILED", failure_code: "TEST_TX_NOT_FOUND" };
  },
  async getPaymentStatus(ref) {
    return this.verifyPayment(ref);
  },
};

/** 테스트 PG의 "정산 완료" 발화 — 명시적 시뮬레이션만 PG 승인을 만든다 (위조 경로 없음) */
export function settleTestPayment(providerPaymentId: string): boolean {
  const tx = testTxStore().get(providerPaymentId);
  if (!tx || tx.status !== "PENDING") return false;
  tx.status = "CONFIRMED";
  tx.settledAt = new Date().toISOString();
  return true;
}

// ── 어댑터 해석 — 유일한 진입점 (라우트·플로우는 이 함수만 안다) ──

export interface ResolvedPaymentProvider {
  provider: PaymentProvider;
  /** PG 카드 결제가 실제로 가능한 상태인가 (라우트 게이트) */
  livePgAvailable: boolean;
  /** PG 관리 세이브드 결제 수단(빌링키)이 실제로 가능한 상태인가 — pre-PG는 항상 false */
  savedMethodsAvailable: boolean;
  /** 현재 구성 요약 — 시크릿 값 없이 (운영 진단용) */
  configSummary: string;
}

export const TEST_ONLY_FLAG_ENV = "N1_PG_TEST_ONLY";

/**
 * env → 어댑터 해석.
 *  - N1_PG_PROVIDER 미설정/빈값 → no_live_pg (pre-PG 기본 상태)
 *  - "test" + N1_PG_TEST_ONLY=true → test_only (TEST- 주문만)
 *  - 실제 PG("toss" 등) → 아직 어댑터 미구현 — no_live_pg 로 폴백하고 요약에 명시
 *    (활성화 절차: N1_PG_ACTIVATION_RUNBOOK — 어댑터 구현 + 리뷰 + env 주입)
 */
export function resolvePaymentProvider(
  env: Record<string, string | undefined> = process.env,
): ResolvedPaymentProvider {
  const configured = (env.N1_PG_PROVIDER || "").trim().toLowerCase();
  if (!configured) {
    return { provider: noLivePgProvider, livePgAvailable: false, savedMethodsAvailable: false, configSummary: "N1_PG_PROVIDER unset → no_live_pg" };
  }
  if (configured === "test") {
    const flag = (env.N1_PG_TEST_ONLY || "").trim().toLowerCase() === "true";
    if (flag) {
      return { provider: testOnlyProvider, livePgAvailable: true, savedMethodsAvailable: false, configSummary: "test_only (N1_PG_TEST_ONLY=true)" };
    }
    return {
      provider: noLivePgProvider,
      livePgAvailable: false,
      savedMethodsAvailable: false,
      configSummary: "N1_PG_PROVIDER=test but N1_PG_TEST_ONLY!=true → no_live_pg",
    };
  }
  // 실제 PG 명칭이 config에 있어도 어댑터가 없으면 연결됐다고 말하지 않는다
  return {
    provider: noLivePgProvider,
    livePgAvailable: false,
    savedMethodsAvailable: false,
    configSummary: `N1_PG_PROVIDER=${configured} → adapter not implemented → no_live_pg`,
  };
}
