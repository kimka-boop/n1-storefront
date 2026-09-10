/**
 * N°1 Sheets access — /api/orders · /api/chat(CS 조회) 공용 계층
 *
 * 계약 (미션 §14–§16):
 * - Orders 시트는 기존 구조 그대로 재사용 + 읽기 조회 함수만 추가
 * - Customers 시트는 없으면 최소 구조로 생성 (customer_id / 유형 / 연락 최소 필드)
 * - 없는 값을 만들지 않는다 — 조회 실패는 "not_found" 또는 throw 로 정직하게 반환
 */
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";

export const ORDERS_SHEET = "Orders";
export const CUSTOMERS_SHEET = "Customers";

export const CUSTOMER_HEADERS = [
  "customer_id",
  "유형", // MEMBER | GUEST
  "account_email", // 회원: 로그인 이메일 / 게스트: ""
  "이름",
  "연락처",
  "생성일",
  "수정일",
  "상태", // ACTIVE
];

export interface OrderRecord {
  orderId: string;
  orderTime: string;
  paymentMethod: string;
  paymentStatus: string;
  depositor: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerId: string;
  itemsJson: string;
  total: number;
  shipType: string;
  shipStatus: string;
  carrier: string;
  trackingNo: string;
  csMemo: string;
  raw: Record<string, string>;
}

export interface CustomerRecord {
  customerId: string;
  type: string;
  accountEmail: string;
  name: string;
  phone: string;
  status: string;
}

function loadSheetId(): string {
  if (process.env.N1_SHEET_ID) return process.env.N1_SHEET_ID;
  try {
    const envPath = path.join(process.cwd(), "..", ".env");
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      if (line.startsWith("N1_SHEET_ID=")) return line.split("=")[1].trim();
    }
  } catch {}
  return "";
}

// [SESSION L · TASK 29] 시트 조회 상한 — Google Sheets 무응답 시 라우트가 함께 매달려
// 클라이언트가 무한 로딩에 빠지는 것을 끊는다. 시간 초과는 즉시 실패로 전환되어
// 각 라우트의 502 fallback으로 나간다 (무한 spinner 금지).
const SHEET_TIMEOUT_MS = 12_000;

