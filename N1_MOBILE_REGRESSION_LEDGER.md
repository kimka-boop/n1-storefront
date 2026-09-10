# N1_MOBILE_REGRESSION_LEDGER.md

> **N°1 MOBILE UX REGRESSION REPAIR — 이슈 장부 (재현·근거 기록)**
> 작성: 2026-09-10 · ZCode (engineering arm)
> 재현 대상: production `https://n1pieces.com` (release `5d951c8`) — Playwright Chromium iPhone emulation 390×844, DSF 3, touch
> 코드 대조: local RC `C:\Users\MY-PC\Documents\n1-storefront` @ `9a388f2` (production과 PDP/홈/CSS 차이 없음 — payment architecture 분은 미배포이나 본 이슈 무관)
> 주인 실기기 스크린샷은 권위 있는 재현 증거로 취급(§0) — 아래 전 항목 코드·계측으로 교차 확인.

---

## 재현 계측 요약 (production, 390×844)

| 측정 | 값 |
| --- | --- |
| `.util-dock` (header state) | fixed top 10–81, left 10–48 (38×71) |
| `.collection-nav` stuck 시 | top 0–66 (track 11–55, 44px) |
| stuck 시 dock vs band | dock bottom 81 vs band top 0 → **수직 괴리 -70px** (밴드 밖으로 26px 돌출) |
| 렌즈 폭 (전 탭 공통) | **88px 고정** (min-width 지배) |
| 전체 활성 렌즈 | 51.5–139.5 → 남성 텍스트(123.7–)와 **15.8px 겹침** |
| 탭 간 버튼 간격 | 26/26/26 (일관 — 렌즈가 문제) |
| `.cs-input-row input` font | **13.5px** (`var(--t-body)`) — 16px 미달 |
| `.collection-search input` font | 16px ✓ (별도 라이브 규칙) |
| PDP 핏 섹션 (게스트 무프로필) | **렌더 없음** — headings: 왜 이 상품인가/구매/상품 정보/함께 보기 |
| PDP 핏 섹션 (프로필 설정) | 정상 렌더 — 4층 해석 전체 출력 |
| 수직 간격 (모바일) | 검색→코디 eyebrow 36px · eyebrow→상의/하의 58px · 상의/하의→첫 row 40px |
| `.pair-head span` (상의/하의) | color `#a8a49c` (paper 대비 ≈2.2:1) — 과도히 옅음 |
| 카드 타이포 (모바일) | name 13px · price 12.5px · eyebrow 9.5px |

---

## 이슈 장부

### L1 · 스티키 문의/장바구니 독 — 도킹 없음 【§1–§4】 CONFIRMED
- **증상**: 스크롤로 카테고리 셀렉터가 sticky가 되어도 유틸리티 글래스는 좌상단 header 위치에 그대로 (top 10–81). 밴드(0–66)와 시각적 분리.
- **근거**: `repro/out/report.json` `sticky_util` vs `sticky_nav`/`sticky_track`; 스크린샷 `03_category_sticky.png`.
- **근본 원인**: dock은 `position: fixed` 상수 좌표뿐 — CATEGORY_DOCKED_STATE가 코드에 존재하지 않음.
- **수리**: sticky sentinel(IntersectionObserver) → `html.n1-cat-stuck` 토글 → `.util-dock` compact docked 형상(모바일). fixed 요소의 시각 전이만 — 문서 레이아웃 불변 → 점프 없음(§21).

### L2 · 두 시각 상태 부재 【§2】 CONFIRMED
- HEADER_STATE만 존재. sentinel 기반 기하학 전이(IntersectionObserver) 도입으로 해소. scrollY 매직넘버 불사용.

### L3 · 도킹 형상 기준 【§3】 — L1 수리에 포함
- docked: 밴드(66px) 안쪽 정렬 — top 5 / height 55 / width 34, 버튼 26px×2 + 디바이더, 아이콘 축소, 히트영역 `::after` 확장. 글래스 재질·디바이더·아이콘 중앙 유지.

### L4 · 카테고리 트랙 공간 예약 【§4】 — 검증 항목
- 390에서 전체 시작 51.5 vs dock 우단 46 — 현재도 무겹침. 도킹 폭 34px 유지 시 320/360/375/390/430 전 폭 무겹침 계산·QA 확인. (레이아웃 변경 없이 중앙 정렬 여백이 자연 예약 — 점프 0 유지)

