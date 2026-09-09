# N1_SESSION_J_PERSONALIZATION_INTEGRATION_REPORT.md

> **SESSION J — N°1 PERSONALIZATION FULL INTEGRATION** · 2026-09-09
> 브랜치: **`n1-personalization-integration`** (base = `7d15622` — Session I 완료 상태, HEAD `c9726a9`)
> 범위: **TASKS 9·27·28** — PDP 치수 문구, Pair × Smart Fit, 게스트 여정·회원 복원 통합.
> 결과: **테스트 183/183 PASS (J1–J10 신설 12 포함) · `tsc --noEmit` clean · `next build` ok ·
> 런타임 스모크 7항목 + 브라우저 실측 4항목 통과 · 시트 write 0건 · 신규 API 0건 ·
> HERMES 소관 변경 없음(기존 계약 재사용만).**

---

## 0. 요약 — 무엇이 만들어졌나

1. **PDP 치수 문구(TASK 9)** — Your fit 블록의 "내 설정 — 정핏 선호 · 평소 상의 105" 접두사
   형태를 폐지하고, 라벨 **"내가 설정한 치수"** + 값 두 줄로 분리했다. 값은
   `interpretFit.yourContext`("정핏 선호 · 평소 상의 105")를 그대로 쓴다 — 새 문구 창작 0.
2. **Pair × Smart Fit(TASK 27)** — E의 사전 계산 pair mapping(CatalogPair 계약)의
   상·하의를 **같은 User Fit Context로 각각** 해석한다(`lib/fitDisplay.pairFitViews`).
   Top A → result A, Bottom B → result B. **페어 전체에 하나의 사이즈를 추천하는 함수·표현은
   존재하지 않는다.** 페이지뷰 시점 계산은 순수 함수 `interpretFit`뿐(NO LLM ON PAGEVIEW 유지).
3. **Pair display context(TASK 28)** — 홈 pair row 카드 34장 전부에 상품별 개인화 라인
   (`{yourContext} — {interpretation}`, 조용한 metadata 톤)이 연결된다. PDP "함께 보기"의
   짝 상품에도 같은 라인. 근거 없는 exact recommendation 금지 준수 — 정밀 사이즈
   안내(sizeHint)는 PDP 4층 해석(근거 READY일 때만)에 그대로 머문다.
4. **게스트 마스터 여정·회원 복원 통합** — Guest → Smart Fit → Pair browse → Top/Bottom
   result → Add Cart → Sign Up → Member 여정의 6대 불변식(Fit·Cart·route·product 보존,
   member Fit persisted, guest Fit not separately persisted)이 기존 A·C 계약 위에 그대로
   성립함을 검증·잠갔다. 유일한 실제 결함 1건을 고쳤다: **logout이 화면 상태(fit)를 게스트
   경계로 되돌리지 않아** 마지막 계정의 핏이 로그아웃 직후 게스트에게 개인화로 보이던 것.
5. **인증 중단 무결성** — 인증 표면(SmartFitFlow·AuthNav·AuthProvider)은 전부 모달 기반으로
   내비게이션 계층 자체가 없다(소스 잠금). 강제 HOME reset 경로 부재를 전수 검증.

## 1. TASK 9 — PDP COPY ("내가 설정한 치수")

| 항목 | 기존 | 변경 |
| --- | --- | --- |
| 라벨 | (없음 — 접두사 "내 설정 — ") | **내가 설정한 치수** (`MY_DIMENSIONS_LABEL`) |
| 값 | yourContext와 한 줄 접속 | 별도 줄에 `fitInterp.yourContext` 그대로 |

렌더 결과(브라우저 실측, PRD-N1-03):

```
YOUR FIT
아직 확인된 핏 정보가 부족해요.          ← productFact
내가 설정한 치수                          ← 라벨 (신규)
정핏 선호 · 평소 상의 105                 ← 값
선호하시는 것보다 여유가 많은 실루엣이에요. ← interpretation
실측 수치표가 아직 준비 중이라 …           ← limitation
```

