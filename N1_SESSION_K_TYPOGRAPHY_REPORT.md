# N1_SESSION_K_TYPOGRAPHY_REPORT.md

> **SESSION K — N°1 TYPOGRAPHY READABILITY PASS** · 2026-09-09
> 브랜치: **`n1-returns-info-ux`** (Session I 완료 상태 그대로 — 신규 브랜치 생성 없이 세션 K 작업분)
> 범위: **TASK 8** — 전면 타이포그래피 가독성 패스. **기능·state·API 수정 0건** (CSS 3개 파일만).
> 결과: **테스트 183/183 PASS · `tsc --noEmit` clean · `next build` ok ·
> 11개 서피스 × 5개 뷰포트(1440/1024/768/390/375) 실측 639 프로브 중 551 변경 · 88 앵커 불변 ·
> Product > UI 위계 유지 확인(제품명−UI 본문 절대차 1.5px → 2px로 확대).**

---

## 0. 요약 — 무엇을 했고 무엇을 보장하는가

1. **조사(전제)**: 이 코드베이스에는 형식화된 typography token이 **존재하지 않았다**.
   `globals.css` 1,197줄 + PDP/Returns 모듈 CSS에 font-size가 클래스별로 하드코딩
   (8.5 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 15.5 / 16 / 17 / 19 / 20 / 21 / 22px…).
2. **토큰 신설**: `:root`에 역할 토큰 12개를 도입했다
   (`--t-heading`, `--t-heading-sm`, `--t-product-name`, `--t-product-price`, `--t-body`,
   `--t-body-sm`, `--t-meta`, `--t-meta-sm`, `--t-label`, `--t-nav`, `--t-button`, `--lh-body`).
   렌더되는 규칙부터 토큰 `var()`로 치환했다.
3. **비균등 조정**: "단순 global +10%" 금지 준수 — **micro일수록 증가폭이 크고
   display·가격 앵커는 0%**다. 최소 라벨 8.5→10px(+17.6%), 본문 13→13.5px(+3.8%),
   히어로/타이틀/입력/15px+ 버튼은 불변.
4. **Product > UI 보장**: 제품 타입(컬렉션 상품명·가격, PDP 상품명)이 UI 본문보다
   큰 리드를 **유지하면서 확대**했다 (14.5 vs 13 = +1.5px → 15.5 vs 13.5 = +2px).
5. **검증**: CSS 변경만으로 `node --test tests/*.test.cjs` **183/183 PASS**
   (I6·I7의 CSS 문자열 잠금 — `.cs-fab left:` / `.quality p { line-height: 1.85; }` / 모바일 블록 — 무손상),
   `tsc --noEmit` clean, prod build ok. puppeteer-core 실측 하니스로 변경 전/후
   computed style을 5개 뷰포트에서 대조했다(측정 스크립트: 워크스페이스 `typo-measure/measure.cjs`).

---

## 1. 조사 — 기존 타이포 인벤토리 (변경 전)

### 1-1. 토큰 부재
- `:root` 변수는 색상(`--ink/--paper/--accent/--muted/--line`)과 Liquid Glass 재질, FAB 치수만 존재.
- font-size는 전부 리터럴. 같은 "본문" 역할이 12.5/13/13.5로, 같은 "라벨" 역할이
  8.5/9.5/10/10.5로 흩어져 있었다.

### 1-2. 렌더 서피스별 실측 (baseline, Chrome headless computed style)
| 서피스 | 요소 | 변경 전 |
| --- | --- | --- |
| Header | brand-mark / brand-tag / auth-link | 15 / **8.5** / 10.5px |
| Hero | h1 / tag / tagline / drop | 20 / 10 / 15 / 11px |
| C Perfume Lens (탭) | gtab / gcount / gtab-fit | 11 / 10 / 10.5px |
| Pair grid (제품) | piece-name / price / eyebrow / pair-reason | 14.5 / 13 / 10 / 11.5px |
| PDP (제품) | hero-name / lede / price / quality | 19 / 15 / 22 / 13px |
| Stock count | stockCount(PDP) / float-count / float-status | 12 / 10 / **9.5**px |
| Cart | head / line-name / opts / total / btn | 13.5 / 12.5 / 11.5 / 15 / 13.5px |
| Checkout | title / step / item / total-val / btn / note | 20 / 12 / 13 / 16 / 15 / 11px |
| Payment | pay-name / desc / wait | 13 / 11 / 11px |
| CS | header / msg / badge / send / input | 13 / 13 / 10 / 13 / 13px |
| Returns(/orders) | title / sub / chip / step-hint / status-meta | clamp(20–26) / 13 / 11 / 11.5 / 11.5px |
| Auth·Smart Fit (lq) | kicker / title / sub / row-label / row-text / act / input | **9.5** / 17 / 12.5 / 10 / 13.5 / 13.5 / 14px |

