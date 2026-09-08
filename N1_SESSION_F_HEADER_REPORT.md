# N°1 — SESSION F · HEADER CATEGORY FINALIZATION REPORT (TASK 7)

- **Date:** 2026-09-09
- **Scope / ownership:** HEADER CATEGORY NAV ONLY (home `collection-nav` category group)
- **Project:** `Documents/n1-storefront` (Next.js 14.2.15 app router)
- **Files touched:**
  - `app/page.tsx` — category group state + JSX
  - `app/globals.css` — `.collection-nav` layout, `.gtab-brand` removal
  - `app/product/[id]/page.tsx` — "N°1 전체 상품 보기" link destination
- **Files NOT touched:** `components/SiteHeader.tsx`, `components/AuthNav.tsx`, `app/glass-lab/*`,
  all `--n1-glass-*` (C Perfume) material tokens, global font-size (금지 항목 — 변경 0건)

---

## 1. CATEGORY — N°1 제거, 최종 4개 ✅

**최종 카테고리 그룹:** `전체 · 남성 · 여성 · 젠더리스`

- `app/page.tsx`의 `data-tab="home"`(N°1) 버튼 삭제.
- `GenderKey` 타입에서 `"home"` 멤버 제거 → `"all" | "male" | "female" | "genderless"`.
- `GLASS_TABS`에서 `"home"` 제거 → 렌즈 destination이 순수 카테고리 4개만.
- 파생 분기 정리: `scope`(전체 조건), `collection-sub` 문구 조건, `changeTab`의
  `home` 스크롤 투탑 분기 제거.
- 잔존 참조 0건 확인 (`grep gtab-brand` / `grep '"home"'` → no match).

## 2. N°1 = 별도 브랜드 NAVIGATION ✅

N°1은 카테고리가 아니며, 기존 브랜드 내비가 그 역할을 유지한다 (변경 없음·확인만):

- **홈:** hero 브랜드 블록(`.hero-brand` — N°1 / 44 Pieces · 20 Outfits).
- **그 외 페이지(PDP 등):** `SiteHeader` 중앙 브랜드 블록 → 클릭 시 `/` (brand home).

## 3. CENTER — PC 실제 시각 중앙 ✅ (hard-coded translate 없음)

**기법:** `.collection-nav`를 flex → **`display: grid; grid-template-columns: 1fr auto 1fr`**
으로 전환. 카테고리 트랙은 column 2(`auto`), 스마트 핏은 column 3 우측 정렬.
좌우 유틸리티 폭과 무관하게 트랙이 남은 여백의 정확히 한가운데에 놓인다.
translate/보정치 하드코딩 일체 없음.

**측정 검증** (`track.center` vs `clientWidth/2`):

| viewport | clientWidth | content center | track center | Δ |
|---|---|---|---|---|
| 1440×900 | 1425 | 712.5 | 712.4 | −0.1px |
| 1024×768 | 1009 | 504.5 | 504.4 | −0.1px |
| 768×1024 | 753 | 376.5 | 376.4 | −0.1px |

- 스마트 핏은 column 3 우측 끝(4vw 패딩 라인)에 정렬됨 — 데스크톱 그리드에서
  `margin-left:auto`가 그대로 동작하므로 모바일 flex 폴백과 규칙 공유.
- **≤640px 모바일 폴백:** 기존 UX 유지 — `display:flex; justify-content:flex-start`
  왼쪽 흐름 + (필요 시) 가로 스크롤, 스마트 핏 우측 고정.

## 4. ALL PRODUCTS LINK — 항상 '전체' ✅ (home 아님)

- `app/product/[id]/page.tsx`: `N°1 전체 상품 보기` 링크 `href="/"` → **`href="/?tab=all"`**.
- 홈 마운트 이펙트가 `?tab=` 파라미터를 **저장된 탭(localStorage `n1_gender_tab`)보다
  우선** 처리. `tab=all`이면 (1) `전체` 강제, (2) 저장 키 삭제, (3) `replaceState`로 URL 정화.