- 구 "내 설정 — " 접두사는 PDP 빌드 산물·소스 전체에서 잔존 0(테스트 잠금).
- 4층 구조(FACT → CONTEXT → INTERPRETATION → LIMITATION)와 문구 원문은 불변 —
  라벨 분리만. CSS는 기존 yourFit 계열 톤에 맞춘 2클래스 신규(`.yourFitDimsLabel`·
  `.yourFitDims`), 기존 스타일 무수정.

## 2. TASK 27 — PAIR × SMART FIT (Top A / Bottom B, 페어 단일 사이즈 금지)

**신규 `lib/fitDisplay.ts`** (Session J 소유):

- `pairFitViews(top, bottom, ctx)` — 같은 ctx로 top/bottom **각각** `interpretFit`.
  반환은 `{top, bottom}` 슬롯별 뷰 2개뿐. 페어 통합 사이즈 뷰를 만드는 함수는 제공하지
  않는다(테스트가 소스 부재를 검사).
- `pairFitLine(interp)` — 카드용 한 줄: `"{yourContext} — {interpretation}"`.
  해석이 없거나(컨텍스트 없음) 핏 규칙 대상 밖(소품 UNAVAILABLE)이면 빈 문자열 —
  카드는 조용히 개인화 없는 상태로 돌아간다.

동작(단위 테스트 J1·J2 + 브라우저 실측):

| 슬롯 | 같은 ctx(A·상의105·하의30~31)에서 | 근거 |
| --- | --- | --- |
| Top A | "정핏 선호 · **평소 상의 105** — {상품 실루엣 비교}" | 상의 앵커(topSize)만 사용 |
| Bottom B | "정핏 선호 · **평소 하의 30~31** — {상품 실루엣 비교}" | 하의 앵커(bottomSize)만 사용 |

- 두 라인은 상품(슬롯)별로 다르고, 방향 해석은 상품별 실루엣 파싱 결과에 의존한다
  (실측: "여유가 많은" vs "한 단계 여유가 있는" 공존).
- **"이 페어는 ○ 사이즈" 같은 표현 경로 부재** — pair_reason_short(E 배치 문구)는
  코디 근거 문구일 뿐 사이즈를 말하지 않으며, 스코어·tier·confidence는 서버에서
  이미 제거된 프론트 계약을 그대로 소비한다(스모크에서 누출 0 실측).

## 3. TASK 28 — PAIR DISPLAY CONTEXT

- **홈 pair row**: 카드 캡션(이름·가격 아래)에 상품별 라인(`.piece-fit`). E의
  mapping(`/api/products` → `data.pairs`, BELOW_THRESHOLD 제외 17페어) × 사용자 Fit
  Context의 교집합일 뿐 — 프론트에서 조합을 만들지 않는다(N1_PAIRING_POLICY_V1 §37·§46).
- **PDP 함께 보기(PairSuggestion)**: 짝 상품의 라인을 **렌더 시점의 fit으로 계산**한다 —
  핏을 수정·초기화·복원하면 짝 상품 라인이 같은 리렌더에서 즉시 따라간다(스냅샷 저장 아님).
- 실측(TOP 상품 PDP에서 짝 BOTTOM): "정핏 선호 · 평소 하의 30~31 — …" — 현재 보는
  상품이 상의여도 짝 상품은 하의 앵커로 개인화된다.
- **근거 없는 exact recommendation 금지**: 라인은 방향 비교 문장만. "추천 사이즈는~"
  계열 표현 부재를 테스트가 검사한다. 수치표 앵커 기반 안내(sizeHint)는 변동 없이
  PDP 4층 해석의 세 번째 층(근거 READY일 때만)에 남는다.
- 카드는 조용하다(§52) — 11.5px metadata 톤, 개인화가 없으면 렌더 자체를 생략.

## 4. 게스트 마스터 여정 — 6대 불변식

```
Guest → Smart Fit → Pair browse → Top/Bottom result → Add Cart → Sign Up → Member
```

