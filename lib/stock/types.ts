/**
 * N°1 Stock Truth Backend — 타입 계약 (SESSION B, 미션 §3 STOCK MODEL)
 *
 * 원칙:
 * - 숫자가 확인되지 않은 재고는 절대 숫자로 만들지 않는다 (stockQuantity=null, 창작 금지).
 * - 공급처 원본 옵션 정체성(rawLabel)을 유지한다 — 표시 키와 분리.
 * - stock_verified_at이 없는 값은 "값"이 아니라 "추측"이므로 계약에서 UNKNOWN으로 간다.
 */

/** 소스 유형 (미션 §2) */
export type StockType =
  | "A" // exact numeric stock (문서 확인: getItemView qty.inventory / 검증된 selectOpt 옵션수량)
  | "B" // available/soldout only (basis.status, 목록 존재, OPTSOLDOUT 이벤트)
  | "C" // normal browser interaction required (현재 44건 어디에도 불필요 — API가 존재)
  | "D" // unknown (selectOpt 옵션별 수량 구조 — 별첨 docx 검증 전까지 UNKNOWN)
  | "UNKNOWN";

/** 판매 상태 — 기존 Products 시트 `재고상태` 어휘와 호환 (catalog.ts/purchaseState 소비) */
export type StockStatus = "판매중" | "품절" | "판매종료" | "UNKNOWN";

/** 데이터 신뢰도 — 문서 근거 + 실측 검증 조합으로 결정 */
export type StockConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/** 신선도 — stock_verified_at 기반 (미션 §7) */
export type Freshness = "FRESH" | "STALE" | "UNKNOWN";

/** 옵션별 재고 항목 — 원본 라벨(identity) 유지가 계약 */
export interface OptionStockEntry {
  /** 주문 라인 키 규약: `${color}_${size}` (색상 없으면 size) — /api/orders·purchaseState와 동일 */
  optionKey: string;
  color: string;
  size: string;
  /** TYPE A일 때만 숫자. 미확인은 null — 0과 다르다 (0은 "확인된 0") */
  quantity: number | null;
  /** 품절 판정. true/false = 확인됨, null = 미확인 */
  available: boolean | null;
  /** 공급처 원본 옵션 문자열 (옵션 select 원문 등) — 정체성 유지 계약 */
  rawLabel: string;
}

/** 정규화된 재고 레코드 — 시트 스테이징·API·원장 공용 단일 모델 */
export interface StockRecord {
  /** Products 시트 상품ID (예: PRD-N1-01) */
  productId: string;
  /** 공급처 정보 — raw identity */
  supplierName: string;
  supplierProductId: string;
  supplierUrl: string;
  stockStatus: StockStatus;
  /** 상품 단위 수량. null = 숫자 미확인 */
  stockQuantity: number | null;
  stockType: StockType;
  /** ISO 8601. null = 아직 검증된 적 없음 */
  stockVerifiedAt: string | null;
  /** 예: "domeggook.getItemView.4.6" | "NOT_STAGED" */
  stockSource: string;
  stockConfidence: StockConfidence;
  optionStock: OptionStockEntry[];
  /** 원장 추적용 — 마지막 프로브 요청 ID */
  probeId?: string;
  /** 파생/주석 (예: "qty.inventory=0 → 품절 파생") — 검증된 사실만 */
  notes?: string[];
}

/** 프로브 원문 → StockRecord 사이의 중간 산출물 (파서가 확정한 사실만 담는다) */
export interface ProbeFact {
  supplierProductId: string;
  requestedAt: string;
  source: string;
  /** 공급처 응답의 판매상태 원문 (예: "판매중") */
  rawStatus?: string;
  /** 확인된 상품 단위 재고수량 (문서 필드 qty.inventory) */
  inventoryQty?: number | null;
  /** selectOpt 원문 파싱에 성공한 옵션 행 */
  optionRows?: OptionStockEntry[];
  /** selectOpt가 존재하지만 검증된 구조로 해석 불가 → 옵션 모호성 (HERMES 에스컬레이션 대상) */
  optionAmbiguity?: boolean;
  /** 가격 재검증 (재고와 무관하나 같은 프로브에서 확인) */
  priceVerified?: number | null;
  /** 파서 실패/레이아웃 변경 — 확정한 사실이 없음 */
  parserFailure?: string;
  /** 이 프로브로 확정된 유형 */
  factType: StockType;
}

/** HERMES 에스컬레이션 사유 (미션 §5 — LLM 개입은 이 세 가지 + 도달 불가) */
export type EscalationReason =
  | "PARSER_FAILURE"
  | "LAYOUT_CHANGE"
  | "OPTION_AMBIGUITY"
  | "SOURCE_UNREACHABLE";

export interface StockEscalation {
  reason: EscalationReason;
  productId: string;
  supplierProductId: string;
  detail: string;
  raisedAt: string;
  probeId?: string;
}

/** API 응답 단위 (Session H 소비 계약 — n1.stock.v1) */
export interface StockView extends StockRecord {
  fresh: boolean;
  freshness: Freshness;
  /** 시트 스테이징에서 읽었는지 (false = 원장 미러 또는 미스테이징) */
  staged: boolean;
}
