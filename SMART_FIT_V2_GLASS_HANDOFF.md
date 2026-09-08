# SMART FIT V2 → GLASS MATERIAL INTEGRATION HANDOFF

> **이 문서의 목적**: Glass Material Lab 세션이 확정한 Liquid Glass 재질을
> Smart Fit V2에 나중에 적용할 수 있도록 필요한 구조 정보를 전달한다.
> **Glass 시각 구현 코드는 포함하지 않는다.** (Smart Fit V2 미션 §33·§40)
>
> - Smart Fit V2 branch/worktree: `n1-smart-fit-v2` @ `C:\Users\MY-PC\Documents\n1-smartfit-v2`
> - Base commit: `bd72204` — Glass Lab 세션의 `app/glass-lab/` 작업과 격리됨
> - 작성일: 2026-09-09

---

## 1. Smart Fit component structure

```
components/
  SmartFitFlow.tsx     ← 유일한 Smart Fit 서페이스 (홈·PDP 공용, 단일 모달)
    ├─ LiquidSurface   ← 공용 유리 서페이스 래퍼 (기존 커밋 코드, 재질 소유권은 Glass Lab)
    │   └─ .lq-stage   ← 단계가 바뀔 때 key로 재마운트되는 콘텐츠 슬롯
    └─ LqSeg           ← 선택 컨트롤 (thumb가 이동하는 연속 재질 선택)
lib/
  fitContext.ts        ← Fit Context 모델·저장·서버 직렬화·로그인 병합 (UI 없음)
  fit.ts               ← interpretFit 순수 엔진 (evidence·4층 결과, UI 없음)
```

호출 지점:
- `app/page.tsx` — `gtab-fit` 버튼 + story CTA → `<SmartFitFlow onClose={...} />`
- `app/product/[id]/page.tsx` — FIT chapter의 `수정하기 →` / `스마트 핏 →` 버튼 →
  `<SmartFitFlow product={fitInput} needCategory={"top"|"bottom"} />`
- PDP의 정적 Your Fit 블록은 모달이 아니라 `styles.yourFit*` (product.module.css) 렌더.
  **이 블록도 2차 glass 후보** (아래 2항).

## 2. Which component should become the main glass surface

| 우선순위 | 대상 | 이유 |
|---|---|---|
| 1 | `SmartFitFlow`의 `LiquidSurface` 인스턴스 | Smart Fit의 얼굴. 홈·PDP 모두 이 한 서페이스를 통과한다 |
| 2 | PDP `.yourFit` 블록 (product.module.css) | FIT chapter에 상주하는 개인 해석 패널 — 상주형 2차 서페이스 |
| 3 | `gtab-fit` 버튼 (`스마트 핏` / `스마트 핏 · 설정됨`) | 홈 내비의 진입 칩. `.gtab-lens` 드래그 렌즈 체계와 시각적 일관 필요 |

**제약**: `LiquidSurface`·`LqSeg`·`.lq-*` CSS는 Sign Up/Login 모달과 공유된다.
Smart Fit만의 재질 변형을 원하면 래퍼 클래스를 추가하는 방식으로 (예: `.lq-surface--fit`),
기존 auth 모달 재질을 깨지 말 것.

## 3. Option selection state (LqSeg)

- 구조: `div.lq-seg[role=group]` > `span.lq-seg-thumb(밀도 레이어)` + `button(aria-pressed)`
- 상태 소유자: `SmartFitFlow`의 React state — **DOM 직접 조작 없음** (홈 `gtab-lens`의
  드래그 렌즈와 다름). 선택 즉시 저장(`saveQuietly`)되고 다음 단계로 자동 진행한다.
- Glass가 알아야 할 것: thumb 이동은 ≈200ms transform. **선택→저장→단계 전환이 한 클릭에
  연쇄**되므로, 재질 전환 애니메이션(.lq-stage 340ms)과 겹친다. 3단계 큐잉이 필요하면
  `.lq-stage` 애니메이션을 늦추지 말고 thumb transition만 조정.

## 4. CTA states

| CTA | 위치 | 상태 |
|---|---|---|
| `lq-act` (로그인하고 기억하기) | result (게스트) | primary, disabled 없음 |
| `lq-act` (들어가기 / 가입하고 기억하기) | account | busy("확인 중...") + 유효성 disabled |
| `lq-ghost` (설정 수정 · 초기화 · 건너뛰기 · ← 결과로) | 전 단계 | text 버튼, 초기화는 2-step confirm(지우기/취소) |
| `yourFitEntry` (수정하기 → / 스마트 핏 →) | PDP | 텍스트 링크형 — glass화 시 터치타겟 44px 유지 |

## 5. Modal / surface lifecycle

```
열림: LiquidSurface FORM 420ms → 초점이 단계 제목으로 이동 (SmartFitFlow useEffect)
단계: fit → (size) → result → (account) → confirm(autoDissipate 950ms)
      · 단계 전환은 .lq-stage key 리마운트 (340ms stage 애니메이션)
닫힘: 닫기✕/ESC/백드롭 → DISSIPATE 480ms → 실제 언마운트 → 열었던 컨트롤로 초점 반환
      (reduced-motion: 즉시)
```
Glass 재질은 FORM/DISSIPATE 타이밍(420/480ms)을 바꾸지 말 것 — 포커스 복귀와
autoDissipate 타이머가 이 값에 맞춰 있다.