| 불변식 | 구현 근거(기존) | J의 검증 |
| --- | --- | --- |
| Fit preserved | A: 게스트 핏 sessionStorage, 승격 시 계정으로 이동 | J3·J5·J6 |
| Cart preserved | C: mergeCarts(회원, 게스트) — 게스트 키 파괴 금지 | J4·J7 |
| current route preserved | 인증은 전부 모달(LiquidSurface) — 내비게이션 계층 부재 | J8 소스 잠금 |
| current product preserved | PDP는 모달 오픈 중에도 마운트 유지(`product={fitInput}` 전달) | J8 |
| member Fit persisted | A: 기기 슬롯 + /api/auth profile(Users 시트 — 기존 계약, 변경 0) | J5·J6 |
| guest Fit not separately persisted | A: 승격 시 sessionStorage 사본 삭제 | J5 |

## 5. MEMBER RETURNING — 이 세션의 유일한 동작 수정

**발견한 결함**: `AuthProvider.logout()`이 토큰만 지우고 **React 상태의 fit은 그대로** 두어,
로그아웃 직후의 게스트에게 마지막 계정의 핏이 페어/PDP 개인화로 계속 보였다
(저장소 경계는 A가 지켰지만 화면 상태는 경계를 안 지킨 것). 부수적으로, 계정에 핏이
전혀 없는 로그인(login 병합 결과 null)에서는 기기 슬롯의 **이전 계정** 핏이 새 계정
리프레시 시 되살아나는 교차 누수도 가능했다(슬롯 재바인딩이 ctx 존재 시에만 일어남).

**수정(AuthProvider, 최소)**:
1. `logout()` — `setFit(loadGuestFitContext())`: 화면 상태를 게스트 세션 경계로 복귀.
   기기 슬롯(localStorage)은 마지막 계정의 기기 기억으로 보존(재로그인 병합의 입력).
2. `login()` — 병합 결과가 null(이 계정에도 게스트 세션에도 핏 없음)이면
   `clearFitContext(localStorage)` + `setFit(null)`: 슬롯을 활성 계정에 재바인딩.

**브라우저 실측(서버 쓰기 없이 — logout은 순수 클라이언트 동작)**:
회원 핏(세미오버·100) 적용 상태에서 페어 라인 34장 전부 "세미오버 선호 · 평소 상의/하의 …"
→ 로그아웃 클릭 → 라인이 게스트 세션 핏(정핏·105)으로 즉시 전환, 토큰 제거·로그인
버튼 복귀, 회원 핏은 localStorage 슬롯에 잔존(복원 대기). 재로그인 시 `mergeOnLogin`
서버 프로필 승리로 계정 핏 복원 → 같은 순수 함수가 Pair/PDP 라인을 즉시 다시 만든다(J9).

## 6. AUTH INTERRUPTION — HOME 강제 reset 금지

- Smart Fit → Signup / Cart → Login 모두 **모달 기반**: SmartFitFlow(계정 단계)와
  AuthNav(헤더) 어디에도 `useRouter`·`router.push/replace`·`window.location`이 없다
  (J8이 소스 전수 잠금). 인증 완료는 확인 문구 후 모달 자동 소멸(autoDissipate)뿐.
- 앱 전체에서 강제 `push("/")` 경로 부재 실측. 카트 드로어의 이동은 `/checkout`뿐.
- Intent 보존: PDP에서 핏 플로우는 오버레이로 열리고 상품 컨텍스트(`product={fitInput}`,
  `needCategory`)가 유지된다. 체크아웃은 인증을 요구하지 않아(회원은 이메일 prefill만)
  인증 중단으로 인한 카트 경로 유실 자체가 발생하지 않는다.

## 7. 테스트 — J1–J10 (`node --test tests/personalization.test.cjs`, 12 PASS)

