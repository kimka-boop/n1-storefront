/**
 * N°1 Stock 소스 계층 — 공급처(도매꾹) 결정적 프로브 정의 + 파서 (미션 §2·§5)
 *
 * 문서 근거 (도매꾹 OpenAPI 공개 문서, 2026-09-09 확인):
 * - getItemView ver=4.6 : 상품 1건 상세 — basis.status(판매중/기간종료/판매종료),
 *   qty.inventory(재고수량 — 상품 단위 숫자, TYPE A 근거), selectOpt(주문옵션 JSON, 별첨 docx 참조),
 *   price.dome. multiple로 최대 100건 다중 조회 가능.
 * - getItemList ver=4.1 : 판매중 상품 목록만 반환(판매중지·판매종료 제외) → 존재=판매중 신호(TYPE B).
 * - getAllSupplyChk ver=1.1 : 품절/재입고/옵션품절(OPTSOLDOUT) 이벤트 목록 — 회원 id+sId(로그인 세션)
 *   필수라 바이어 계정 적용 가능성 미검증 → 기본 비활성(HERMES 검증 후 활성화).
 *
 * 보안 계약 (Mimosa + 기존 어댑터 계승):
 * - https 고정 + 허용 호스트(www.domeggook.com)만. localhost/loopback/사설/예약 주소 거부.
 * - 동일 호스트 외 리다이렉트 미추종. API 키는 코드에 존재하지 않는다(env 주입 = HERMES 관할).
 */
import { OptionStockEntry, ProbeFact } from "./types";
import { classifyType, deriveStatus, normalizeStatus } from "./normalize";

export const SUPPLIER_NAME = "도매꾹";
export const DOME_GG_HOST = "www.domeggook.com";
export const DOME_GG_API_PATH = "/ssl/api/";

/** 리다이렉트 허용 호스트 — same-site만 */
export const REDIRECT_OK_HOSTS = new Set(["domeggook.com", "www.domeggook.com"]);

/** 사설/예약 주소 차단 (호스트 문자열 기준 — SSRF 가드) */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /^metadata\./i,
];

export function isBlockedHost(hostname: string): boolean {
  const h = (hostname || "").toLowerCase();
  if (!h) return true;
  if (REDIRECT_OK_HOSTS.has(h)) return false;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(h))) return true;
  // 허용 목록 밖의 호스트는 원칙 차단 (허용 호스트만 통과)
  return !REDIRECT_OK_HOSTS.has(h);
}

/** 소스 URL 검증+정규화 — http+베어도메인 → https+www (기존 enrich 어댑터와 동일 규칙) */
export function normalizeSupplierUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw || "");
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (isBlockedHost(host)) return null;
  if (!REDIRECT_OK_HOSTS.has(host)) return null;
  const path = u.pathname.match(/\/(\d+)\/?$/);
  if (!path) return null;
  return `https://${DOME_GG_HOST}/${path[1]}`;
}

/** 공개 API 요청 URL 구성 — aid는 실행 환경에서 주입(문자열), URL은 고정 호스트로만 조립 */
export function buildApiUrl(mode: string, ver: string, params: Record<string, string>, aid: string): string {
  const qs = new URLSearchParams({ ver, mode, aid, om: "json", ...params });
  const url = `https://${DOME_GG_HOST}${DOME_GG_API_PATH}?${qs.toString()}`;
  if (!url.startsWith(`https://${DOME_GG_HOST}${DOME_GG_API_PATH}`)) {
    throw new Error("host guard: URL이 허용 호스트를 벗어남");
  }
  return url;
}

/** polite probing — 표준 UA, bypass 기법 일체 없음 (미션 §6 anti-bot bypass 금지) */
export const PROBE_UA = "Mozilla/5.0 (compatible; N1StockWatcher/1.0)";

/* ────────────────────────────────────────────────────────────
 * 파서 — 문서에 확인된 필드만 읽는다. 모르는 구조는 실패로 보고한다.
 * ──────────────────────────────────────────────────────────── */

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** selectOpt 검증 파서 — 현재는 "검증된 구조"가 없다(별첨 docx 미확인).
 *  null = 구조 미검증(옵션 모호성). HERMES가 실제 페이로드와 docx로 스키마 확정하면 이 함수만 교체. */