**문제 진단**: 8.5~10px 트래킹 uppercase 라벨(브랜드 태그, lq-kicker, agent-badge, float-status)은
가독 하한(약 10px) 밑 — 역할 중 "label"이 가장 큰 개선폭을 가져야 한다. 반대로
22px PDP 가격, 20px 히어로, 15px 이 입력은 이미 충분하다.

---

## 2. 설계 — 비균등 스케일과 토큰

원칙 3개:

1. **micro일수록 크게, display는 그대로** — 절대 +1px가 주는 가독 이득은 작은 글자일수록 크다
   (8.5→10px = +17.6% vs 13→13.5px = +3.8%). 스케일 전체를 통일하지 않는다.
2. **Product > UI** — 제품 타입 토큰을 UI 본문 토큰과 분리하고 리드를 키운다
   (`--t-product-name: 15.5px` vs `--t-body: 13.5px`).
3. **행간은 사이트 리듬(1.7)으로 수렴** — 1.6이던 다중행 문단(CS 말풍선, lq-row-note)을
   기존 1.7 리듬(checkout-note 등)에 맞춘 것 외에 행간·자간·굵기는 그대로.

### 2-1. 신설 토큰 (`app/globals.css` `:root`)
| 토큰 | 값 | 역할 (대표 적용처) |
| --- | --- | --- |
| `--t-heading` | 20px (불변) | 페이지 타이틀 — hero h1, checkout-title |
| `--t-heading-sm` | 18px (17→) | 서피스 타이틀 — lq-title |
| `--t-product-name` | 15.5px (14.5→) | 컬렉션 상품명 (첫 페어 16.5, quiet 14) |
| `--t-product-price` | 14px (13→) | 컬렉션 가격 (quiet 13) |
| `--t-body` | 13.5px (13→) | 본문 — CS 메시지, PDP facts/quality, checkout-item |
| `--t-body-sm` | 12.5px (불변) | 보조 본문 — policy-tab, option-chip, lq-ghost |
| `--t-meta` | 12px (11.5→) | 메타·노트 — cart-line-opts, pay-desc가 속한 단계의 상위 노트 |
| `--t-meta-sm` | 11.5px (11→) | 작은 메타·칩 — chip, drop-line, cart-meta, buybar-cta |
| `--t-label` | 10.5px (8.5–10→) | 마이크로 라벨 — brand-tag, lq-kicker, piece-eyebrow, gcount, badges |
| `--t-nav` | 11.5px (10.5–11→) | 내비·탭 — gtab, auth-link, gender-tabs |
| `--t-button` | 13.5px (13→) | 버튼 — cs-send, lq-seg (15px+ 버튼은 불변) |
| `--lh-body` | 1.7 | 본문 행간 하한 |

---

## 3. 변경 내역 (파일·규모)

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `app/globals.css` | 234줄 (+129/-105) | 토큰 블록 신설 + 렌더 규칙 토큰 치환·치수 조정 |
| `app/product/[id]/product.module.css` | 62줄 | PDP 타이포 31규칙 (kicker/heroName/facts/cta/chips/buyBar/yourFit/pair) |
| `components/OrderReturns.module.css` | 83줄 | Returns 타이포 41규칙 + 한국어 문단 `keep-all` 10규칙 |

- **US(미사용) 규칙 제외**: `.card`/`.grid`/`.placeholder` 등 구 카탈로그 잔재는 어디서도
  렌더되지 않아(pair-collection/모듈로 대체 확인) 손대지 않았다. 구 매체 모달(`.modal`,
  `/?product=` 딥링크 호환 경로로만 도달)은 살아있는 경로라 동일 원칙으로 조정했다.
- **테스트 잠금 문자열 무손상**: `.quality p { line-height: 1.85; }`,
  `.quality p + p { margin-top: 10px; }` (I6), `.cs-fab left:`·`.float-bar right:`·
  모바일 블록 `.itemRow/.flowNav/.pickerQty/.guestForm` (I6·I7) — grep 실측 1건씩 유지.