### L5 · 카테고리 렌즈 스페이싱 회귀 【§5】 CONFIRMED
- **근본 원인**: `syncLens`의 `Math.max(88, …)` 최소폭이 zone 상한(~69px)보다 커서 전 탭 렌즈가 88px로 강제. 첫/끝 탭 zone은 반원(중점 경계)이라 이웃 영역 침범.
- **수리**: 렌즈 폭 = 라벨 폭 + 정준 패딩(+24px), zone×0.94 경질 상한, 위치는 zone 경계 내 클램프. 미사용 시 렌즈 가장자리↔이웃 버튼 간격 항상 14px(26−12).

### L6 · 카테고리 드래그 【§6】 — 코드 무손상(포인터 캡처+스냅). L5 수리 후 전 전이 재검증.

### L7 · 고객센터 포커스 줌 【§7】 CONFIRMED — **근본 원인 확정**
- `app/globals.css:1364` — `/* ── §6·§7A 모든 고객 입력 필드 … ──` 주석이 **닫히지 않음**(`*/` 누락). 다음 `*/`(1377행)까지 통째로 주석 처리되어 모바일 16px 폰트 블록(.order-input/.checkout-fields input/.lq-input/**.cs-input-row input**/.option-select)이 **전부 사장**.
- 결과: CS 채팅 입력 13.5px 렌더 → iOS Safari 포커스 자동 줌. (검색창은 1355행 별도 라이브 규칙으로 16px — 재현 계측과 정합.)
- **수리**: 주청 닫음(`*/`)만으로 블록 부활. viewport meta는 Next 기본값(핀치줌 허용, maximum-scale 없음) — 접근성 해킹 불요·불사용.

### L8 · 키보드 인식 위치 【§8】 — 아키텍처 존재(CsWidget `--cs-kb` + visualViewport 실측), 유효성 QA에서 독립 판정. 모바일 창 높이 산식에 `--cs-kb` 반영 + 복귀 transition 추가로 완성.

### L9 · 줌 vs 키보드 시프트 구분 【§9】 — QA에서 A(포커스 줌 없음)·B(리사이즈 재배치) 독립 PASS 필요.

### L10 · Smart Fit / 핏 정보 소실 【§10】 CONFIRMED — **근본 원인 확정**
- **재현**: 게스트(프로필 없음) PDP → 핏 섹션 완전 부재(`hasFitSection: false`). sessionStorage에 프로필 주입 → 즉시 정상 렌더("내가 설정한 치수 / 세미오버 선호 · 평소 상의 105 / 해석 / 리미테이션").
- **근본 원인 (계층별)**:
  1. **Master 데이터**: 실측·모델정보 UNKNOWN 60/60 (N1_PRODUCT_DATA_REQUIRED_FIELD_AUDIT — 공급사(도매꾹) 구매자 세션 AJAX 전용, 정적 수집 불가. `dg_detail_scan.json` 실측 근거).
  2. **API**: faithful (시트 `실측사이즈`/`모델정보` → 그대로 UNKNOWN). 드롭 아님.
  3. **PDP 렌더 조건 회귀**: `clean(modelInfo) || clean(sizeChart) || fitInterp` — 측정 데이터 전량 UNKNOWN + 게스트 신규 세션(프로필 sessionStorage 전용, Session A §6 계약) → 조건 전체 거짓 → **섹션 무음 삭제**.
- **회귀 분류**: `PDP_CONDITIONAL_RENDER_BROKEN` (+데이터 전제 `PRODUCT_MEASUREMENTS_MISSING` — 소스 한계, 파이프라인 결함 아님).
- **수리**: 핏 섹션 무조건 렌더 + 프로필 없으면 readiness 상태(스마트 핏 설정 CTA + 정직한 한계 문구). 하드코딩 핏 텍스트 금지 준수 — 표시되는 모든 값은 interpretFit/engine 산출물.

### L11 · 요구되는 핏 정보 형태 【§11】 — L10 수리에 포함 (충분 시 해석, 불충분 시 readiness).

### L12 · 핏 상태 내비게이션 생존 【§12】 — 아키텍처 게스트=sessionStorage / 회원=localStorage+Users시트(계정 재바인딩) 검증 완료. QA JOURNEY C로 실측.

