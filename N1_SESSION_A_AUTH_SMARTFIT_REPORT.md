# N1_SESSION_A_AUTH_SMARTFIT_REPORT.md

> **SESSION A — N°1 AUTH + SMART FIT DATA FOUNDATION**
> Branch: `n1-auth-smartfit-foundation` (worktree `C:\Users\MY-PC\Documents\n1-auth-fit-a`)
> Base: `9a5fe28` (n1-cs-provenance-telegram-p0 HEAD — 타 세션 진행 중 변경 미포함, 의도된 분리)
> Head: `75e5e5f` · Typecheck ✅ · `next build` ✅ · Tests **55 pass / 0 fail**
> 작성: 2026-09-09 · 상태: **완료 — STOP** (타 세션 영역 통합 시도 없음)

---

## 0. 소유권 준수

수정 파일은 AUTH + Smart Fit 코어에 한정된다:
`app/api/auth/route.ts`, `lib/authServer.ts`(신규), `lib/username.ts`(신규),
`lib/emailVerify.ts`(신규), `lib/fitFlow.ts`(신규), `lib/fitContext.ts`,
`components/AuthProvider.tsx`, `components/AuthNav.tsx`, `components/SmartFitFlow.tsx`,
`components/useUsernameCheck.ts`(신규), `app/globals.css`(맨 끝에 블록 append만),
`tests/*`(추가), `docs/*`(신규). **Commerce/Stock/CS/Pairing/Header 파일은 1행도
수정하지 않았다** (SiteHeader·CsWidget·cart·checkout·products 무변경).
`useAuth` 공개 시그니처는 확장만 했다(login에 선택 인자 추가) — 기존 소비자
(page.tsx·CheckoutFlow·CsWidget·PDP) 무수정 호환.

---

## 1. USERNAME UNIQUENESS (§1)

- **아이디(username) 도입**: 로그인 핸들. 정규형 = trim + 소문자, 규칙
  `[a-z0-9_]{3,20}` (`lib/username.ts` — 클라이언트/서버 공용 단일 정의).
  기존 이메일 전용 계정은 아이디를 지어내지 않고 이메일 로그인으로 존중한다.
- **가용성 확인**: `POST /api/auth {action:"check-username"}` — 결정적 서버 조회
  **AI 판정 없음**. 클라이언트는 `useUsernameCheck` 훅으로 debounce 400ms +
  blur 즉시 확인, 인라인 피드백:
  - AVAILABLE → "사용할 수 있는 아이디예요" (올리브)
  - TAKEN → "이미 사용 중인 아이디예요" (경고색, role=alert)
  - INVALID → 규칙 안내 문구
- **submit 최종 검사**: 가입 시 서버가 다시 검사한다(인라인 피드백은 안내일 뿐).
- **원자적 유일성**: Google Sheet에는 UNIQUE 제약이 없다 → Sheet lookup만으로
  유일성을 보장하지 않는다. `lib/authServer.AuthStore.register`가
  **확인+예약을 await 없는 단일 동기 블록**으로 수행(JS 단일 스레드 원자성)하고,
  Sheet 사전 확인은 재시작 대비 2차 방어. 영구 저장 실패 시 예약을 되돌려
  가입 가능 상태를 정직하게 유지한다.
- 동시성 실측: 같은 아이디 5개 동시 가입 → 정확히 1승자, 4×409 (A3).

## 2. PASSWORD SECURITY (§2)

- **scrypt 해시**(node:crypto, N=16384·r=8·p=1·32B, 16B 랜덤 salt), 포맷
  `s1$<saltB64>$<hashB64>`. 같은 평문도 매번 다른 해시. 타이밍 안전 비교.
- **레거시 행 투명 승격**: 기존 Users 시트의 구버전 약해시(`h…`) 행은 로그인
  검증 후 즉시 s1으로 재해시 저장 — 기존 계정 로그인 보존.
