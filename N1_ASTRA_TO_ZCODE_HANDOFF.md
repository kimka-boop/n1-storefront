# N°1 Astra Research Handoff

*작성: 2026-09-07 · GLM 5.3 (HERMES Master) — 이전 GPT-6 Astra 세션 산출물 회수·정리*
*원칙: Astra가 실제로 수행한 조사만 보존. 재조사 없음. 계획만 한 것과 완료된 것을 구분.*

---

## 1. Purpose

GPT-6 Astra는 n1pieces.com 리디자인을 위한 Phase 1 감사(사이트·프런트엔드·상품 데이터·기존 N°1 디자인 문서·외부 레퍼런스)를 수행했으나 비용 문제로 구현 직전에 중단되었다. 이 문서는 Astra가 이미 확보한 결과를 보존하고, ZCode가 재조사 없이 구현 단계부터 이어갈 수 있게 하는 유일한 전달 문서다.

Astra는 이후 이 작업에 호출하지 않는다.

## 2. What Astra Actually Inspected

**실제 브라우저 열람 (운영 n1pieces.com)**
- 홈 (데스크톱 1440×1000 / 모바일 390, 375, 768)
- `/product/PRD-W-52`, `/product/PRD-G-50`, `/product/PRD-M-51`, `/product/PRD-M-55`, `/product/PRD-M-52` (모바일 포함)
- `/?product=PRD-W-52` 빠른 주문 모달 (옵션→주문폼 진입까지, 제출은 미수행)
- `/checkout` (빈 장바구니 상태)
- 외부: apple.com/iphone-air (실제 열람·컨트롤 조작), auralee.jp 제품상세·material-matters, amomento.co, studionicholson.com (리다이렉트로 SSF샵 렌더링됨), W3C WCAG 문서

