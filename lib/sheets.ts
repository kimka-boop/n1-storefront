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
  await doc.loadInfo();
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
  const rows = await sheet.getRows();
  const hit = rows.find((r) => str(r.get("주문번호")) === orderId);
  if (!hit) return null;
  const record: Record<string, string> = {};
  for (const key of Object.keys(sheet.headerValues || {})) record[key] = str(hit.get(key));
  return toOrderRecord(record);
}

// ── 멱등키 (Session C) — 주문 중복 생성 방지의 영구 계층 ──

/** 멱등키 컬럼이 있으면 보장한다(없으면 헤더 맨 뒤 append). 실패해도 주문을 막지 않는다. */
export async function ensureOrdersIdempotencyColumn(doc: GoogleSpreadsheet): Promise<boolean> {
  try {
    const sheet = await getOrdersSheet(doc);
    if (!sheet) return false;
    if ((sheet.headerValues || []).includes("멱등키")) return true;
    await sheet.setHeaderRow([...(sheet.headerValues || []), "멱등키"]);
    return true;
  } catch {
    return false; // 컬럼 확보 실패 → 메모리 계층만으로 운영 (호출자가 이어서 진행)
  }
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
  const rows = await sheet.getRows();
  const hit = rows.find((r) => str(r.get("멱등키")) === clean);
  if (!hit) return null;
  const record: Record<string, string> = {};
  for (const key2 of Object.keys(sheet.headerValues || {})) record[key2] = str(hit.get(key2));
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
  const rows = await sheet.getRows();
  return rows
    .map((r) => {
      const record: Record<string, string> = {};
      for (const key of Object.keys(sheet.headerValues || {})) record[key] = str(r.get(key));
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
  const rows = await sheet.getRows();
  const mail = (email || "").trim().toLowerCase();
  if (!mail) return [];
  return rows
    .map((r) => {
      const record: Record<string, string> = {};
      for (const key of Object.keys(sheet.headerValues || {})) record[key] = str(r.get(key));
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