export async function getDoc(): Promise<GoogleSpreadsheet> {
  let email: string, key: string;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else {
    const credPath = path.join(process.cwd(), "..", "credentials.json");
    const cred = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    email = cred.client_email;
    key = cred.private_key;
  }
  const auth = new JWT({
    email, key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });
  const doc = new GoogleSpreadsheet(loadSheetId(), auth);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      doc.loadInfo(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sheets loadInfo timeout (${SHEET_TIMEOUT_MS}ms)`)), SHEET_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return doc;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function toOrderRecord(row: Record<string, string>): OrderRecord {
  return {
    orderId: str(row["주문번호"]),
    orderTime: str(row["주문일시"]),
    paymentMethod: str(row["결제수단"]),
    paymentStatus: str(row["결제상태"]),
    depositor: str(row["입금자명"]),
    customerName: str(row["고객명"]),
    customerPhone: str(row["연락처"]),
    customerAddress: str(row["배송지"]),
    customerId: str(row["고객ID"]),
    itemsJson: str(row["주문항목"]),
    total: Number(str(row["총결제금액"]).replace(/[^\d]/g, "")) || 0,
    shipType: str(row["배송유형"]),
    shipStatus: str(row["배송상태"]),
    carrier: str(row["택배사"]),
    trackingNo: str(row["송장번호"]),
    csMemo: str(row["CS메모"]),
    raw: row,
  };
}

export async function getOrdersSheet(doc: GoogleSpreadsheet) {
  try {
    return doc.sheetsByTitle[ORDERS_SHEET];
  } catch {
    return null;
  }
}

/** 주문번호로 조회 — 시트 오류는 throw (호출자가 조회 실패와 미존재를 구분) */
export async function findOrderById(doc: GoogleSpreadsheet, orderId: string): Promise<OrderRecord | null> {
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return null;
  await sheet.loadHeaderRow(); // v5 — headerValues 미로딩 시 빈 레코드가 된다 (실측 결함)
  const rows = await sheet.getRows();
  const hit = rows.find((r) => str(r.get("주문번호")) === orderId);
  if (!hit) return null;
  const record: Record<string, string> = {};
  for (const key of (sheet.headerValues || [])) record[key] = str(hit.get(key));
  return toOrderRecord(record);
}

// ── 멱등키 (Session C) — 주문 중복 생성 방지의 영구 계층 ──

/** 멱등키 컬럼이 있으면 보장한다(없으면 헤더 맨 뒤 append). 실패해도 주문을 막지 않는다. */
export async function ensureOrdersIdempotencyColumn(doc: GoogleSpreadsheet): Promise<boolean> {
  try {
    const sheet = await getOrdersSheet(doc);
    if (!sheet) return false;
    await sheet.loadHeaderRow(); // v5 계약 — loadHeaderRow 없이 headerValues는 undefined다 (ORD-0 근본 원인)
    const hvNow = sheet.headerValues || [];
    if (hvNow.includes("멱등키")) return true;
    if (sheet.columnCount < hvNow.length + 1) await sheet.resize({ columnCount: hvNow.length + 1, rowCount: sheet.rowCount });
    await sheet.setHeaderRow([...hvNow, "멱등키"]);
    return true;
  } catch {
    return false; // 컬럼 확보 실패 → 메모리 계층만으로 운영 (호출자가 이어서 진행)
  }
}

/**
 * 주문 Draft 확장 컬럼 보장 (Commerce Architecture Mission §6·§13 + Master Acceptance §15–§21)
 * — 전부 additive. 없는 컬럼만 뒤에 붙인다. 실패해도 주문을 막지 않는다(기존 컬럼만으로 인입).
 * - 우편번호/주소1/주소2/배송메모: 구조화 배송지. 기존 `배송지` 문자열도 병기(운영자 흐름 보존).
 * - 상품금액/배송비/할인: 최종 결제대금(총결제금액)의 근거 분해 — Price Authority 가계 산출.
 * - 고객유형/테스트구분: 주문 고객 정체성(MEMBER/GUEST)·TEST 격리 마커 (미션 §14·§15).
 * - 공급사주문번호/공급사발주시각/출고시각/배송중시각/도착시각/최종배송확인시각:
 *   HERMES Shipping Watcher 기록 필드 (미션 §21 — 첫 타임스탬프 보존).
 * - 배송이메일발송시각/배송이메일상태: 배송시작 이메일 멱등 마커 (미션 §24).
 */
export const ORDER_EXTRA_COLUMNS = [
  "우편번호", "주소1", "주소2", "배송메모", "상품금액", "배송비", "할인",
  "고객유형", "테스트구분", "고객이메일",
  "공급사주문번호", "공급사발주시각", "출고시각", "배송중시각", "도착시각", "최종배송확인시각",
  "배송이메일발송시각", "배송이메일상태",
  "주문확인이메일발송시각", "주문확인이메일상태",
  "취소이메일발송시각", "취소이메일상태",
  "환불이메일발송시각", "환불이메일상태",
] as const;

export async function ensureOrdersExtraColumns(doc: GoogleSpreadsheet): Promise<boolean> {
  try {
    const sheet = await getOrdersSheet(doc);
    if (!sheet) return false;
    await sheet.loadHeaderRow(); // v5 계약 — loadHeaderRow 없이 headerValues는 undefined다 (ORD-0 근본 원인)
    const headers = sheet.headerValues || [];
    const missing = ORDER_EXTRA_COLUMNS.filter((c) => !headers.includes(c));
    if (missing.length === 0) return true;
    // 그리드 열 수 확장 — 시트 그리드가 헤더 수보다 작으면 setHeaderRow가 실패한다 (실측 ORD-0)
    const needCols = headers.length + missing.length;
    if (sheet.columnCount < needCols) await sheet.resize({ columnCount: needCols, rowCount: sheet.rowCount });
    await sheet.setHeaderRow([...headers, ...missing]);
    return true;
  } catch {
    return false;
  }
}


/**
 * 우편번호 셀 TEXT 형식 고정 — row.save()가 행 전체를 USER_ENTERED로 재기록하기
 * 때문에 셀 형식이 일반(자동)이면 텍스트 "06236"이 재파싱되어 6236이 된다 (실측 결함).
 * 주문 write 직후 1회 호출. 실패해도 주문 흐름을 막지 않는다(호출자 catch).
 */
export async function ensurePostalCellTextFormat(
  sheet: NonNullable<Awaited<ReturnType<typeof getOrdersSheet>>>,
  rowNumber: number,
): Promise<void> {
  await sheet.loadHeaderRow();
  const colIdx = (sheet.headerValues || []).indexOf("우편번호");
  if (colIdx < 0) return;
  // 부분 loadCells는 셀 객체를 안정적으로 제공하지 않아(실측) raw repeatCell 요청으로 형식을 고정한다
  await sheet._makeSingleUpdateRequest("repeatCell", {
    range: {
      sheetId: sheet.sheetId,
      startRowIndex: rowNumber - 1,
      endRowIndex: rowNumber,
      startColumnIndex: colIdx,
      endColumnIndex: colIdx + 1,
    },
    cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
    fields: "userEnteredFormat.numberFormat",
  });
}


// ── ORD-0 수리 (Master Acceptance §15 / P0) ──────────────────────────────────
// Master DB Orders 탭이 구 영문 스키마(order_id, customer_name…)로 남아 있으면
// 한국어 계약 키 addRow가 전부 유실된다(모든 셀 공란). 앱은 시트에 쓰기 전
// 코어 계약 헤더를 보장한다: (1) 한국어 코어 헤더 부재 시 (2) 기존 탭 전체를
// 백업 탭으로 보존한 뒤 (3) 매핑 가능한 영문 헤더를 같은 열 위치에서 한국어로
// 개명한다(행 데이터 이동 없음 — 레거시 값이 계약 키로 즉시 읽힌다).

const ORDERS_CORE_CONTRACT = [
  "주문번호", "주문일시", "결제수단", "결제상태", "입금자명", "고객ID", "고객명",
  "연락처", "배송지", "주문항목", "총결제금액", "배송유형", "배송상태",
  "택배사", "송장번호", "CS메모",
] as const;

/** 구 영문 헤더 → 한국어 계약 헤더 (같은 열 개명 매핑) */
const LEGACY_HEADER_MAP: Record<string, string> = {
  order_id: "주문번호",
  order_no: "주문번호",
  order_number: "주문번호",
  order_date: "주문일시",
  created_at: "주문일시",
  payment_method: "결제수단",
  payment_status: "결제상태",
  depositor: "입금자명",
  customer_id: "고객ID",
  customer_name: "고객명",
  customer_phone: "연락처",
  phone: "연락처",
  address: "배송지",
  shipping_address: "배송지",
  customer_email: "고객이메일",
  email: "고객이메일",
  order_source: "주문출처",
  items: "주문항목",
  order_items: "주문항목",
  subtotal: "상품금액",
  shipping_fee: "배송비",
  discount: "할인",
  amount: "총결제금액",
  total: "총결제금액",
  total_amount: "총결제금액",
  shipping_type: "배송유형",
  split_shipment: "배송유형",
  shipping_group: "출고그룹",
  shipping_status: "배송상태",
  carrier: "택배사",
  tracking_no: "송장번호",
  tracking_number: "송장번호",
  cs_memo: "CS메모",
  memo: "CS메모",
  notification: "알림발송",
};

let ordersCoreChecked = false; // 프로세스당 1회 검사 (시트 로드 비용 절감 — 실패 시 재시도)

export async function ensureOrdersCoreContract(doc: GoogleSpreadsheet): Promise<boolean> {
  try {
    const sheet = await getOrdersSheet(doc);
    if (!sheet) return false;
    await sheet.loadHeaderRow(); // v5 계약 — loadHeaderRow 없이 headerValues는 undefined다 (ORD-0 근본 원인)
    const headers = sheet.headerValues || [];
    if (headers.length === 0) return false;
    const missing = ORDERS_CORE_CONTRACT.filter((c) => !headers.includes(c));
    if (missing.length === 0) {
      ordersCoreChecked = true;
      return true;
    }
    // 코어 한국어 헤더 결손 — 구 영문 스키마로 추정. 백업 후 개명 마이그레이션.
    const backupTitle = `백업_ORDERS_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    try {
      if (!doc.sheetsByTitle[backupTitle]) {
        const rows = await sheet.getRows();
        const sourceHeaders = headers;
        const backup = await doc.addSheet({ title: backupTitle, headerValues: sourceHeaders });
        if (rows.length) {
          await backup.addRows(
            rows.map((r) => {
              const rec: Record<string, string> = {};
              for (const h of sourceHeaders) rec[h] = String(r.get(h) ?? "");
              return rec;
            })
          );
        }
      }
    } catch {
      // 백업 실패 시에도 개명은 행 데이터를 이동시키지 않으므로 계속한다(원본 행 보존).
    }
    // 개명은 충돌 인식: 매핑 대상 한국어 헤더가 이미 다른 열에 존재하면 그 열은
    // 원래 이름을 유지한다 (Google Sheets는 중복 헤더를 거절한다 — 실측 ORD-0).
    const targetSet = new Set<string>();
    for (const h of headers) {
      const key = h.trim().toLowerCase();
      targetSet.add(LEGACY_HEADER_MAP[key] || h);
    }
    const renamed = headers.map((h) => {
      const key = h.trim().toLowerCase();
      const mapped = LEGACY_HEADER_MAP[key];
      if (!mapped) return h;
      // 자기 자신 외에 같은 이름의 열이 이미 있으면 개명 스킵
      const others = headers.filter((x) => x !== h);
      if (others.includes(mapped)) return h;
      // 이번 배치에서 다른 열이 같은 매핑으로 이미 개명됐으면 중복 — 스킵
      if (targetSet.has(mapped) && others.some((x) => (LEGACY_HEADER_MAP[x.trim().toLowerCase()] || x) === mapped)) return h;
      targetSet.delete(mapped);
      return mapped;
    });
    // 개명 후에도 코어가 비면(매핑 불가 스키마) 임의로 헤더를 재구성하지 않는다 —
    // 데이터 파괴 위험. 미매핑 결손은 운영 보고 사항으로 남긴다.
    // 개명 후에도 빠진 코어 컬럼은 새 열로 가산한다 (레거시 스키마에 대응열이 없는 경우)
    const stillMissing = ORDERS_CORE_CONTRACT.filter((c) => !renamed.includes(c));
    let finalHeaders = renamed;
    if (stillMissing.length > 0) {
      finalHeaders = [...renamed, ...stillMissing];
      const needCols2 = finalHeaders.length;
      if (sheet.columnCount < needCols2) await sheet.resize({ columnCount: needCols2, rowCount: sheet.rowCount });
    }
    await sheet.setHeaderRow(finalHeaders);
    ordersCoreChecked = true;
    console.warn(
      "[sheets] Orders 코어 헤더 마이그레이션 완료 — 신규 가산 코어:",
      stillMissing.join(", ") || "없음",
    );
    return true;
  } catch (e) {
    console.warn("[sheets] Orders 코어 계약 보장 실패 — 기존 헤더로 계속:", (e as Error).message);
    return false;
  }
}