**실제 읽은 소스 (로컬 저장소 C:/Users/MY-PC/Documents/n1-storefront, 브랜치 product-detail-experience-v1 @12ef45a)**
- app/page.tsx, app/globals.css, app/layout.tsx
- app/product/[id]/page.tsx, product.module.css
- components/product/* (ImageCrop, SceneSection, TonePanel, SizeTable, StickyBuyBar, VerificationDrawer는 git 이력으로 확인)
- components/MaterialComposition.tsx, FitProfileModal.tsx, CheckoutFlow.tsx, CsWidget.tsx, FloatingOrderTracker.tsx, Icons.tsx
- lib/display.ts, lib/productContent.ts, lib/products.ts, lib/media.ts·lib/proto.ts·components/ProtoDetail.tsx·SmartFitFlow.tsx (git show main)
- app/api/products/route.ts, app/api/orders/route.ts, app/api/lookbook-files/route.ts
- package.json, next.config.js, tsconfig.json

**실제 읽은 디자인 문서 (n1_md)**
- N1_VISUAL_LANGUAGE_v1.md, N1_VISUAL_REFERENCE_ANALYSIS.md
- N1_RESEARCH/01,02,03,04,05(Visual Constitution v2),06,07,08,09,10,11,12(Liquid Glass V2),13
- N1_BRAND_EXPERIENCE_DIRECTION_V1.md, N1_PRODUCT_DETAIL_EXPERIENCE_V1.md
- N1_REFERENCE_ANALYSIS_APPLE_LIKE.md, N1_ZCODE_IMPLEMENTATION_HANDOFF.md
- pipeline_runs/first_batch_s2_stories.md, first_batch 관련 JSON/보고서

**실제 확인한 이미지 (vision)**
- media_pipeline/runs/_first_batch_dl/{PRD-W-52,PRD-M-51,PRD-G-50}/01~05 전체 (각도 비교용 contact sheet 생성)
- media_pipeline/runs/PRD-M-55/qa/01~04 (contact sheet 생성)
- 05_product_cutout 계열 (W-52, M-51, M-55, G-50)
- Desktop/N1작업/48867ee5-….png (레퍼런스 스크린샷)

**API 실측**: /api/products (운영+로컬 동일 60건), /api/lookbook-files (M-55 폴더 → ok:true, files:[], thumb:null)

## 3. Current Website Findings

- 운영 홈: 60개 상품 전체 노출 — 56개 `PREPARING`, 4개 `LOADING` 카드. 성별 탭 `전체(60)/남성(0)/여성(0)/젠더리스(60)` (API는 MALE/FEMALE/GENDERLESS 20/20/20 반환 — 프런트 enum 매칭 결함).
- 카드 이미지 <img> 0개 (모두 placeholder). 남성 탭 클릭 시 카드 0개.
- 운영 PDP(구版 번들): '구매하기'가 주문이 아니라 구매 섹션으로 scrollIntoView. 실제 구매는 `/?product=` 모달에서만 가능.
- PDP의 대표컷·소재·핏 영역이 **전부 같은 정면 이미지 1장**(media.fashn.ai product_to_model_0.png)을 반복.
- W-52 대표컷 1536×2752를 4:5 크롭 — 데스크톱 히어로가 뷰포트보다 커서 이름이 첫 화면에 안 들어옴.
- G-50 '확인 기록'에 "Size confirmed"가 표시되나 sizeChart는 공백 — 확인되지 않은 사실을 확인된 것처럼 표기.
- 고시 영역: 빈값에 "제조연월 2026년 1월 이후 상시제조", "제조자 N°1 협력업체" 등 기본 문구가 사실 없이 채워짐.
- M-52(품절) 분기는 CTA 비활성 + 일반 문구로 정상 동작.
- 모바일 390px: PDP 총 4,467px, scene1 610px — 스크롤 정상, 무너짐 없음. **cs-fab(고객센터 플로팅 버튼)이 하단 StickyBuyBar 구매 버튼과 겹침**.
- prefers-reduced-motion: scene 페이드는 정상 비활성(transition 0s), 그러나 html scroll-behavior:smooth는 유지.
- 상품명은 공급사 SEO 나열형(예: "긴팔 여자니트스웨터 여자스웨터 니트 라운드넥…") — 에디토리얼 톤과 충돌.
- 타이포: Helvetica Neue 시스템 폴백 + letter-spacing 0.22~0.32em 영문 대문자 위주. #999 라벨이 warm paper 위 대비 2.71:1 (WCAG 4.5:1 미달).
- 키보드: 홈 카드가 `<article onClick>` — tabindex/focusable 아님. 검색 없음.

## 4. Current Frontend Structure

- Next.js 14.2.15 (App Router, 대부분 "use client" CSR) + React 18.3.1 + TypeScript 5.6. 애니메이션 라이브러리 없음(IntersectionObserver + CSS). Tailwind 없음 — app/globals.css(572줄) + product.module.css(CSS Modules). 테스트 프레임워크 없음(당시 기준; Astra가 node:test 기반 tests/experience.test.cjs 3개 추가, 통과).
- 데이터: /api/products → Google Sheets(한국어 헤더) 실시간 읽기. /api/orders → Orders 시트 인입 + 재고 차감 + 텔레그램 알림 (시트/크리덴셜은 HERMES 관할 — ZCode 접근 금지).
- 이미지 경로 2종: media.fashn.ai 직접 URL(W-52/M-51/G-50) / Drive 폴더 URL(M-55 — lookbook-files API가 files:[] 반환, 현재 깨짐).
- **브랜치 분기 주의**: 작업 브랜치(product-detail-experience-v1)는 main과 공통 조상이 67ad610. main에만 존재하는 P1-A/P1-B/P2-1~3(Constitution v2·FOG DEPTH·Liquid Glass W 변수·DWELL·AFTERGLOW)와 ProtoDetail(4각도 스크롤 회전), SmartFitFlow가 통합되지 않음. 필요 시 원리만 재구현 권장(통째 merge 아님).
- 상태 관리: 홈 page.tsx 단일 컴포넌트에 구매 모달·주문 폼·Smart Fit 포함(~850줄). lib/display.ts가 시트 값→표시용 한국어 정규화(데이터 불변 원칙).

## 5. N°1 Design Principles Confirmed

기존 문서에서 확인된 원칙 (용어·의도 유지):

- **Curated fashion editorial, not marketplace** — "모든 상품을 한자리에 쏟아놓지 않는다". 발견 경로가 구매 경로보다 우선.
- **LIGHT / CLEAN / SOFT / QUIET / PRECISE** — warm white(#faf9f7 계열) 캔버스, 콜드 그레이 금지, 경계선 대신 톤 온도차, 절제된 대비.
- **Glass is behavior** — Liquid Glass는 blur/투명 카드가 아니라 "공간이 사용자의 존재를 감지하고, 일시적으로 기억하고, 반드시 잊는" 상호작용 문법(W 변수: APPROACH .8s → DWELL → EXIT → 2.5s DISSIPATION). 3용도 한정: ①고정 상품 내비 ②검증 서랍 ③옵션 레이어.
- **Cotton is feeling** — 부드러움은 텍스처 사진이 아니라 빛 받는 방식(저대비·무광·반복 리듬).
- **Blotter is discovery** — 정보의 계층적 가림. 존재는 먼저, 상세는 나중. 스크롤=다가감.
- **Perfume Bottle = product as intentional object** — 상품이 매개물(공간 재질)에 닿을 때 물성이 전달됨. Product-Only 컷은 공급사 누끼가 아니라 독립 제작처럼.
- **Product-first hierarchy** — 첫 화면은 이미지+이름만, 가격·CTA 없음. 1뷰포트 1관념.
- **Progressive disclosure** — Scene 1~6 구조(First impression → Why → Material → Fit → Info → Decision). Apple 철학은 차용하되 시각 복제 금지(다크 히어로·비디오 중심·대형 타입 과시 배제).
- **Purposeful motion** — 등장 400ms / 상태 200ms / 챕터 600ms, opacity+transform만, 뷰포트 진입 1회, 반드시 복귀형. entrance 쇼·parallax·scroll-jack 금지.
- **근거의 여백 / 검증은 조용하다** — 단정 금지(R11), 확인된 사실만 표기, 배지 그래픽 금지, AI는 Invisible Curator.

※ Astra 발견: Constitution v2의 "60개 동일 밀도·균등 존중"과 "텍스처 확대 금지"는 최신 Owner 브리프(편집적 강약, 소재 이해를 위한 디테일 이미지)와 충돌 — Owner 지시가 우선. 철학은 유지, 표현 규칙은 재해석 필요.

## 6. Major Design Gaps

| # | CURRENT | INTENDED | WHY IT MATTERS |
|---|---|---|---|
| 1 | 60개 전량 노출 + PREPARING 카드 벽 | 준비된 컬렉션만, 편집형 리듬 | 첫인상이 "재고 목록"이 됨 |
| 2 | PDP 전 구간 같은 정면 이미지 반복 | 챕터마다 해당 정보를 설명하는 미디어 | 스크롤해도 새로 이해되는 것이 없음 |
| 3 | 대표컷이 전신 → 얼굴이 주인공 | 상의=턱~하반신, 하의=허리~발 크롭 토큰 | 핏·실루엣 전달이 핵심 브리프 요구 |
| 4 | 선택 색상이 주문 모달에서 유실(전체 문자열로 리셋) | 원시 color 값이 주문까지 전달 | 오배송 리스크, 이중 선택 |
| 5 | sizeOptions/optionStock 전 상품 공백인데 구매버튼 활성 | 재고 데이터 없으면 정직한 상태 분기 | 서버가 재고 0으로 주문 거절 — 신뢰 문제 |
| 6 | "Size confirmed" 표시 vs 실제 수치표 없음 | 데이터 없으면 항목 비표시 | 허위 검증 표기 |
| 7 | 모바일 CS 버튼이 구매 버튼과 겹침 | 안전한 하단 오프셋 | 구매 동선 직접 방해 |
| 8 | 키보드로 상품 진입 불가(article onClick) | 포커스 가능한 진입 | 접근성 + 전환율 |
| 9 | #999 라벨 대비 2.71:1 | 본문 12px+ 충분한 대비 | WCAG AA 미달 |
| 10 | 계획만 존재한 Liquid Glass·FOG·DWELL | 행동 문법으로서 선택적 구현 | N°1 고유 정체성의 핵심 |

## 7. Homepage Findings

- Hero 뒤 sticky gender tabs(운영) — 준비 완료 제품만 거르는 로컬 개편본 대비.
- 카운트다운 "[D-6]"이 큐레이션보다 앞섬 — 긴급감 조장은 브리프 위반.
- 상품 카드: 균등 4열/2열, hover 배경색 변화만. 정보는 카테고리·이름·가격·재고상태.
- 검색 없음, 검색 input 0개.
- 스크롤 리빌: threshold 0.12~0.15 IntersectionObserver, opacity+translateY — 동작은 하나 의미 전달 없음.
- 브랜드 스토리 섹션은 로컬 개편본에만 존재("괜찮은 것만 보여드립니다" 문단 — 방향은 유효).

## 8. Product Discovery Findings

- 발견→상세 이동은 카드 클릭(마우스)뿐.
- 성별 필터가 유일한 탐색 도구. 컬렉션 단위 서사(Entry→Silence→Object)는 문서에만 있고 화면엔 부재.
- 준비 중 상품 56개는 "PREPARING" 텍스트로 노출 — 미래 약속("매주 일요일 공개")은 근거 없는 기대 형성.

## 9. Product Detail Findings

- Scene 구조 자체는 건전(1~6+Facts). 문제는 미디어 바인딩: 모든 ImageCrop이 lookbookImage(정면 1장) 동일 소스, 토큰만 다름(CROP_HERO 50% 18% / CROP_FULL / CROP_DETAIL 50% 38%).
- 실제 6샷(01~04 모델 각도 + 05 product-only)이 Drive/FASHN에 존재하나 프런트는 1장만 사용 — **가장 큰 낭비**.
- M-51 주의: 보관된 02_45deg는 라운드넥, 확정 정면은 V넥 → 각도 시퀀스로 연결하면 상품 정체성 불일치.
- W-52 05_product_cutout은 1024×4096 세로 4컷 스트립 — 단일 이미지로 쓰면 깨짐, 1컷 선택 필요.
- G-50/M-55 원본 모델컷은 발 잘림 — "full body"로 표기하면 안 됨.
- VerificationDrawer(확인 기록)는 3~4개 사실 나열 — 구조는 좋으나 G-50처럼 데이터 없는 항목까지 표시.
- TonePanel(두께/신축/비침/안감 3단계 톤)은 데이터 없으면 "정보 없음" 중립 패널 — 정직한 처리, 유지 가치.
- AI 이미지는 스타일링 참고용 — 실측이나 소재 증거가 아님을 표시해야 함.

## 10. Liquid Glass Findings

Astra의 판정 (blur/glassmorphism 부가 아님):

1. **유효**: 스크롤 중 상품 맥락을 유지하는 sticky 읽기/컨트롤 레일(얇은 반투명 + 불투명 폴백) — "정보가 겹쳐도 방해하지 않음".
2. **유효**: 색상 선택 시 같은 자리에서 미디어 교체(200ms) — 상태 전환으로서의 glass.
3. **무효**: 정적 옵션 박스에 blur 배경(맥락이 지나가지 않으므로) — 제거 대상.
4. main 브랜치의 W 변수 문법(APPROACH/DWELL/AFTERGLOW/DISSIPATE, 실측 검증됨)은 재구현 가치 있음 — 단 desktop mouse only, reduced-motion/mobile은 fog-lift만.
5. FOG DEPTH(뷰포트 하단 카드 opacity 0.93 → 진입 시 1.0)는 저비용 고효과로 확인됨.

## 11. Motion / Animation Findings

- 도움이 되는 것: 챕터/뷰 전환 시 180~240ms 크로스페이드(왜 바뀌었는지 라벨 동반), 디테일 검수를 위한 크롭 확대, 모델→제품단독 전환("입은 모습→사물 그 자체" 서사).
- 부족한 것: 현재 entrance fade는 전 구간 동일 → 의미 없음. 모션이 없어서가 아니라 상태 변화와 연결되지 않아서 문제.
- 금지 확인: parallax, scroll-jack, 상품 이미지 scale/zoom 연출(hover), 레이아웃을 바꾸는 hover, bounce/elastic.
- reduced-motion: scene은 준수, html scroll-behavior만 예외 처리 필요.

## 12. Responsive / Mobile Findings

- 375/390/768/1440 무너짐 없음(grid 1열/2열/4열 전환 정상).
- PDP scene1이 모바일에서 610px — 적정하나 데스크톱 히어로는 뷰포트 초과.
- cs-fab × StickyBuyBar 겹침(390px 실측) — P0급.
- 터치 타겟: 색상 chip 8px padding — 24×24px 최소 기준 재검 필요.
- 빠른 주문 모달은 모바일에서 세로 스택 — 동작함.

## 13. Relevant Source Files

| 파일 | 역할 |
|---|---|
| app/page.tsx | 홈+구매 모달+주문 폼 (개편 1순위) |
| app/globals.css | 전역 토큰·컴포넌트 스타일 |
| app/product/[id]/page.tsx | PDP Scene 1~6 조립 |
| app/product/[id]/product.module.css | PDP 전용 스타일 |
| components/product/ImageCrop.tsx | 크롭 토큰(CROP_HERO/FULL/DETAIL) |
| components/product/{SceneSection,TonePanel,SizeTable,StickyBuyBar,VerificationDrawer}.tsx | 챕터 시스템 |
| components/{MaterialComposition,FitProfileModal,CheckoutFlow,CsWidget,FloatingOrderTracker,Icons,AuthNav,AuthProvider}.tsx | 기능 보존 대상 |
| lib/display.ts | 시트→표시 한국어 정규화 (데이터 불변) |
| lib/productContent.ts | Scene 2 문구 (D2 승인 사실 유지) |
| lib/experience.ts | **Astra 신규**: 컬렉션 필터·색상 파싱·구매 상태·옵션 전달 (테스트 3개 통과, 화면 미연결) |
| app/api/products,orders,lookbook-files/route.ts | 데이터 계약 (변경 금지, 참고만) |
| git main 브랜치: components/ProtoDetail.tsx, SmartFitFlow.tsx, lib/proto.ts | 4각도 회전·SmartFit 원형 (원리만 차용) |

## 14. Existing Screenshots / Artifacts

`C:/Users/MY-PC/AppData/Local/hermes/cache/n1_website_phase1_audit/`
- live-home-desktop-final.png / live-mobile-home.png / live-mobile-decision.png / live-mobile-modal.png
- PRD-{W-52,M-51,G-50}-angles-audit.jpg (4각도 비교 contact sheet), reference-amomento.png
- live-products-snapshot.json (60건 전체 스냅샷), source-snapshot.json, live-{home,pdp}-bundle.js (운영 번들 증거)

`C:/Users/MY-PC/Documents/n1-website-redesign-20260907_225855/`
- backup/ (기존 소스 전체 백업), products-before.json, m55-audit.jpg

`C:/Users/MY-PC/Documents/n1-storefront/docs/N1_REDESIGN_MISSION.md` — Astra가 작성한 감사 요약+설계 계획(18개 섹션 상세판).

## 15. Technical Constraints

- 애니메이션 라이브러리 도입 금지(브리프) — CSS/IO만.
- 유료 API(FASHN 등) 전면 동결 — 기존 이미지 선별·크롭만.
- 시트 쓰기·배포·publish는 HERMES 게이트. ZCode는 로컬 프런트만.
- 데이터 계약 불변: /api/products 필드가 전부. sizeOptions/optionStock 공백은 프런트에서 "미확정"으로 정직 분기 — 창작 금지.
- M-55 Drive 폴더 URL은 lookbook-files API가 빈 목록 반환 → 이미지 소스 수정 필요(파일명으로 매핑하거나 데이터 문제로 HERMES 에스컬레이션).
- 검색·필터는 준비된 컬렉션 내에서만, gender는 API enum 정확 매칭.

## 16. Recommended Redesign Direction

Astra가 실제로 도달한 방향 (구현 전 중단):

1. **홈**: 준비된 상품만 — 리드 1(대형) + 서포팅 2 + 조용한 1의 편집형 비대칭 구성. 카운트다운 약화, 큐레이션 서사 전면. 상품명은 사실 보존형 표시 라벨.
2. **PDP**: 하나의 시각 무대가 챕터에 따라 컨텍스트만 교체(대표 크롭→각도 뷰→핏 전신→소재 오브젝트→디테일 크롭). 수동 뷰 선택이 우선. 모바일은 미디어를 각 그룹 앞에 배치.
3. **모션**: 뷰/챕터 전환 크로스페이드 180~240ms만, 수동 선택과 연동. passive 텍스트에 모션 없음.
4. **Glass**: 단일 sticky 읽기 레일 + 옵션 상태 전환만. 정적 blur 제거.
5. **구매**: lib/experience.ts의 purchaseState(ready/choose/soldout/unconfirmed)로 정직 분기. 원시 color 값 주문까지 전달. 재고 미확정은 CS 문의 유도(허위 재고 금지).
6. 5개 검증 관문: 재고 데이터 확보 전 구매버튼 활성 금지 / 모바일 CS 겹침 해소 / 키보드 진입 / 대비 개선 / M-55 이미지 소스.

## 17. Unfinished Work

Astra가 완료하지 못한 것 (완료된 것처럼 꾸미지 않음):

- 홈·PDP 실제 구현 — lib/experience.ts 로직과 테스트만 존재, 화면 미연결.
- 이미지 6샷의 프런트 바인딩(각 제품 슬롯 매핑) — 미실행.
- Liquid Glass 레일·FOG DEPTH의 신규 구현 — 설계만.
- 데스크톱 히어로 크기·모바일 cs-fab 겹침 수정 — 미실행.
- 빌드·브라우저 QA 반복 — 미실행 (그 시점 tsc --noEmit은 통과).
- 원본 Visual Constitution 스킬/PNG 원본 위치 미발견 — 텍스트 문서만 확보됨.

## 18. ZCode Immediate Starting Point

1. `docs/N1_REDESIGN_MISSION.md` (저장소 내) 와 본 문서를 먼저 읽을 것.
2. 브랜치 `n1-editorial-experience-v2` (HEAD 12ef45a + lib/experience.ts·tests 미커밋)에서 시작. 재조사 금지.
3. 1순위 구현: PDP 미디어 바인딩(기존 6샷 → 챕터별 소스 교체) + 홈 편집형 컬렉션(lib/experience.ts의 selectCollection 사용).
4. 2순위: purchaseState 기반 구매 분기 + 원시 color 전달 + cs-fab 겹침 수정.
5. 모션은 §11 토큰만. 데이터 공백은 §15 원칙대로 표시.
6. 민감 작업(시트·배포·크리덴셜)은 ZCode → HERMES Master 에스컬레이션.
