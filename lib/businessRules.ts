// N°1 CANONICAL BUSINESS RULES — 단일 소스 (미션 §4 영구 불변식)
// 카피·정책·계산이 여기를 벗어나 하드코딩되면 위반으로 본다.

// ── 배송비 (§4C — 서버 권위. lib/checkout.ts getShippingFee가 유일한 계산 경로) ──
export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_OVER = 50000;
export const SHIPPING_FEE_LABEL = "3,000원";
export const FREE_SHIPPING_LABEL = "무료배송";

// ── 주간 운영 리듬 (§4B) ──
// 트렌드 수집 시작: 금요일 / 분석·소싱·선정·데이터·QA: 금~일 / 릴리즈: 월요일 00:00 KST
// 고객 문구는 반드시 "월요일". "일요일" 표기는 금지.
export const TREND_CYCLE_START_DAY = 5; // 0=Sun … 5=Fri
export const WEEKLY_RELEASE_DAY = 1; // 1=Monday (KST 00:00 신규 컬렉션)
export const WEEKLY_RELEASE_LABEL = "매주 월요일 새로운 컬렉션";
export const WEEKLY_TAGLINE = "매주 월요일, 마음에 드는 몇 벌만 골라 보여드립니다";
export const WEEKLY_CLOSE_LABEL = "이번 컬렉션 마감";
export const WEEKLY_OPEN_LABEL = "매주 월요일 자정에 새 컬렉션이 열립니다";
export const FOOTER_LABEL = "© N°1 — 매주 월요일, 새로운 컬렉션";

// ── 브랜드 아이덴티티 (§4A) ──
// 홈/올 탭은 60 Pieces · 20 Outfits를 대표해야 한다 (실측 카운트가 60/20을
// 유지하는 한 실시간 카운트가 이를 표현한다 — 카운트가 어긋나면 데이터 결함).
export const CATALOG_IDENTITY = { PIECES: 60, OUTFITS: 20 };

// ── 배송 안내 정직 카피 (§18 — 검증되지 않은 SLA·할증액 절대 표기 금지) ──
export const PDP_SHIPPING_COPY = [
  "결제 또는 입금 확인 후 공급처 출고 일정에 따라 배송이 시작됩니다. 배송이 시작되면 운송장 정보와 함께 안내해 드립니다.",
  "기본 배송비 3,000원 · 5만원 이상 구매 시 무료배송",
  "도서·산간 지역은 추가 배송비 또는 배송기간이 발생할 수 있으며 주문 확인 후 안내됩니다.",
] as const;

export const PDP_RETURN_COPY = [
  "상품 수령 후 7일 이내 마이페이지 또는 고객센터 문의로 신청할 수 있습니다.",
  "택 제거·착용 흔적·세탁 등 상품 가치가 훼손된 경우 교환/반품이 제한될 수 있습니다.",
  "표기·광고 내용과 상이한 상품은 전자상거래법에 따라 청약철회 가능합니다.",
] as const;

// ── 반품 가능 시계 (§26 — 정책 상수. 프론트 산개 하드코딩 금지) ──
// 서버/정책 소스. delivered_at 기준으로 return_deadline을 산출한다.
export const RETURN_WINDOW_DAYS = 7;
