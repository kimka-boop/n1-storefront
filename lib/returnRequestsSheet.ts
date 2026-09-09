/**
 * N°1 Return_Requests 시트 접근 — Session I
 *
 * 반품·교환 "요청 접수" 원장. app 소유 시트다 — Orders 시트(HERMES authority)와
 * 분리되어 있으며, 이 모듈은 Orders 시트에 어떤 쓰기도 하지 않는다.
 * 생성 패턴은 Customers 시트(lib/sheets getCustomersSheet)와 동일: 없으면 최소 구조로 생성.
 */
import { GoogleSpreadsheet } from "google-spreadsheet";
import {
  RETURN_REQUESTS_SHEET,
  RETURN_REQUEST_HEADERS,
} from "@/lib/returnRequest";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** Return_Requests 시트 — 없으면 헤더와 함께 생성 (Customers 패턴) */
export async function getReturnRequestsSheet(doc: GoogleSpreadsheet) {
  const existing = Object.values(doc.sheetsByTitle || {}).find(
    (s: { title?: string }) => s.title === RETURN_REQUESTS_SHEET,
  );
  if (existing) return existing;
  return await doc.addSheet({
    title: RETURN_REQUESTS_SHEET,
    headerValues: [...RETURN_REQUEST_HEADERS],
  });
}

/** 접수 기록 append — 실패는 false (호출자가 정직하게 500 안내. 접수 없이 성공으로 꾸미지 않는다) */
export async function appendReturnRequestRow(
  doc: GoogleSpreadsheet,
  row: Record<string, string>,
): Promise<boolean> {
  try {
    const sheet = await getReturnRequestsSheet(doc);
    await sheet.addRow(row);
    return true;
  } catch {
    return false;
  }
}

/** 주문번호로 접수 기록 조회 — 최신순 (요청 상태 화면용) */
export async function findReturnRequestsByOrder(
  doc: GoogleSpreadsheet,
  orderId: string,
): Promise<Record<string, string>[]> {
  try {
    const sheet = await getReturnRequestsSheet(doc);
    const rows = await sheet.getRows();
    return rows
      .map((r) => {
        const record: Record<string, string> = {};
        for (const key of Object.keys(sheet.headerValues || {})) record[key] = str(r.get(key));
        return record;
      })
      .filter((r) => r["주문번호"] === orderId)
      .sort((a, b) => (a["요청일시"] < b["요청일시"] ? 1 : -1));
  } catch {
    return [];
  }
}