| # | 시나리오 | 핵심 단언 |
| --- | --- | --- |
| J1 | pair Top Fit | 같은 ctx로 top 해석 — 상의 앵커(105)만, 하의 누출 없음, 방향 해석, 결정적 재현 |
| J2 | pair Bottom Fit | bottom은 하의 앵커(30~31) — Top A ≠ Bottom B, 반환 키 {top,bottom}뿐, 페어 단일 사이즈 함수·표현 부재, 소품은 빈 라인 |
| J3 | guest Fit | sessionStorage에만 존재, 여정 내비게이션 4회 생존, localStorage·서버 기록 없음, 게스트로 페어 개인화 즉시 ON |
| J4 | guest cart | 가입 시 mergeCarts로 게스트 라인 전량 승계(수량 병합·상한 캡), 게스트 키 파괴 없음 |
| J5 | signup | payload {gender:'미지정',size:'상의 105 · 하의 30~31',fit:'A'} 계약, 승격 후 세션 사본 삭제, 두 가입 표면 "재질문 없음" 문구 |
| J6 | Fit promotion | 서버 비면 게스트 승격(syncToServer), 서버 있으면 계정 기억 승리 — 승격 결과가 곧 표시 상태 |
| J7 | cart survival | 로그아웃 시 회원 키 보존·게스트 보존본 복귀, 재로그인 재합성(신규 게스트 적립 포함), 이메일 정규화 동일 키 |
| J8 | route survival | 인증 3파일 내비게이션 API 0건, 앱 전체 강제 HOME reset 부재, PDP 오버레이 인텐트 유지 |
| J9 | returning member | logout 게스트 경계 복귀(개인화 OFF 정직)→ login 서버 복원 → 라인 즉시 재생성, 빈 계정 로그인 슬롯 재바인딩(교차 누수 차단) |
| J10 | reset/edit | reset 양쪽 저장소+서버 플래그 계약·PDP 진입 버튼 폴백, edit 저장·라인 즉시 반영 |
| +TASK9 | PDP copy | 라벨 상수·두 줄 구조(라벨→값 순서)·구 접두사 잔존 0·yourContext 예시 문구 정확 재현·CSS 실재 |
| +27·28 | pair 렌더 | 카드 루프 안 상품별 계산·piece-fit 클래스·PDP 짝 상품 렌더 시점 계산·스코어 노출 부재·스타일 실재 |

전체 회귀: `node --test tests/*.test.cjs` → **183/183 PASS** (Session I 171 + J 12).
`npx tsc --noEmit` clean · `next build` ok(`/` 11.2kB·`/product/[id]` 8.49kB — 페어 라인 코드 포함 청크 실측).

## 8. 런타임 스모크 (:3331 prod — 실측 후 종료)

| # | 검증 | 결과 |
| --- | --- | --- |
| 1 | `GET /`·`/product/PRD-N1-01`·`/orders`·`/checkout` | 전부 200 (PDP 0.17s) |
| 2 | `GET /api/products` | ok·44 products·**pairs 17**(BELOW 제외)·첫 페어 PAIR-MA-03 — 스코어/tier/confidence 누출 **0** |
| 3 | `POST /api/auth` 빈 본문 | 거절(쓰기 없음) — 실시트 가입/프로필 쓰기 경로 미실행 |
| 4 | `GET /api/stock?sku=` | `n1.stock.v1` 계약 유지(H 회귀) |
| 5 | 빌드 청크 | "내가 설정한 치수"·piece-fit 코드 포함 실측 |
| 6 | **브라우저** 홈(게스트 핏 주입) | pair row 17·카드 34·**개인화 라인 34** — 상의/하의 앵커 분리, 해석 상이 |
| 7 | **브라우저** PDP + 함께 보기 | 라벨·값 두 줄 렌더, 구 접두사 부재, 짝 상품 하의 앵커 라인, E reason 문구 공존 |
| 8 | **브라우저** 로그아웃 경계 | 회원 핏→게스트 세션 핏 즉시 전환·토큰 제거·기기 슬롯 보존 |

정직 경계: 스모크는 읽기·거절 경로만. 실제 회원가입·프로필 서버 쓰기(Users 시트)는
실행하지 않았다 — 해당 경로는 Session A의 qa-proxy 스텁 E2E에서 검증된 동일 코드
(AuthProvider.login 병합)이며 J는 그 계약을 순수 함수로 재잠금했다. 브라우저 회원
상태는 가짜 토큰을 localStorage에 넣는 방식(서버 검증 호출 없음)으로 시뮬레이션했다.