## 6. Login transition

- result → account 같은 서페이스 안에서 재질 상태만 바뀐다 (새 모달 없음).
- 로그인 성공 → confirm("기억했어요") → 자동 소멸. **실패 → 같은 단계에 role=alert 에러**,
  컨텍스트 불변.
- AuthNav(헤더)의 로그인/회원가입도 같은 `LiquidSurface`를 쓴다 — 재질은 한 번만 정의.
- Glass 적용 시 주의: account 단계는 `input.lq-input` 2~3개 — 입력 중 재질 전환/빛 번짐이
  생기면 안 된다(타이핑 방해 금지).

## 7. Result transition (evidence-driven)

result 콘텐츠는 `interpretFit`의 evidence에 따라 **길이가 달라진다** (§15 4층):

```
READY:       제목 + 요약 + PRODUCT + INTERPRETATION + sizeHint(선택) + LIMITATION
PARTIAL:     sizeHint 없음, LIMITATION에 부족 항목 문장 추가
UNCONFIRMED: PRODUCT 한 줄 + "아직 확인 중" 해석
UNAVAILABLE: 해석 한 줄 (모자 등 비의류)
```
→ Glass 박스 높이가 단계·상품마다 변함. 고정 높이 연출 금지. sizeHint는 sold-out에서
**사라진다**(구매 제안 방지) — 재질이 내용 변화를 애니메이션할 경우 레이아웃 시프트 주의.

## 8. Reduced-motion requirements

- `app/globals.css`에 `prefers-reduced-motion` 블록 존재 — `.lq-backdrop/.lq-surface/
  .lq-stage/.lq-confirm/.lq-seg-thumb` 애니메이션 1ms 처리 + LiquidSurface JS도
  reduce 시 즉시 닫기. **Glass가 추가하는 모든 모션도 이 블록에 함께 넣을 것.**
- 드래그 렌즈(gtab)와 LqSeg thumb은 reduced-motion에서 transform transition이 없어도
  기능이 온전해야 한다 (이미 충족 — 참고만).

## 9. Mobile constraints

- `.lq-backdrop` ≤640px: bottom-sheet (`align-items: flex-end`), 서페이스가 하단 고정.
  390에서 검증 완료 — CTA·ghost 버튼 모두 뷰포트 안.
- FloatingOrderTracker/CsWidget FAB(z-index 1000)보다 `lq-backdrop`(1100)이 위 —
  **FAB 위로 glass가 덮는 것이 정답.** FAB 쪽 z-index를 올리지 말 것.
- StickyBuyBar(z-index 40)와도 겹침 없음. 가상 키보드(account 단계) 열림 시 iOS
  bottom-sheet 밀림은 기존 auth 모달과 동일 동작 — Glass에서 overflow 정책 바꾸지 말 것.
- `.yourFit` 블록(PDP)은 모바일에서 수치표 바로 아래 — glass 패딩 늘리면 스크롤 길이 주의.

## 10. DO NOT BREAK list

1. `/api/auth` 계약 `{action, email, password, profile:{gender,size,fit}}` — 변경 금지
   (fitContext.ts의 encode/parse가 유일한 경계).
2. `n1_fit_profile` localStorage 키 + v1 마이그레이션 — 키 이름/형식 변경 금지.
3. 로그인 병합 정책(`mergeOnLogin`): 서버 우선, 게스트 승격, 실패 시 무변경 — UX 계약.
4. interpretFit의 금지 문구 규칙: 점수/%/AI 과시/확정 호수/미확인 신축성/품절 구매 프레임 —
   테스트(tests/fit.test.cjs)가 감시한다. 카피 변경 시 테스트 동시 수정.
5. PDP FIT chapter 순서: 상품 FACT(수치표·모델) → Your fit(개인 해석) — 역전 금지.
6. 게스트는 질문 없이 Smart Fit 사용 가능 — 로그인 선행조건화 금지.
7. 초기화 경로가 항상 result에 존재할 것 (§27).
8. LiquidSurface의 초점 트랩/ESC/초점 반환 — Glass 리팩터링에서 행동 보존 필수.
9. 단계 진입 시 제목 포커스(스크린리더 안내) 유지.
10. `SmartFitFlow`는 홈( product 없음)과 PDP(product+needCategory) 양쪽에서 재사용 —
    props 계약(`onClose, product?, needCategory?`) 유지.

---

### 검증 상태 (2026-09-09)
- 단위 테스트 31/31 통과 (fit 19 · fitContext 9 · experience 3), `tsc --noEmit` clean
- 브라우저 QA: 게스트 setup→결과, 상·하의 점진 질문, PDP 상주 해석(READY/PARTIAL/
  UNCONFIRMED/UNAVAILABLE), 실패·성공 로그인 병합, 회원가입 재사용, 수정·초기화,
  390/768/1440 레이아웃, 포커스 트랩 — 모두 통과 (docs/SMART_FIT_V2_AUDIT.md 참조)