### 3-1. 역할별 대표 before → after (1440 기준, 5개 뷰포트 공통)
| 역할 | 요소 | 전 | 후 | 증가율 |
| --- | --- | --- | --- | --- |
| label | site-brand-tag | 8.5px | 10px | **+17.6%** |
| label | lq-kicker | 9.5px | 10.5px | +10.5% |
| label | piece-eyebrow / pair-head / 단품 라벨 | 10px | 10.5px | +5.0% |
| nav | auth-link | 10.5px | 11.5px | +9.5% |
| nav | gtab (C Perfume Lens) | 11px | 11.5px | +4.5% |
| meta | chip / drop-line / checkout-note / pay-desc | 11px | 11.5px | +4.5% |
| meta | cart-line-opts / pair-reason / view-note | 11.5px | 12px | +4.3% |
| body | CS 메시지 / quality / facts / checkout-item | 13px | 13.5px | +3.8% |
| body(제품) | cart-line-name·price / Returns sub·orderNo | 12.5px | 13px | +4.0% |
| button | cs-send / lq-seg / PDP cta / Returns cta | 13px | 13.5px | +3.8% |
| button(제품) | lq-act | 13.5px | 14px | +3.7% |
| heading-sm | lq-title | 17px | 18px | +5.9% |
| product | piece-name (첫 페어) | 14.5 (15.5) | 15.5 (16.5) | +6.9% |
| product | piece-price / pair-price | 13 (12.5) | 14 (13) | +7.7% |
| product | PDP hero-name | 19px | 20px | +5.3% |
| **불변 앵커** | hero h1 20 / tagline 15 / lede 15 / PDP price 22 / story-title 21 / checkout-title 20 / total-val 16 / checkout·cart·pay 버튼 15·16 / lq-input·checkout input 14 / brand-mark 15 | — | — | **0%** |

---

## 4. 재측정 — 11개 서피스 × 5개 뷰포트

- 방법: prod build(`next start -p 3323`) + Chrome headless(v23 puppeteer-core)로
  `getComputedStyle`의 font-size/line-height/letter-spacing/font-weight를 실측.
  데이터 조건부 클래스(재고 카운트, 주문 카드, 결제수단 행 등)는 **CSSOM에서 실제
  적용 클래스 토큰을 찾아 DOM에 주입 → 측정 → 제거**하는 방식으로 동일 조건 실측했다
  (앱 state·API에는 손대지 않는 클라이언트 측정 기법).
  Smart Fit은 세그 선택만 클라이언트로 진행(게스트 핏은 sessionStorage 저장 — 서버 write 0)해
  4단계(핏→사이즈→하의→결과)를 모두 측정했다.
- 스코프: **639 프로브**(11 서피스 × 프로브 × 5 뷰포트), **551 변경 · 88 불변 앵커**.
- 결과: 5개 뷰포트에서 증감 패턴 동일(뷰포트별 차이는 미디어쿼리 분기분만 — 모바일
  tagline/drop, Returns seg 버튼 12.5px 등). 스크린샷 22장(서피스×뷰포트) 검수 완료.

| 서피스 | 대표 검증값 (전→후) | 판정 |
| --- | --- | --- |
| Header | brand-tag 8.5→10, auth-link 10.5→11.5, brand-mark 15 불변 | OK |
| C Perfume Lens | gtab 11→11.5, gcount 10→10.5, 렌즈 지오메트리 무변경 | OK |
| Smart Fit | kicker 9.5→10.5, title 17→18, row-text 13.5→14, act 13.5→14, 4단계 모두 | OK |
| Auth | 동일 lq 토큰 적용 (input 14 불변) | OK |
| Pair grid | piece-name 14.5→15.5(첫 페어 16.5), price 13→14, eyebrow 10→10.5 | OK |
| PDP | hero-name 19→20, facts/quality 13→13.5, cta 13→13.5, price 22 불변 | OK |
| Stock count | stockCount 12→12.5 (미확정 상품은 미렌더 — 주입 실측), float-count 10→10.5 | OK |
| Cart | head 13.5→14, line-name 12.5→13, btn 13.5→14, total 15 불변 | OK |
| Checkout | item/confirm 13→13.5, input 14 불변, total-val 16·btn 15 불변, note 11→11.5 | OK |
| CS | msg 13→13.5, header 13→13.5, badge 10→10.5, send 13→13.5, 행간 1.6→1.7 | OK |
| Returns | sub 13→13.5, chip 11→11.5, step-hint/status-meta 11.5→12, title clamp 불변 | OK |