/** 주문 쓰기·읽기 진입점 공용: 코어 계약 + 확장 컬럼을 한 번에 보장 */
export async function ensureOrdersContract(doc: GoogleSpreadsheet): Promise<void> {
  if (!ordersCoreChecked) await ensureOrdersCoreContract(doc);
  await ensureOrdersExtraColumns(doc);
  await ensureOrdersIdempotencyColumn(doc);
}

/** 멱등키로 기존 주문 조회 — 있으면 중복 생성 없이 원본 응답 replay 의 근거가 된다 */
export async function findOrderByIdempotencyKey(
  doc: GoogleSpreadsheet,
  key: string,
): Promise<OrderRecord | null> {
  const clean = str(key);
  if (!clean) return null;
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return null;
  await sheet.loadHeaderRow(); // v5 — headerValues 미로딩 시 빈 레코드가 된다 (실측 결함)
  const rows = await sheet.getRows();
  const hit = rows.find((r) => str(r.get("멱등키")) === clean);
  if (!hit) return null;
  const record: Record<string, string> = {};
  for (const key2 of (sheet.headerValues || [])) record[key2] = str(hit.get(key2));
  return toOrderRecord(record);
}

/** 회원 주문내역 — 본인 이메일 일치 주문 전수(최신순). limit 기본 50 (CS 용도의 5와 분리) */
export async function findOrdersByMemberEmail(
  doc: GoogleSpreadsheet,
  email: string,
  limit = 50,
): Promise<OrderRecord[]> {
  return findOrdersByCustomerEmail(doc, email, limit);
}