## 9. Mimosa 스캔 (커밋 훅)

normal 깊이: `scan-2026-09-09T07-24-27.632Z-6c013d685065`, seal
`sha256:194b693a…06c2`, findings 8 — 구성:
- SmartFitFlow.tsx:339 하드코딩 후보 1(autoComplete="current-password" 오탐으로 추정),
  recompute_pairs.py 경로 후보 1 — **타 세션 기존 항목**(H·I 리포트와 동일).
- telegram SSRF 후보 6(confirm·return-request·orders 라우트 + csRelay·telegramInbound)
  — 전부 기존 `lib/telegram.ts` 재사용 경로(고정 오리진 + 호스트 화이트리스트 가드 보유).
- **Session J 신규/수정 파일에서 신규 finding 0** — fitDisplay는 순수 함수(네트워크 0),
  AuthProvider 변경은 저장소 조작만, 새 fetch·URL 조립 0건.
- 커밋 훅이 library_source/callgraph 일부 미완료를 통지 — 본 보고서는 "프로젝트 전체
  안전"을 주장하지 않는다. 의존성 오프라인 매칭 5패키지/34 advisory(context-only,
  H·I와 동일 — 온라인 재확인 필요).

## 10. 소유권 존중 — 누구 파일을 어디까지 만졌나

| 파일 | 소유 | J의 변경 |
| --- | --- | --- |
| `lib/fitDisplay.ts` · `tests/personalization.test.cjs` | **J 신설** | 개인화 표시 계층 + J 스위트 전체 |
| `app/page.tsx` | (컬렉션 경험 — F/E 계승) | pair 카드 루프 안 상품별 라인 4줄 + import 2건 + fitInputOf 헬퍼 |
| `app/product/[id]/page.tsx` · `product.module.css` | (디테일 경험) | TASK 9 라벨/값 분리, PairSuggestion에 짝 상품 라인, CSS 3클래스 |
| `app/globals.css` | (공유 스타일) | 파일 끝 append-only 블록 1개(.piece-fit) |
| `components/AuthProvider.tsx` | A | **§5의 2군데 최소 수정**(logout 경계 복귀·login 슬롯 재바인딩) — 저장·승격·reset 계약 무변경, 헤더 주석에 사유 기록 |
| `lib/fit.ts`·`lib/fitContext.ts`·`lib/pairs.ts`·`lib/cart.ts`·E 페어 데이터·CS·재고·주문 | A·E·C·B·D·H·I | **무수정** — import로만 재사용 |
| Users 시트·전 API 라우트·`.env.local`·credential | — | **무접촉** — 시트 write 0, 신규 API 0 |

HERMES: 이번 범위는 기존 계약(/api/auth profile·Pairs 프론트 계약)의 소비만으로
신규 쓰기 경로·권리 변동이 없어 통지 대상 변경이 없다(파일·시트 구조 0건).

## 11. 잔여 사항 (이월)

1. pair 카드 개인화 라인은 fit 컨텍스트 보유 시 항상 노출 — 노출 토글(예: 라인 접기)이
   필요하면 소비자 반응 확정 후 `.piece-fit` 렌더 조건 1곳만 바꾸면 된다.
2. 실측 수치표(sizeChart)가 현재 카탈로그에서 대부분 UNKNOWN — 라인의 방향 해석은
   상품명 실루엣 키워드 기반으로 동작(UNCONFIRMED 제외). 수치표가 채워지면 PDP의
   sizeHint처럼 근거가 강해지며, 페어 카드에 sizeHint를 올릴지는 그 시점에 정책 결정.
3. AuthProvider 인메모리 세션 한계(A §13·C §9)는 그대로 — 브라우저 리프레시는 로컬
   슬롯, 서버 프로필 검증은 다음 로그인 시점.
4. 병합 게이트(차기): J 브랜치 통합 시 183 회귀 재실행 + base(7d15622) 기점 확인.

---
*Session J 완료 — TASKS 9·27·28 · output 본 파일 · 게스트 여정 6불변식 + 회원 복원 잠금 · 이후 STOP.*