### 4-1. 부수 가독 수선 (증가폭에 따른 줄바꿈 회귀 방지 — CSS만)
+0.5~1px 증가로 생긴 어색한 줄바꿈 3곳을 함께 수선했다 (베이스라인 스크린샷 대조로
회귀 여부 판정 — 모바일 탭 래핑은 베이스라인부터 존재하던 것을 함께 정리):
1. `.auth-link`, `.gtab`에 `white-space: nowrap` — "로그/인", "젠더리/스" 단어 중간
   줄바꿈 제거 (내비는 구조상 가로 스크롤이 담당 — 390/375 실측 확인).
2. `.collection-sub`, Returns 모듈 문단 10규칙에 `word-break: keep-all` —
   "단품 10/개", "구/분하지" 같은 수량어·조사어 중간 breaking 제거 (공백 단위로만 개행).

---

## 5. Product > UI 위계 검증 (규칙 6)

| 지표 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 제품명(piece-name) / UI 본문(13) 비율 | 1.12 | **1.15** |
| 제품명 − UI 본문 절대차 | +1.5px | **+2.0px** |
| 제품가격 / UI 본문 | 13/13 = 1.00 | 14/13.5 = **1.04** |
| PDP hero-name / PDP 본문(lede) | 19/15 = 1.27 | 20/15 = **1.33** |

- UI 쪽 증가분은 절대 +0.5~1px의 미세 라벨·메타이며, 굵기(font-weight)는 **한 곳도
  변경하지 않았다**. 제품 타입의 절대 리드는 오히려 커져서 "UI가 Product보다 강해지는"
  역전은 없다 (스크린샷 22장 육안 대조 포함).

---

## 6. 회귀 검증 (규칙 7)

| 항목 | 결과 |
| --- | --- |
| `node --test tests/*.test.cjs` | **183/183 PASS** (I1–I7 포함 전 수트) |
| `npx tsc --noEmit` | clean |
| `next build` | 성공 (error 0) |
| 테스트 잠금 CSS 문자열 | `.cs-fab left:` / `.float-bar right:` / `.quality p { line-height: 1.85; }` / `.quality p + p { margin-top: 10px; }` / Returns 모바일 블록 — 전부 무손상 |
| 기능/state/API | 변경 0 — 수정 파일은 CSS 3개뿐. TSX/lib/api 손대지 않음 |
| 시트 write | 측정 과정에서도 0 (카트는 localStorage 시드, 게스트 핏은 sessionStorage, 주문 생성 없음) |

---

## 7. 의도적으로 하지 않은 것 + 기존 관찰사항

- **행간·자간·굵기 대개 수정 없음**: 자간(0.14em~0.3em)은 브랜드 보이스, 굵기는 위계 신호라
  그대로 두었다. 변경한 행간은 CS 말풍선·lq-row-note·itemLine·itemOpt의 1.6→1.7(사이트 리듬 수렴)뿐.
- **불변 앵커 88프로브**: 히어로/타이틀/가격 앵커/입력/15px+ 버튼 — 이미 가독하거나 제품 위계의 기준이라 0%.
- **기존 관찰(미수정, 이번 회귀 아님)**: PDP 390px에서 Scene 2 타이틀이 좌측 CS FAB에
  겹쳐 클리핑되어 보이는 현상은 **베이스라인 스크린샷에서도 동일** — 레이아웃(여백/FAB 위치)
  영역의 기존 사안으로 타이포 패스 범위 밖. 후속 세션 과제로 남긴다.
- `N1_SESSION_F_HEADER_REPORT.md`에 이번 세션과 무관한 작업트리 수정이 있었다
  (세션 K 이전 상태) — 손대지 않았다.

## 8. 산출물

- 코드: `app/globals.css`, `app/product/[id]/product.module.css`, `components/OrderReturns.module.css`
- 측정 하니스·데이터: 워크스페이스 `typo-measure/` (measure.cjs, baseline.json, after.json, shots-baseline/, shots-after/)
- 본 보고서: `N1_SESSION_K_TYPOGRAPHY_REPORT.md` (워크스페이스 + 리포지토리 루트)