/** 전화번호 뒷자리로 후보 주문 조회 (CS 검증용 — 최신순) */
export async function findOrdersByPhoneLast4(
  doc: GoogleSpreadsheet,
  last4: string,
  limit = 5,
): Promise<OrderRecord[]> {
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return [];
  await sheet.loadHeaderRow(); // v5 — headerValues 미로딩 시 빈 레코드가 된다 (실측 결함)
  const rows = await sheet.getRows();
  return rows
    .map((r) => {
      const record: Record<string, string> = {};
      for (const key of (sheet.headerValues || [])) record[key] = str(r.get(key));
      return toOrderRecord(record);
    })
    .filter((o) => o.customerPhone.replace(/[^\d]/g, "").endsWith(last4))
    .sort((a, b) => (a.orderTime < b.orderTime ? 1 : -1))
    .slice(0, limit);
}

/** 회원 이메일로 주문 조회 (CS 회원 주문 조회 — 최신순) */
export async function findOrdersByCustomerEmail(
  doc: GoogleSpreadsheet,
  email: string,
  limit = 5,
): Promise<OrderRecord[]> {
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return [];
  await sheet.loadHeaderRow(); // v5 — headerValues 미로딩 시 빈 레코드가 된다 (실측 결함)
  const rows = await sheet.getRows();
  const mail = (email || "").trim().toLowerCase();
  if (!mail) return [];
  return rows
    .map((r) => {
      const record: Record<string, string> = {};
      for (const key of (sheet.headerValues || [])) record[key] = str(r.get(key));
      return toOrderRecord(record);
    })
    .filter((o) => str(o.raw["고객이메일"]).toLowerCase() === mail)
    .sort((a, b) => (a.orderTime < b.orderTime ? 1 : -1))
    .slice(0, limit);
}