export function parseSelectOpt(selectOpt: unknown): OptionStockEntry[] | null {
  if (selectOpt === null || selectOpt === undefined || selectOpt === "") return [];
  // 검증된 행 구조 없음 — 임의 필드명에서 수량을 추정하는 것은 창작이므로 하지 않는다.
  return null;
}

/**
 * getItemView 응답 → 확정 사실. 문서 그룹(basis/qty/price)이 어긋나면 parserFailure.
 * 상품 단위 숫자(qty.inventory)가 확인되면 factType=A, 상태만 확인되면 B.
 */
export function parseGetItemView(json: unknown, requestedAt: string): ProbeFact | null {
  if (typeof json !== "object" || json === null) {
    return {
      supplierProductId: "",
      requestedAt,
      source: SOURCE_ITEM_VIEW,
      parserFailure: "응답이 JSON 객체가 아님",
      factType: "UNKNOWN",
    };
  }
  const root = json as Record<string, unknown>;
  const item = (root["domeggook"] as Record<string, unknown> | undefined)?.["item"];
  const itemObj = (Array.isArray(item) ? item[0] : item) as Record<string, unknown> | undefined;
  if (!itemObj || typeof itemObj !== "object") {
    return {
      supplierProductId: "",
      requestedAt,
      source: SOURCE_ITEM_VIEW,
      parserFailure: "domeggook.item 그룹 부재 (LAYOUT_CHANGE 가능)",
      factType: "UNKNOWN",
    };
  }
  const no = asInt(itemObj["no"]);
  const basis = itemObj["basis"] as Record<string, unknown> | undefined;
  const qty = itemObj["qty"] as Record<string, unknown> | undefined;
  const price = itemObj["price"] as Record<string, unknown> | undefined;
  if (!basis || !qty) {
    return {
      supplierProductId: String(no ?? ""),
      requestedAt,
      source: SOURCE_ITEM_VIEW,
      parserFailure: "basis/qty 그룹 부재 (문서 v4.6 계약 불일치)",
      factType: "UNKNOWN",
    };
  }
  const rawStatus = typeof basis["status"] === "string" ? basis["status"] : "";
  const inventoryQty = qty["inventory"] === undefined ? undefined : asInt(qty["inventory"]);
  const optionRows = parseSelectOpt(itemObj["selectOpt"]);
  const fact: ProbeFact = {
    supplierProductId: String(no ?? ""),
    requestedAt,
    source: SOURCE_ITEM_VIEW,
    rawStatus: rawStatus || undefined,
    inventoryQty: inventoryQty === undefined ? null : inventoryQty,
    priceVerified: price ? asInt(price["dome"]) : null,
    optionAmbiguity: optionRows === null,
    optionRows: optionRows ?? undefined,
    factType: classifyType({
      hasNumericQuantity: typeof inventoryQty === "number",
      hasVerifiedOptionQuantity: Array.isArray(optionRows) && optionRows.some((r) => r.quantity !== null),
      hasStatusOrPresence: Boolean(rawStatus),
      hasOptionAmbiguity: optionRows === null,
    }),
  };
  return fact;
}

/**
 * getItemList 목록에서 특정 상품번호 존재 확인 — 존재=판매중(TYPE B).
 * 부재는 "품절"이 아니라 "미확인"이다: 키워드 검색 특성상 목록에서 빠질 다른 이유가 있다.
 */
export function parseListPresence(json: unknown, targetNo: string, requestedAt: string): ProbeFact | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const list = (root["domeggook"] as Record<string, unknown> | undefined)?.["list"] as
    | Record<string, unknown>
    | undefined;
  const items = (list?.["item"] as unknown[] | undefined) ?? [];
  const hit = items.some((it) => asInt((it as Record<string, unknown>)?.["no"]) === Number(targetNo));
  return {
    supplierProductId: targetNo,
    requestedAt,
    source: SOURCE_LIST_PRESENCE,
    rawStatus: hit ? "판매중" : undefined,
    factType: hit ? "B" : "UNKNOWN",
  };
}

/**
 * getAllSupplyChk 이벤트 → 옵션 품절 플래그 (TYPE B — 숫자 창작 금지).
 * status 값: SOLDOUT/OPEN/RESTART/CLOSE/OPTSOLDOUT/OPTRESTART/OPTAMT/AMT/DEL
 */
