/**
 * N°1 Payment E2E — 격리 시트 기반 전체 플로우 검증 (Commerce Architecture Mission)
 *
 * 운영 Master DB에는 절대 쓰지 않는다. 서비스 계정이 **새 시트 문서**를 만들고(계정 자기 소유),
 * 그 문서를 N1_SHEET_ID로 두는 테스트 인스턴스에서 주문↔결제 전체 플로우를 돌린다.
 *
 * 사용법:
 *   1) node ops/payment_e2e.cjs setup
 *      → 테스트 문서 생성, SHEET_ID 출력
 *   2) 테스트 인스턴스 기동 (운영 인스턴스와 포트 분리):
 *      N1_SHEET_ID=<SHEET_ID> N1_PG_PROVIDER=test N1_PG_TEST_ONLY=true \
 *        npx next start -p 3445
 *   3) node ops/payment_e2e.cjs verify http://localhost:3445 <SHEET_ID>
 *      → ①무통장 draft ②pg_card 결제 요청→정산→webhook 검증→주문 확정
 *        ③시트 반영(Orders/Payments/HERMES_Events/Stock_Staging) ④부정 경로
 *
 * 종료 코드 0 = 전체 통과. 하나라도 실패하면 즉시 1.
 */
const { JWT } = require("google-auth-library");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("node:fs");
const path = require("node:path");

// next start 는 .env.local 을 자동 주입하지만, 이 스크립트는 단독 node 프로세스다 —
// 같은 파일을 같은 우선순위(기존 env 유지)로 읽는다. 값은 출력하지 않는다.
// dotenv 규약: KEY="..." quoted 값은 개행을 포함할 수 있다(멀티라인) — GOOGLE_PRIVATE_KEY가 그렇다.
(function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : null;
    if (quote) {
      value = value.slice(1);
      if (value.endsWith(quote)) {
        value = value.slice(0, -1);
      } else {
        // 멀티라인 quoted — 닫는 따옴표가 나올 때까지 행을 이어 붙인다
        const buf = [value];
        while (++i < lines.length) {
          buf.push(lines[i]);
          if (lines[i].trimEnd().endsWith(quote)) break;
        }
        value = buf.join("\n");
        if (value.endsWith(quote)) value = value.slice(0, -1);
      }
    }
    value = value.replace(/\\n/g, "\n");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
})();

const ORDER_HEADERS = [
  "주문번호", "주문일시", "결제수단", "결제상태", "입금자명", "PG거래ID", "고객ID", "고객명",
  "연락처", "배송지", "우편번호", "주소1", "주소2", "배송메모", "고객이메일", "주문출처",
  "주문항목", "상품금액", "배송비", "할인", "총결제금액", "배송유형", "출고그룹", "알림발송",
  "배송상태", "택배사", "송장번호", "CS메모", "멱등키",
];

const STAGING_HEADERS = [
  "상품ID", "공급사명", "공급사코드", "공급사URL", "재고상태", "재고수량", "재고유형",
  "재고검증일시", "재고소스", "재고신뢰도", "옵션별재고", "옵션원본", "비고",
];

const PRODUCT = {
  sku: "PRD-E2E-01",
  price: 39800,
  color: "아이보리",
  size: "M",
  supplier: "E2E공급사",
};

function fail(label) {
  console.error(`  ✗ ${label}`);
  process.exit(1);
}
function ok(label) {
  console.log(`  ✓ ${label}`);
}

async function makeAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) {
    console.error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env 필요");
    process.exit(1);
  }
  return new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });
}

async function setup() {
  const auth = await makeAuth();
  const doc = await GoogleSpreadsheet.createNewSpreadsheetDocument(auth, {
    title: `N1_PAYMENT_E2E_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`,
  });

  // Products (기본 시트 재사용)
  const products = doc.sheetsByIndex[0];
  await products.setHeaderRow(["상품ID", "상품명", "공급사명", "공급사코드", "공급사URL", "판매가", "색상옵션", "사이즈옵션", "옵션별재고", "재고상태"]);
  await products.addRow({
    "상품ID": PRODUCT.sku,
    "상품명": "E2E 테스트 니트",
    "공급사명": PRODUCT.supplier,
    "공급사코드": "E2E-0001",
    "공급사URL": "https://www.domeggook.com/00000000",
    "판매가": String(PRODUCT.price),
    "색상옵션": PRODUCT.color,
    "사이즈옵션": PRODUCT.size,
    "옵션별재고": `${PRODUCT.color}_${PRODUCT.size}:10`,
    "재고상태": "판매가능",
  });

  await doc.addSheet({ title: "Orders", headerValues: ORDER_HEADERS });
  const staging = await doc.addSheet({ title: "Stock_Staging", headerValues: STAGING_HEADERS });
  await staging.addRow({
    "상품ID": PRODUCT.sku,
    "공급사명": PRODUCT.supplier,
    "공급사코드": "E2E-0001",
    "공급사URL": "https://www.domeggook.com/00000000",
    "재고상태": "판매가능",
    "재고수량": "10",
    "재고유형": "OPTION",
    "재고검증일시": new Date().toISOString(),
    "재고소스": "E2E_SETUP",
    "재고신뢰도": "HIGH",
    "옵션별재고": `${PRODUCT.color}_${PRODUCT.size}:10`,
    "옵션원본": "",
    "비고": "E2E setup",
  });

  console.log("SHEET_ID=" + doc.spreadsheetId);
  console.log("다음: N1_SHEET_ID=<SHEET_ID> N1_PG_PROVIDER=test N1_PG_TEST_ONLY=true npx next start -p 3445");
}

