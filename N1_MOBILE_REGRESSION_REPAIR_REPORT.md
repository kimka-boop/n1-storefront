# N1_MOBILE_REGRESSION_REPAIR_REPORT.md

> **N°1 MOBILE UX REGRESSION REPAIR — STICKY UTILITY + CUSTOMER CENTER ZOOM + SMART FIT RESTORE**
> 실행: 2026-09-10 · ZCode (engineering + browser/mobile QA) · HERMES 제품데이터 계층 감사 결과와 대조(§24)
> 선행: 프로덕션(n1pieces.com) 모바일 에뮬레이션 재현 → 이슈 장부(`N1_MOBILE_REGRESSION_LEDGER.md`) → 일괄 수리 → 로컬 QA(JOURNEY A–D, 320–640 폭 스윕, PDP 9종) → **배포 후 프로덕션 실측 재검증**.
> 릴리스: `17c420e` (이번 커밋 — 모바일 회귀 수리. 직전 `9a388f2` 결제 아키텍처 포함 스트림) · GitHub → Vercel → **n1pieces.com**
> 재현/QA 도구: `repro/` (Playwright Chromium iPhone emulation 320–640, DSF 2–3, touch). 네이티브 에뮬레이터 시도 안 함(§25 — Owner 실기기 증거 권위 + responsive Chromium).

---

## STICKY UTILITY

**Root cause**: `UtilityDock`은 `position: fixed` 상수 좌표(top 10, 38×71)뿐이었다 — CATEGORY_DOCKED_STATE가 코드에 존재하지 않았다. 카테고리 내비(sticky, 밴드 0–66 · track 11–55)가 stuck이 되어도 글래스는 상단 헤더 자리에 남아 밴드와 70px 수직 괴리.

**Fix**:
- 내비 직전 0높이 sentinel(`.cat-sticky-sentinel`) + **IntersectionObserver** — sentinel 가시성 소실 순간 = stuck(기하 판정, scrollY 매직넘버 불사용) → `html.n1-cat-stuck` 토글.
- **HEADER_STATE**(38×71, top 10) ↔ **CATEGORY_DOCKED_STATE**(34×55, top 5 — 밴드 상하 경계 안쪽 광학 정렬, 버튼 26×2+디바이더, 아이콘 0.72 스케일, `::after` 히트영역 확장). 재질·디바이더·아이콘 중앙 유지.
- **점프 0**(§21): fixed 요소의 시각 상태 전이만 — 문서 레이아웃·스크롤 불변. 콘텐츠 기준점 문서좌표 이동 **0.00px**, stuck 토글 **1회**(저속 20px 스텝 스캔).
- **트랙 예약(§4)**: 도킹 독(10–44px)이 어떤 폭에서도 '전체'와 무겹침 — 모바일 탭 간격을 사장된 gap:4px 의도의 정준화로 12px, 카운트 비표시 임계 400→460px, ≤340px 패딩·간격 압축. stuck 시점 레이아웃 변경이 없으므로 점프·흔들림 없음. 실측 여유: **320:+10.2 / 360:+13.5 / 375:+21 / 390:+28.5 / 430:+48.5 / 462:+7.4 / 640:+96.4px**.
- **렌즈(§5)**: 폭 = 라벨(+카운트) 폭 + 정준 패딩 20px, zone(이웃 중점 경계) 94% 경질 상한 — 기존 88px 최소폭 강제가 이웃 침범을 만들었다(전체 활성 시 남성 텍스트와 15.8px 겹침). 이제 인접 간격 **13.6–16.2px 일관**, 전 탭 무접촉·트랙 내.

**Real scroll validation: PASS** (프로덕션: dock 5–60 ∈ band 0–66, track 11–55 정렬 · 드래그 전체→남성 ✓ 젠더리스→전체 ✓ 경계 드래그 오버플로 0.3px 이내)

## CUSTOMER CENTER ZOOM

**Root cause**: `globals.css`의 모바일 입력 16px 블록(§6·§7A)이 **닫히지 않은 주석**에 흡수되어 사장 — `.cs-input-row input`가 13.5px(`var(--t-body)`)로 렌더되어 iOS Safari 포커스 자동 줌 트리거. (검색창은 별도 라이브 규칙으로 16px였음 — 재현 계측과 정합.)