export function parseSupplyChkEvents(
  json: unknown,
  targetNo: string,
  requestedAt: string,
): { events: Array<{ no: string; status: string; date: string }>; fact: ProbeFact } | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const container = root["domeggook"] as Record<string, unknown> | undefined;
  const items = (container?.["items"] as Record<string, unknown> | undefined)?.["item"] ?? [];
  const arr = Array.isArray(items) ? items : [items];
  const events = arr
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
    .filter((it) => String(it["no"] ?? "") === targetNo)
    .map((it) => ({ no: String(it["no"] ?? ""), status: String(it["status"] ?? ""), date: String(it["date"] ?? "") }));
  const optionUnavailable = events.some((e) => e.status.includes("OPTSOLDOUT"));
  const productSoldout = events.some((e) => e.status === "SOLDOUT" || e.status === "CLOSE");
  const fact: ProbeFact = {
    supplierProductId: targetNo,
    requestedAt,
    source: SOURCE_SUPPLY_CHK,
    rawStatus: productSoldout ? "판매종료" : undefined,
    factType: events.length ? "B" : "UNKNOWN",
  };
  return { events, fact: { ...fact, inventoryQty: null, optionAmbiguity: optionUnavailable } };
}

/* ────────────────────────────────────────────────────────────
 * 프로브 소스 식별자 — 재고소스(재고소스 컬럼)·계약에 사용
 * ──────────────────────────────────────────────────────────── */
export const SOURCE_ITEM_VIEW = "domeggook.getItemView.4.6";
export const SOURCE_LIST_PRESENCE = "domeggook.getItemList.4.1";
export const SOURCE_SUPPLY_CHK = "domeggook.getAllSupplyChk.1.1";

/** ProbeFact → StockRecord 사상 (확정 사실만, 창작 없음) */
export function factToStockRecord(
  fact: ProbeFact,
  catalog: { productId: string; supplierName: string; supplierUrl: string },
): { record: import("./types").StockRecord | null; escalations: import("./types").StockEscalation[] } {
  const escalations: import("./types").StockEscalation[] = [];
  if (fact.parserFailure) {
    return {
      record: null,
      escalations: [
        {
          reason: fact.parserFailure.includes("그룹 부재") ? "LAYOUT_CHANGE" : "PARSER_FAILURE",
          productId: catalog.productId,
          supplierProductId: fact.supplierProductId || catalog.supplierUrl,
          detail: fact.parserFailure,
          raisedAt: new Date().toISOString(),
        },
      ],
    };
  }
  const status0 = normalizeStatus(fact.rawStatus);
  const { status, note } = deriveStatus(status0, fact.inventoryQty ?? null);
  const notes: string[] = [];
  if (note) notes.push(note);
  let optionStock: OptionStockEntry[] = fact.optionRows ?? [];
  if (fact.optionAmbiguity) {
    notes.push("selectOpt 구조 미검증 — 옵션별 수량 미해석 (별첨 docx 검증 필요)");
    escalations.push({
      reason: "OPTION_AMBIGUITY",
      productId: catalog.productId,
      supplierProductId: fact.supplierProductId,
      detail: "getItemView.selectOpt 존재하나 검증된 스키마 없음 — 옵션 수량 추정 금지",
      raisedAt: new Date().toISOString(),
    });
    // 모호성 상태에서는 옵션 행을 비우지 않고 rawLabel만 유지한 미확인 항목으로 둔다 — 수량/판정은 null
    optionStock = (fact.optionRows ?? []).map((e) => ({ ...e, quantity: null, available: null }));
  }
  const confidence: import("./types").StockConfidence =
    fact.factType === "A" ? "HIGH" : fact.factType === "B" ? "MEDIUM" : "LOW";
  return {
    record: {
      productId: catalog.productId,
      supplierName: catalog.supplierName,
      supplierProductId: fact.supplierProductId,
      supplierUrl: catalog.supplierUrl,
      stockStatus: status,
      stockQuantity: fact.inventoryQty ?? null,
      stockType: fact.factType,
      stockVerifiedAt: fact.requestedAt || new Date().toISOString(),
      stockSource: fact.source,
      stockConfidence: confidence,
      optionStock,
      probeId: fact.requestedAt,
      notes,
    },
    escalations,
  };
}