- **평문 잔존 검사**: 프론트 영구 저장소에 password 저장 없음(모달 close 시
  상태 폐기), 서버 로그/에러 응답에 요청 값 미반환, 시트에는 해시만 적재.
- **세션 토큰**: 기존 이메일 기반 예측 가능 토큰 → `randomBytes(24).base64url`.

## 3. EMAIL (§3)

- 문법 검증: 클라이언트 인라인 힌트 + 서버 최종(`validateEmail`, trim+소문자
  정규화). 잘못된 형식은 가입 불가(A4).
- **EMAIL_VERIFY_DEFERRED 계약** (`lib/emailVerify.ts` + `docs/N1_EMAIL_VERIFY_DEFERRED.md`):
  - transactional email 인프라가 없으므로 **새 유료 provider 임의 도입 없음**.
  - `emailVerified`는 항상 false, `request-email-verify` 액션은 DEFERRED로 정직 응답.
  - **비밀번호 recovery는 이 계약 해제까지 구현·활성화 금지**(미확인 주소에
    recovery를 열면 계정 탈취 직결) — 해제 조건 4단계 문서화.

## 4. SMART FIT BACK UX (§4)

- 각 단계 좌측 상단에 작은 원형 뒤로 컨트롤(`.lq-back`, ←) — 기존 `.lq-close`와
  같은 조용한 원형 재질, **새 Glass material 없음**.
- **진입 단계에서는 렌더링되지 않음** (`canGoBack` = 이력 스택 비었음).
- 이력 스택(`lib/fitFlow.ts` 순수 머신): 뒤로 가면 이전 단계로 복귀하고 그때의
  선택이 그대로 복원된다(브라우저 실측: result→size(하의, 30~31 pressed)→
  size(상의, 100(L) pressed)→fit(B pressed)→진입 단계에서 컨트롤 소멸).
- 컨트롤과 킥커 겹침을 `:has(.lq-back)` 패딩(30px)으로 방지 — 실측
  back.right=483 < kicker.x=493.

## 5. SMART FIT FLOW (§5)

- **상의 입력 후 바로 결과로 가지 않는다(수정)** — 흐름: 선호 핏 → 필요한 사이즈
  컨텍스트 → 이어서 남은 컨텍스트 → 결과. 진입 맥락(needCategory)이 하의면
  하의 먼저, 이어 상의.
- **이미 아는 값 재질문 금지**: 큐는 모르는 값만 담는다(`pendingSizeQueue`).
  둘 다 아는 게스트는 사이즈 질문 없이 바로 결과.
- 단계 라벨은 "첫 질문 / 사이즈"로 단순화 — 질문 수가 2~3으로 가변이라 분수
  표기(1/2·2/2)는 제거(정직 표기).

## 6. GUEST FIT (§6)

- 게스트 핏은 **sessionStorage에만** 저장(`n1_fit_profile`). localStorage·
  서버·Customer Sheet에는 절대 쓰지 않는다 — `AuthProvider.saveFit`이 토큰
  없으면 서버 호출 자체가 없고, 서버측도 토큰 없는 profile 쓰기는 401(A6).
- 같은 탭 세션 안에서 PDP 이동·새로고침·카트 이동에 유지됨을 브라우저 실측
  (reload 후 재오픈 → 바로 결과 단계). 탭 닫힘 = 소멸(세션 경계).
- 홈 화면은 세션 핏이 있으면 "스마트 핏 — 설정됨"으로 표기된다(기존 UI 재사용).

## 7. MEMBER FIT (§7)

- authorized profile storage: 기기 슬롯(localStorage) + `POST /api/auth
  {action:"profile"}` → Users 시트. **기존 시트 계약 {gender,size,fit} 유지**,
  신규 컬럼(사용자이름·이메일인증)은 기존 컬럼 순서 보존한 채 끝에만 덧붙임
  (`setHeaderValues` 확장 — 레거시 행 호환). HERMES 회신(turn B)에 본 세션용
  신규 지시는 없었으므로 기존 계약을 그대로 존중했다. credential은 요청·수신
  하지 않았다(env 주입 구조만 사용).
