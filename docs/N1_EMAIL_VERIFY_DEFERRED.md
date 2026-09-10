> **[활성 공지 2026-09-10]** 이 문서가 묘사한 지연 계약은 Email Verification Mission에서
> 해제되었다. `lib/emailVerify.ts`는 실동작 구현(단일 사용 토큰·10분·해시 저장)으로 전환됐고,
> provider 경계는 `lib/emailProvider.ts`, 활성 절차는 `N1_EMAIL_ACTIVATION_RUNBOOK.md`다.
> 비밀번호 recovery는 여전히 잠겨 있다 — 소유 확인은 이제 가능하지만, recovery 구현 자체가
> 별도 승인 과제다. 아하는 역사 기록으로 보존한다.

# EMAIL_VERIFY_DEFERRED — 이메일 소유 확인 지연 계약

> Owner: Session A (AUTH + SMART FIT) · 작성: 2026-09-09 · 상태: **ACTIVE CONTRACT**
> 코드: `lib/emailVerify.ts` (`deferredEmailVerify`, `EMAIL_VERIFY_STATUS`)

## 배경

현재 transactional email 인프라(SMTP/API 발송 provider)가 없고, 새 유료
provider를 임의로 도입하지 않는 미션 제약이 있다. 따라서 가입 이메일은
**형식만 검증된 미확인 주소**로 취급한다.

## 계약 내용

1. `Account.emailVerified`는 계약이 해제될 때까지 항상 `false`다. API 응답은
   이 값을 그대로 노출한다(거짓 표시 금지).
2. `POST /api/auth { action: "request-email-verify" }`는
   `{ ok: false, code: "EMAIL_VERIFY_DEFERRED" }`로 정직하게 응답한다 —
   발송을 흉내 내지 않는다.
3. **비밀번호 recovery(이메일 재설정)는 이 계약이 해제될 때까지 구현·활성화
   금지.** 확인되지 않은 주소에 recovery를 열면 오타/타인 주소 입력만으로 계정
   탈취가 가능해진다. 지금의 복구 경로는 CS(고객센터) 사람 확인뿐이다.
4. UI는 "이메일 확인 안 됨"을 숨기지 않는다 — 가입 안내 문구에 확인 지연
   사실을 명시할 수 있어야 한다(다음 문구 작업에서 반영 가능).

## 해제 조건 (provider 도입이 승인될 때)

1. provider credential은 env 주입만 사용(소스 literal 금지).
2. `deferredEmailVerify.requestEmailVerify`를 실발송으로 교체 — 시그니처 유지.
3. `confirmEmailVerify`가 단일사용 토큰(권고: 10분 만료)을 검증해
   `emailVerified=true`로 승격. Users 시트의 "이메일인증" 컬럼을 "확인"으로 갱신.
4. 그 이후에만 비밀번호 recovery 경로를 열 수 있다(재설정 토큰도 단일사용).

## 호환성

- 회원가입 폼/로그인/스마트핏 승격 흐름은 이 계약의 영향을 받지 않는다 —
  지금도 이메일은 "연락 채널"로만 수집된다(로그인 핸들은 username 또는 email).