export async function getCustomersSheet(doc: GoogleSpreadsheet) {
  const existing = Object.values(doc.sheetsByTitle || {}).find((s: any) => s.title === CUSTOMERS_SHEET);
  if (existing) return existing as any;
  return await doc.addSheet({ title: CUSTOMERS_SHEET, headerValues: CUSTOMER_HEADERS });
}

function genCustomerId(type: "MEMBER" | "GUEST"): string {
  const prefix = type === "MEMBER" ? "C" : "G";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * 주문 인입 시 고객 레코드 upsert.
 * - 회원: account_email 키로 재사용 (동일 회원 주문은 하나의 customer_id)
 * - 게스트: 연락처 키로 재사용, 없으면 신규 guest_id
 * 실패해도 주문 인입을 막지 않는다 (customer_id는 ""로 기록).
 */
export async function upsertCustomer(
  doc: GoogleSpreadsheet,
  input: { name: string; phone: string; email?: string; type: "MEMBER" | "GUEST" },
): Promise<{ customerId: string; created: boolean }> {
  try {
    const sheet = await getCustomersSheet(doc);
    const rows = await sheet.getRows();
    const email = (input.email || "").trim().toLowerCase();
    const hit = rows.find((r: any) =>
      email ? str(r.get("account_email")) === email
        : input.phone ? str(r.get("연락처")) === input.phone : false,
    );
    const now = new Date().toISOString();
    if (hit) {
      const existingType = str(hit.get("유형"));
      // 게스트로 주문했다가 회원 이메일이 확인되면 유형만 승격 — 원본 주문 history는 유지
      if (input.type === "MEMBER" && existingType !== "MEMBER") {
        hit.set("유형", "MEMBER");
        hit.set("account_email", email);
      }
      hit.set("이름", input.name || str(hit.get("이름")));
      hit.set("연락처", input.phone || str(hit.get("연락처")));
      hit.set("수정일", now);
      await hit.save();
      return { customerId: str(hit.get("customer_id")), created: false };
    }
    const customerId = genCustomerId(input.type);
    await sheet.addRow({
      customer_id: customerId,
      "유형": input.type,
      account_email: email,
      "이름": input.name,
      "연락처": input.phone,
      "생성일": now,
      "수정일": now,
      "상태": "ACTIVE",
    });
    return { customerId, created: true };
  } catch {
    return { customerId: "", created: false };
  }
}

export async function findCustomerById(doc: GoogleSpreadsheet, customerId: string): Promise<CustomerRecord | null> {
  try {
    const sheet = await getCustomersSheet(doc);
    const rows = await sheet.getRows();
    const hit = rows.find((r: any) => str(r.get("customer_id")) === customerId);
    if (!hit) return null;
    return {
      customerId,
      type: str(hit.get("유형")),
      accountEmail: str(hit.get("account_email")),
      name: str(hit.get("이름")),
      phone: str(hit.get("연락처")),
      status: str(hit.get("상태")),
    };
  } catch {
    return null;
  }
}