// ── verify ──

async function api(base, path, options) {
  const res = await fetch(base + path, options);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function readSheet(sheetId, title) {
  const auth = await makeAuth();
  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[title];
  const rows = await sheet.getRows();
  return rows.map((r) => {
    const out = {};
    for (const h of sheet.headerValues || []) out[h] = String(r.get(h) ?? "");
    return out;
  });
}

async function verify(base, sheetId) {
  const shippingFee = PRODUCT.price >= 50000 ? 0 : 3000;
  const payable = PRODUCT.price + shippingFee;
  const phone = "010-1111-2222";
  const structured = {
    name: "E2E홍",
    phone,
    postal_code: "06236",
    address1: "서울 강남구 테헤란로 123",
    address2: "101동 202호",
    delivery_memo: "문 앞에 놓아주세요",
  };

  // 0. health
  const health = await api(base, "/api/health");
  assert(health.json && health.json.ok === true, "health ok");

  // 1. 무통장 주문 draft — 구조화 주소 + 서버 최종 결제대금
  const bank = await api(base, "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer: { ...structured, depositor: "E2E홍" },
      items: [{ sku: PRODUCT.sku, color: PRODUCT.color, size: PRODUCT.size, qty: 1 }],
      source: "cart",
      idempotency_key: `e2e-bank-${Date.now()}`,
    }),
  });
  assert(bank.json && bank.json.ok === true, "무통장 주문 생성 ok");
  const bankOrderId = bank.json.order_id;
  assert(String(bankOrderId).startsWith("TEST-"), "테스트 인스턴스 주문번호 TEST- 네임스페이스");
  assert(bank.json.payable_amount === payable, `서버 최종 결제대금 = 상품금+배송비 (${payable})`);
  assert(bank.json.deposit_info && bank.json.deposit_info.amount === payable, "입금 안내 금액 = 최종 결제대금");
  assert(bank.json.status === "PAYMENT_PENDING", "주문 초기 상태 PAYMENT_PENDING");

  const bankRows = await readSheet(sheetId, "Orders");
  const bankRow = bankRows.find((r) => r["주문번호"] === bankOrderId);
  assert(bankRow && bankRow["결제상태"] === "입금대기", "Orders.결제상태 = 입금대기");
  assert(bankRow["우편번호"] === "06236" && bankRow["주소1"].includes("테헤란로") && bankRow["주소2"] === "101동 202호", "구조화 주소 컬럼 기록");
  assert(bankRow["배송메모"] === "문 앞에 놓아주세요", "배송메모 기록");
  assert(bankRow["상품금액"] === String(PRODUCT.price) && bankRow["배송비"] === String(shippingFee) && bankRow["총결제금액"] === String(payable), "금액 분해(상품금/배송비/총) 기록");

  // 무통장은 주문 생성 시점에 이미 차감됐다
  const stagingAfterBank = await readSheet(sheetId, "Stock_Staging");
  const bankStaging = stagingAfterBank.find((r) => r["상품ID"] === PRODUCT.sku);
  assert(String(bankStaging["비고"]).includes("주문 차감"), "무통장: 주문 생성 시 재고 차감 기록");

  // 2. 무통장 입금확인 요청 — 완료처리가 아니라 요청만 기록되는지
  const confirmReq = await api(base, "/api/orders/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: bankOrderId, name: "E2E홍" }),
  });
  assert(confirmReq.json && confirmReq.json.ok === true, "입금확인 요청 접수");
  const afterConfirm = (await readSheet(sheetId, "Orders")).find((r) => r["주문번호"] === bankOrderId);
  assert(afterConfirm["결제상태"] === "입금대기" && afterConfirm["CS메모"].includes("입금확인요청"), "확인 요청은 기록만 — 상태 완료처리 없음 (운영자 검증 계약)");

  // 3. PG 카드 주문 → 결제 요청 → 정산 → webhook 검증 → 주문 확정
  const pg = await api(base, "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer: { ...structured, depositor: "E2E홍" },
      items: [{ sku: PRODUCT.sku, color: PRODUCT.color, size: PRODUCT.size, qty: 1 }],
      source: "buynow",
      payment_method: "pg_card",
      idempotency_key: `e2e-pg-${Date.now()}`,
    }),
  });
  assert(pg.json && pg.json.ok === true, "pg_card 주문 draft 생성 ok");
  const pgOrderId = pg.json.order_id;
  assert(pg.json.payment && pg.json.payment.ok === true, "PG 결제 요청 성공");
  const ppid = String(pg.json.payment.checkout_url).match(/pid=([^&]+)/)[1];
  assert(!!ppid, "결제창 참조(provider_payment_id) 발급");

  const pgRow0 = (await readSheet(sheetId, "Orders")).find((r) => r["주문번호"] === pgOrderId);
  assert(pgRow0["결제상태"] === "결제대기", "PG 주문은 결제대기 — 아직 확정 아님");
  const stagingAfterPg = await readSheet(sheetId, "Stock_Staging");
  const pgStaging0 = stagingAfterPg.find((r) => r["상품ID"] === PRODUCT.sku);
  assert(!String(pgStaging0["비고"]).includes(pgOrderId), "PG 주문: 차감이 결제 검증 후로 이연됨");

  const payments0 = await readSheet(sheetId, "Payments");
  const pay0 = payments0.find((r) => r["주문번호"] === pgOrderId);
  assert(pay0 && pay0["status"] === "PENDING" && pay0["requested_amount"] === String(payable), "Payments 레코드 PENDING + 요청 금액=최종 결제대금");
  assert(pay0["test_flag"] === "TEST_ONLY", "테스트 결제 TEST_ONLY 플래그");

  // 4. 정산 발화 → webhook 파이프라인(서버 검증 → 확정)
  const settle = await api(base, "/api/payments/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_payment_id: ppid }),
  });
  assert(settle.json && settle.json.ok === true && settle.json.status === "CONFIRMED", "정산 후 서버 검증 CONFIRMED");

  // 5. 주문 확정 + 지연 차감 반영 확인
  const pgRow1 = (await readSheet(sheetId, "Orders")).find((r) => r["주문번호"] === pgOrderId);
  assert(pgRow1["결제상태"] === "결제완료", "주문 결제완료로 전이 (PAID는 검증 후에만)");
  assert(pgRow1["PG거래ID"] === ppid, "PG거래ID 기록");
  const stagingAfterSettle = (await readSheet(sheetId, "Stock_Staging")).find((r) => r["상품ID"] === PRODUCT.sku);
  assert(String(stagingAfterSettle["비고"]).includes(pgOrderId), "PG 주문 지연 차감 기록");
  assert(stagingAfterSettle["옵션별재고"].includes(`${PRODUCT.color}_${PRODUCT.size}:8`), `옵션별재고 10→8 (무통장 1 + PG 1)`);

  const pay1 = (await readSheet(sheetId, "Payments")).find((r) => r["주문번호"] === pgOrderId);
  assert(pay1["status"] === "CONFIRMED" && pay1["confirmed_amount"] === String(payable), "Payments CONFIRMED + 확정 금액");

  const events = await readSheet(sheetId, "HERMES_Events");
  const types = events.map((e) => e["event_type"]);
  for (const t of ["ORDER_DRAFTED", "PAYMENT_REQUESTED", "PAYMENT_CONFIRMED"]) {
    assert(types.includes(t), `HERMES_Events: ${t}`);
  }

  // 6. 결제 상태 조회
  const st = await api(base, `/api/payments/status?order_id=${encodeURIComponent(pgOrderId)}&phone=${encodeURIComponent(phone)}`);
  assert(st.json && st.json.ok === true && st.json.payment.status === "CONFIRMED", "결제 상태 조회 CONFIRMED");

  // 7. 부정 경로
  const reSettle = await api(base, "/api/payments/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_payment_id: ppid }),
  });
  assert(reSettle.status === 409, "이중 정산 거절 (409)");
  const dupHook = await api(base, "/api/payments/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_payment_id: ppid }),
  });
  assert(dupHook.json && dupHook.json.ok === true && dupHook.json.payload?.duplicate === true, "webhook 재도착 duplicate 정직 응답");
  const unknownHook = await api(base, "/api/payments/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_payment_id: "testpay_unknown" }),
  });
  assert(unknownHook.status === 404, "미지 거래 webhook 404");
  const bankPayReq = await api(base, "/api/payments/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: bankOrderId, phone }),
  });
  assert(bankPayReq.status === 400 && bankPayReq.json.code === "PAYMENT_REQUEST_NOT_APPLICABLE", "무통장 주문의 결제 요청 거절");

  const noship = await api(base, "/api/payments/status?order_id=TEST-20990101-00000&phone=010-0000-0000");
  assert(noship.status === 404, "소유 검증 실패 — generic 404 (존재 유출 없음)");

  console.log("\nE2E 전체 통과 ✅");
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "setup") return setup();
  if (cmd === "verify") {
    const base = process.argv[3];
    const sheetId = process.argv[4];
    if (!base || !sheetId) {
      console.error("사용법: node ops/payment_e2e.cjs verify <baseURL> <SHEET_ID>");
      process.exit(1);
    }
    return verify(base, sheetId);
  }
  console.error("사용법: node ops/payment_e2e.cjs setup | verify <baseURL> <SHEET_ID>");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(process.exitCode || 1);
});