- **클릭through 검증:** PDP에서 저장 탭을 `male`로 시딩 → 링크 클릭 → 착지
  `activeTab=all`, `stored=null`, `URL=/` (정화), collection-sub = 전체 요약 문구 ✅
- 기본 복원도 정상 유지: 저장 `female` → `/` 진입 시 `여성` 복원 ✅ (브랜드 진입은
  기존 UX 그대로 — 저장 탭 존중).

## 5. GLASS — C Perfume Lens 기능/재질 유지 ✅ (새 재질 없음)

- `.gtab-lens`의 C Perfume 재질(`--n1-glass-*` canonical tokens, Glass Lab 319d2ba 채택)
  **한 줄도 수정하지 않았다.** 새 Glass material 없음.
- 드래그-스냅 인터랙션 로직 불변. `GLASS_TABS`에서 `home` 제거로 렌즈가 N°1을
  destination으로 삼지 않는다 — interaction 의미가 "렌즈 = 카테고리 선택"으로 일치.
- **배치 수치 검증(4탭 전체):** 렌즈 중심 − 활성 탭 중심 Δ ≤ 0.6px
  (all −0.2 / male −0.6 / female 0.0 / genderless −0.4), 라벨 폭 기반 가변 폭 동작 확인.
- `syncLens`의 `전체` 폴백은 비정상 상황 방어용으로 유지(주석 갱신).

## 6. RESPONSIVE — header only QA (1440 / 1024 / 768 / 390 / 375) ✅

| viewport | 결과 |
|---|---|
| 1440×900 | 4카테고리 중앙 + 스마트 핏 우측, 렌즈 정상. pass |
| 1024×768 | 정중앙(Δ0.1px). pass |
| 768×1024 | 정중앙(Δ0.1px) — 데스크톱 그리드 유지(>640). pass |
| 390×844 | 모바일 flex: 왼쪽 흐름, 카테고리 4개+스마트 핏이 **가로 스크롤 없이** 수용. pass |
| 375×667 | 동일, scrollWidth == clientWidth (360). pass |

- 비고: 390/375에서 `젠더리스`·`스마트 핏` 라벨이 2줄로 wrapping — 기존 `.gtab` 동작이며
  N°1 제거로 공간이 늘어난 상태. 클림핑/오버플로 없음.
- **Global font-size 수정 0건** (규칙 준수).

## 7. 환경 / 운영 노트

- **dev server 교체:** port 3000의 기존 hermes 기동 서버(PID 17772)가 응답 없는
  freeze 상태였다(≤45s 무응답 확인). 재기동 과정에서 `/_not-found` 컴파일 후 API 404
  파생 → `.next` 삭제 후 `next dev -p 3000` 클린 재기동. 현재 `/`·`/api/products` 200.
- **Typecheck:** `npx tsc --noEmit` — 헤더 관련 파일 오류 0건. 기존(lib) 오류 2건은
  세션 무관 pre-existing: `lib/idempotency.ts:76`, `lib/stock/normalize.ts:200,212`.
- **내장 브라우저(IAB) 한계:** 이 QA 환경의 Chromium은 강제 프레임 사이 CSS transition
  시계가 동결되어 렌즈 240ms 전환이 시각적으로 진행되지 않는다. 코드 검증은 CSSOM
  목표값 + rect 수치로 대체했으며(위 §5), 실제 브라우저의 전환은 기존 C Perfume
  동작 그대로이다. 전환 자체는 본 세션 이전부터 존재하는 코드(미수정).
- 스크린샷 증적: 1440 전체/1024/768/390/375 full-viewport 캡처 완료 (본 세션 브라우저 산출).

---

**결론:** 7개 요구사항 전부 충족. N°1은 브랜드 내비로 분리, 카테고리 그룹은
`전체 · 남성 · 여성 · 젠더리스` 4개가 PC에서 실제 시각 중앙에 놓이며,
'N°1 전체 상품 보기'는 어떤 저장 상태에서도 '전체' 컬렉션으로 착지한다.

**STOP.**