- 로그인 시마다 기기 슬롯을 활성 계정으로 다시 묶는다 — 계정 간 누수 없음.

## 8. GUEST → MEMBER PROMOTION (§8)

- 가입 흐름: 게스트 세션 핏 보유 시 회원가입 폼이 핏을 **다시 묻지 않는다**
  (SmartFitFlow 계정 단계 + AuthNav 2단계 모두 "방금 설정한 핏이 그대로
  저장됩니다").
- 순서: identity 확정(가입) → 병합(서버 우선 / 게스트 승격 — `mergeOnLogin`) →
  **기기 슬롯 기록 → 서버 readback(`GET /api/auth?token=`) → 세션 사본 삭제**.
  버그 수정 1건: 서버가 이기는 로그인에서도 승격 함수가 세션 사본을 우선 읽어
  기기 슬롯을 게스트 값으로 쓰던 결함 → 승격은 mergeOnLogin 결과값을 그대로
  기록하도록 수정 + 회귀 테스트(A8b) 추가.
- 브라우저 실측: 가입 직후 confirm "기억했어요", localStorage에 핏 존재,
  **sessionStorage null(사본 정리)**, 헤더 "qa_sesa_worker님 (세미오버 · 평소 100)".
- Cart는 수정하지 않았다 — Cart continuity는 Session J 소관(미션 명시).

## 9. DATA POLICY (§9)

- 게스트: 영구 서버/시트 저장 금지 — 코드 경로로 차단(§6) + 서버 401(A6-server).
- 회원: 쇼핑 개인화 목적 한정, view(결과 화면 표시)/edit(설정 수정)/
  **reset(기기+서버 핏 필드 공백화, `resetFitProfile` 플래그)** 제공 — 브라우저
  실측에서 reset 후 localStorage null·헤더 핏 라벨 소멸·로그인 유지 확인.
- 탈퇴 처리 정책: `docs/N1_SMARTFIT_DATA_POLICY_DRAFT.md` — **DRAFT +
  [REVIEW-REQUIRED] 플래그**. 법조문을 창작하지 않았다: 개인화 데이터는 탈퇴 시
  삭제, 주문/결제 법정 보존 기록과 분리 보존(개인화 삭제가 주문 보존을 침해하지
  않고, 주문 보존이 개인화 보존을 정당화하지 않는다)을 처리 사실 초안으로 기술.
  코드측 자리표 `SMARTFIT_ON_WITHDRAWAL`(lib/emailVerify.ts). 탈퇴 API 구현은
  다음 게이트.

## 10. COPY (§10)

- 결과 화면 게스트 문구: ~~"지금은 이 브라우저에 저장되어 있어요."~~ →
  **"지금은 제가 잠깐 기억하고 있어요."** (브라우저 실측 스크린샷 확인).
- 전체 typography/global layout 불변 — globals.css는 신규 클래스 append만.

## 11. TESTS (§11) — `node --test`, 실제 TypeScript 트랜스파일 실행

| ID | 내용 | 결과 | 위치 |
|---|---|---|---|
| A1 | 고유 아이디 가입 성공(+정규화, 가용성 판정) | ✅ | authFoundation |
| A2 | 중복 아이디 거절(대소문자·공백 정규형 포함) | ✅ | authFoundation |
| A3 | 동일 아이디 5개 동시 가입 → 정확히 1승 + 저장실패 시 예약 해제 | ✅ | authFoundation |
| A4 | 잘못된 이메일 문법 거절 + 정규화 저장 | ✅ | authFoundation |
| A5 | 게스트 핏 세션 지속(PDP/새로고침/카트) + 새 탭 소멸 | ✅ | fitContext (+브라우저 실측) |
| A6 | 게스트 핏이 localStorage/시트에 없음(서버 401, persist 0 호출) | ✅ | fitContext + authFoundation |
| A7 | 승격: 세션→기기 슬롯 이동, 사본 정리, 서버 인코딩, 재질문 없음 | ✅ | fitContext (+브라우저 실측) |
| A8 | 회원 핏 복원(기기 슬롯 + 서버 우선 병합 A8b 포함) | ✅ | fitContext + authFoundation |
| A9 | edit 반영 / reset: 기기+서버 공백화, 무토큰 쓰기 차단 | ✅ | fitContext + authFoundation |
| A10 | 뒤로: 진입 숨김·스택 복귀·선택 복원·수정/계단 복귀 | ✅ | fitFlow (+브라우저 실측) |
| A11 | 상의→하의→결과, 재질문 금지, 하의 PDP 우선 큐 | ✅ | fitFlow (+브라우저 실측) |

합계: authFoundation 13 + fitFlow 6 + fitContext 17 + 기존 회귀
(fit 19·cart 10·cs 12·csTalk 8·csReplyRouting 13·experience 3) = **55 pass / 0 fail**.
(타 세션의 csProvenance 테스트는 내 베이스 커밋에 없어 대상 외.)

## 12. 브라우저 E2E (qa-proxy-a 인메모리 스텁 — Google Sheet 쓰기 0)

:3212(내 worktree dev) ← :3213(스텁 프록시; auth 신계약·상품 픽스처)에서 실측:
첫 단계 뒤로 숨김 → 핏 선택 → 상의 → **하의 이어짐** → 결과
("지금은 제가 잠깐 기억하고 있어요.") → 뒤로 3회 상태 복원 → 진입 단계 뒤로 소멸 →
새로고침 후 세션 핏으로 바로 결과 → 아이디 AVAILABLE/TAKEN 인라인 → 가입 →
승격·readback·사본 정리·헤더 username → 아이디 로그인 복원 → 초기화(기기+서버).

## 13. CURRENT LIMITATIONS / HANDOFF

1. **Google Sheets 물리 UNIQUE 제약 없음** — 프로세스 내 예약 인덱스가 1차
   제약. 다중 인스턴스 배포 시에는 시트를 유일성 원천으로 쓸 수 없으므로
   DB 전환 또는 시트 잠금 계약이 필요(다음 게이트).
2. 아이디 문자셋은 영문 소문자·숫자·`_` 3~20자 — 한글 아이디 미지원(정직한
   제한, UI 문구에 명시). 필요 시 정규화 규칙 확장은 `lib/username.ts` 한 곳.
3. 비밀번호 recovery 미구현(§3 계약상 의도적 잠금). 복구는 CS 사람 확인만.
4. 탈퇴 API 미구현 — 정책 초안 + 코드 상수만(§9). 구현 시 시트 행 삭제 범위를
   정책 문서와 함께 확정할 것.
5. 시트 "기준사이즈" 단일 컬럼에 상·하의 합성 문자열 유지(기존 V2 한계 계승 —
   스키마 변경 없음). 스키마 승인 시 `encodeProfileForServer`만 교체하면 된다.
6. 이메일 인증 컬럼(이메일인증)은 항상 "미확인" — provider 승인 후 채워진다.
7. rate limit: check-username에 단순 조회만 있고 전용 rate limiter 없음
   (로컬/스테이지 스코프). 공개 배포 전 추가 권장.

## 14. 통합 안내 (통합 세션용)

- 머지 대상: `n1-auth-smartfit-foundation` @ `75e5e5f` ← base `9a5fe28`.
- 충돌 예상 파일: `app/globals.css`(append-only 끝 블록), `components/SmartFitFlow.tsx`·
  `AuthProvider.tsx`·`AuthNav.tsx`(본 세션 전면 재작성 — B의 V2 계승), `lib/fitContext.ts`.
  `useAuth` 시그니처 하위호환 유지로 Header/CS/Cart 소비자 수정 불요.
- API 하위호환: `login`은 기존 `email` 필드도 수용, `register`는 `username` 신규
  필수 — 구버전 프론트가 있으면 400 안내. Users 시트는 컬럼 확장만(기존 행 무손상).