### L13 · 헤더 상단 유틸리티 그룹 【§13】 CONFIRMED
- `스마트 핏 · 설정됨`이 로그인/회원가입과 동일 톤·크기의 auth-link — 상태가 내비 항목처럼 보임.
- **수리**: "스마트 핏" 링크 + `· 설정됨`을 종속 상태 표시(작게·옅게·별도 클래스)로 강등. 브랜드 중앙은 기존 grid/2행 좌표계 유지.

### L14 · 수직 리듬 과다 【§14】 CONFIRMED — 계측값 상단 표. 모바일 전용 간격 축소: collection-head 36→20, eyebrow 18→10, pair-collection gap 40→24, collection 상단 36→28. 마켓플레이스 밀도 아님 — 에디토리얼 그룹핑 유지.

### L15 · 검색 컨트롤 감각 【§15】 — 텍스트+헤어라인만으로 정적 텍스트처럼 보임. 돋보기 글리프 + 휴식/포커스 라인 강화(미니멀 유지, 16px 유지).

### L16 · 상의/하의 라벨 대비 【§16】 CONFIRMED — `#a8a49c` → `#6f6c63` + 11px. 상품명보다 조용하나 가독.

### L17 · 카드 타이포 과소 【§17】 CONFIRMED — 모바일 name 13→14px, price 12.5→13px, eyebrow 9.5→10px. 2열 구조·이미지 크기 불변, 저우선 메타는 카드에서 계속 억제.

### L18 · 페어 섹션 결속 【§18】 — L14 간격 축소로 헤딩↔카드 결속. pair-head 열 정렬은 기존 grid 1fr 1fr + 카드 column-gap 동일 값 유지.

### L19 · 카운트 일관성 【§19】 — `추천 코디 N쌍` = `pairRows.length`(API pairs 17, 젠더리스 스코프 필터 3). 하드코딩 없음·pairId 키 중복 없음·used-set 이중계수 방지. QA에서 탭별 실측 대조.

### L20 · 이미지 일관성 【§20】 — `.piece-media` aspect-ratio 3/4 + overflow hidden + object-fit cover·object-position 50% 22% — 기하 불변 확인. 소스 비율이 행 높이를 흔들지 않음(구조 검증).

### L21 · 스크롤 전이 점프 【§21】 — hero handoff는 transform/opacity 전용(기존). dock 상태 전이는 fixed 요소 시각 전이만 → 레이아웃 0 변화. 저속 스크롤 경계 QA.

### L22 · 세이프 에어리어 【§22】 — viewport 기본값(cover 아님) → env()=0, 스티키 컨트롤이 크롬 아래 위치하지 않음. 방어적으로 `top: env(safe-area-inset-top,0)` 부여. `--n1-fab-bottom`은 이미 env 반영.

### L23 · PDP 회귀 점검 【§23】 — QA에서 MEN/WOMEN/GENDERLESS 각 2+ TOP/BOTTOM 포함 점검.

### L24 · 핏 데이터 파이프라인 (HERMES 협조) 【§24】 — L10의 계층별 판정이 곧 HERMES 제품데이터 계층 감사 결과와의 대조(N1_PRODUCT_DATA_REQUIRED_FIELD_AUDIT.csv 60/60 UNKNOWN_ALLOWED, domeggook AJAX 전용 실측 근거). Master에 없는 측정치로 핏 창작 금지 준수.

---

## 수정 배치 (한 번에)

1. `UtilityDock` 두 상태 + sentinel(IntersectionObserver) + docked CSS — L1·L2·L3·L21
2. globals.css 주석 닫힘 수정(16px 블록 부활) — L7
3. `.cs-window` 모바일 높이 `--cs-kb` 반영 + 복귀 transition — L8
4. PDP 핏 섹션 무조건 렌더 + readiness 상태 — L10·L11
5. `syncLens` 정준 패딩+zone 상한 — L5·L6
6. AuthNav 종속 상태 표시 — L13
7. 수직 리듬 모바일 축소 — L14·L18
8. 검색 어포던스 — L15
9. 상의/하의 대비 — L16
10. 카드 타이포 — L17
11. safe-area 방어 — L22

검증: JOURNEY A–D + 320/360/375/390/430 + 데스크톱 회귀 + 프로덕션 빌드 후 n1pieces.com 실측.