**Fix**: 주석 폐쇄 — 16px 블록 부활(`.order-input`·`.checkout-fields input`·`.lq-input`(로그인/회원가입/비밀번호)·**`.cs-input-row input`**·`.option-select`). viewport는 Next 기본값 그대로 — `user-scalable=no`/`maximum-scale` **불사용**(핀치줌 유지).

**Effective mobile input font**: **16px** (프로덕션 실측 `getComputedStyle` = 16px · 포커스 후 `visualViewport.scale` = 1)

**Focus zoom: PASS** (16px 미달 입력 0 — iOS 줌 트리거 조건 부재)
**Keyboard-aware movement: PASS** (`--cs-kb` visualViewport 실측 → 키보드 300px 등장 시 창 상승+축소, 입력·전송 가시 / 키보드 해제 시 220ms 전이로 복귀. A(줌 없음)와 B(키보드 재배치) 독립 PASS — §9)

## SMART FIT

**Root cause (3층 계약 추적)**:
1. **Master(Products 시트)**: 실측·모델정보 UNKNOWN **60/60** — 공급사(도매꾹)가 측정치를 구매자 세션 AJAX로만 제공(정적 수집 불가, `dg_detail_scan.json` 실측). HERMES 필수필드 감사(`N1_PRODUCT_DATA_REQUIRED_FIELD_AUDIT.csv`)와 정합 → **소스 한계, 파이프라인 드롭 아님**.
2. **API**: faithful — 시트 `실측사이즈`/`모델정보`를 그대로 UNKNOWN으로 전달(필드 누락 없음).
3. **PDP 렌더 조건 회귀**: `modelInfo || sizeChart || fitInterp` 게이트 — 측정 데이터 전량 UNKNOWN + 게스트 신규 세션(프로필은 sessionStorage 전용, Session A §6 계약) → 조건 전체 거짓 → **핏 섹션 무음 삭제**. 분류: `PDP_CONDITIONAL_RENDER_BROKEN`.

**Fix**: 핏 섹션을 **무조건 렌더**. 프로필 없는 게스트에는 readiness 상태 — "선호하는 핏과 평소 사이즈를 알려주시면 이 상품을 나에게 맞게 읽어드려요" + (수치표 미비 상품) 정직한 한계 문구 + **"스마트 핏 →" CTA**(PDP 로컬 SmartFitFlow — 상품 컨텍스트 전달). 프로필 있으면 기존 4층 해석(FACT → CONTEXT → INTERPRETATION → LIMITATION) 그대로. 표시 문자열은 전부 `interpretFit` 계약 산출물 — 하드코딩 핏 텍스트 0건(창작 금지 준수).

**Master data**: PASS (계약상 사용 가능한 데이터 전부 도달 — 측정치 자체가 소스에 없음은 공급사 한계로 고지)
**API**: PASS (필드 무손실)
**PDP**: PASS (게스트 readiness + 프로필 보유 시 해석 렌더 — 프로덕션 실측)
**Persistence**: PASS (게스트 sessionStorage · 회원 localStorage+Users시트 계약 유지. 상품 전환 시 재계산 ✓ 새로고침 유지 ✓ 계정 간 누수 없음 — Session A/J 아키텍처 불변)

## MOBILE LAYOUT

**Header**: 두 행 좌표계 유지(유틸리티 행 → 중앙 브랜드). "스마트 핏 **· 설정됨**"의 상태 표기를 0.8em·옅은 톤 종속 요소(`.auth-fit-state`)로 강등 — 로그인/회원가입과 동등 위계처럼 보이던 것 해소(§13). 브랜드 중앙: 데스크톱 오프셋 **0.0px**.
**Category**: 4탭 전 폭 완전 가시(320–640) · 렌즈 간격 일관 · 드래그·스냅·탭 전 경로 PASS · 카운트는 ≤460px에서 라벨만(카운트 정보는 컬렉션 요약 줄이 담당).
**Vertical rhythm**: 검색→코디 헤딩 36→**20px**, 헤딩→상의/하의 58→**34px**, 상의/하의→첫 row 40→**24px** (+컬렉션 헤드 36→20, 페어 그룹 간 40→24). 에디토리얼 그룹핑 유지 — 마켓플레이스 밀도 아님(§14·§18).
**Pair section**: 헤딩↔카드 결속(24px) · 좌우 카드 상단 정렬·동일 이미지 높이(3:4 고정 컨테이너 + object-fit cover — 소스 비율이 행 높이를 흔들지 않음 §20) · 카운트 **데이터 구동**: 전체 17 / 남성 8 / 여성 6 / 젠더리스 3 = API pairs·행 수와 정합, 이중계수 없음(§19).
**Product cards**: 2열 유지 · name 13→**14px** · price 12.5→**13px** · eyebrow 10px — 확대 없이 가독(§17).

## REGRESSION

**Color**: PASS — 원시 값 칩 선택(프로덕션 JOURNEY D)
**Size**: PASS — 재고 파이프라인 사이즈 병합 경로 유지(데이터 있을 때만 행 렌더 — 소스 미제공 시 생략은 기존 계약)
**Cart**: PASS — 색상 선택 → 장바구니 담기 → 드로어 오픈 + 라인("블랙 셔츠") — 실결제 없음
**PDP**: PASS — 남2/여2/젠더리스2+하의 각1 총 9종 스윕: 이름·가격·왜 이 상품인가·핏(readiness/해석)·상품 정보(교환·반품·문의)·함께 보기 전 확인, UNKNOWN 노출 0건

## PRODUCTION

**URL**: https://n1pieces.com/
**Verified**: **YES** — 배포 CSS에 `n1-cat-stuck`/`auth-fit-state`/16px 블록 확인 + 프로덕션 실측(폭 스윕 5폭 · JOURNEY A–D · 데스크톱) 전 항목 PASS. 스크린샷: `repro/prod-out/`(P_03_DOCKED_390 · P_08_CS_FOCUSED · P_09_PDP_FIT_GUEST · P_10_CART) + 로컬 검증 세트 `repro/qa-out/`(요구 10컷 + 375/430 변주 + 밴드 클로즈업).

## REMAINING DEFECTS

1. **측정 데이터 공백(구조적)**: 실측 수치표·모델정보 UNKNOWN 60/60 — 공급사 AJAX 전용. HERMES가 측정치를 스테이징하면 PDP 수치표·sizeHint가 파이프라인 그대로 흡수(창작 금지 준수, 현재는 한계 문구로 정직하게 노출).
2. **Sheets 읽기 쿼터**: 연속 고속 페이지 전환 시 Google Sheets 429(분당 읽기 한도) 관측 — QA 하니스 수준 부하에서만 재현. 프로덕션 일반 브라우징 여유 있으나, 카탈로그 읽기 캐싱은 후속 인프라 과제.
3. **도킹 상태 히트 타깃**: 44px 밴드 안 2단 스택의 가시 버튼 26px — `::after` 확장으로 실효 ≈38×50. 이상적 44×44에는 미달(미션 §3이 허용한 트레이드오프 범위).
4. **카운트 비표시 확대**: ≤460px에서 탭 옆 카운트 숨김(400→460). 요약 줄이 총량을 담으나 성별별 카운트는 해당 폭에서 보이지 않음.
5. **운영 노트**: 로컬 3322 서버를 수동 기동한 상태(구 supervisor 인스턴트 대체) — 재기동 시 기존 R-3 절차(`n1_supervisor.cjs`) 권장.

---

## FINAL VERDICT: **MOBILE_READY**

하드 기준(§28) 전항 통과 — 문의/장바구니 두 상태·밴드 정렬·무겹침(전 폭)·무점프 전이·드래그·4탑 가시·렌즈 일관성·젠더리스 무클리핑·CS 무줌(16px)+핀치줌 유지·키보드 대응(visualViewport)·Smart Fit 복원(실계약 데이터)·내비게이션 생존·브랜드 중앙·유틸리티 행 균형·수직 여백 축소·검색 사용성·상의/하의 가독·2열 유지·이름/가격 가독·페어 결속·데이터 구동 카운트·safe-area·다중 PDP·색상/사이즈/카트·320–430 반응형·데스크톱·프로덕션 빌드·**n1pieces.com 배포 후 실검**.
