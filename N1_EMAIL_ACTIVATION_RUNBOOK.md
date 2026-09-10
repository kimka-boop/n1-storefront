# N1_EMAIL_ACTIVATION_RUNBOOK

> **N°1 트랜잭션 이메일 활성화 절차** — Email Verification + Safe Saved Payment Mission (2026-09-10)
> 목적: 실제 이메일 발송 provider(SMTP/API) 연결이 **유일하게 남은 외부 단계**가 되도록 하는 것.
> 아키텍처: `N1_AUTH_EMAIL_BASELINE_AUDIT.md` · 최종 보고서 · `lib/emailProvider.ts`

---

## 0. 원칙 (절대 불변)

1. **이메일 발송 provider 연결은 Human Owner 승인 사항이다** — 유료 서비스·자격증명은
   HERMES 승인 게이트 대상. 워커·에이전트가 자동 승격하지 않는다.
2. **시크릿은 env로만** — `N1_EMAIL_*` 네이밍, `.env.local` 또는 배포 호스트 env.
   소스·시트·로그·브리지 파일에 credential 값 기록 금지.
3. **"보냈다"는 실제 전송일 때만 말한다** — provider 미연결 시 시스템은 정직하게 거절/지연 안내.
   bridge 모드는 큐 적재일 뿐 전송이 아니다 (`delivery:"bridge"`).
4. **검증 상태는 서버 전용** — 클라이언트가 `emailVerified=true`를 제출할 경로는 존재하지 않는다.

## 1. 현재 상태 (pre-provider, bridge 큐 가동)

- `N1_EMAIL_PROVIDER=bridge` (`.env.local`) → 인증 메일이
  `mission-20260909/N1_EMAIL_BRIDGE/outbound/*.json`에 **크기만** (미전송).
  승인된 E2E에서 Owner Gmail GUI가 이 큐의 이메일을 대신 전달했다 (2026-09-10 실시 완료).
- 가입 플로우: register → 대기 계정(`이메일인증="인증대기"`) + 토큰 발급(10분·단일 사용·해시 저장)
  → 로그인 게이트(403 `EMAIL_NOT_VERIFIED`) → 링크 확인 → `"확인"` 승격.
- `no_email_provider`(env 미설정): 발송 거절 `EMAIL_PROVIDER_NOT_CONFIGURED` — 가입은
  대기 상태로 유지되며 재발송·이메일 정정으로 완결 가능.

## 2. 활성화 절차 (순서대로)

### Step 1 — 어댑터 구현 (코드 리뷰 필요)

`lib/emailProvider.ts`의 `EmailProvider` 계약을 구현하는 어댑터를 추가한다:

```
lib/email/
  provider.ts       # 계약 재수출 (lib/emailProvider.ts)
  smtp.ts           # 예: nodemailer SMTP 어댑터 (선택된 provider만 구현)
  # 또는 api provider (Resend/SendGrid 등)
```

계약: `sendVerificationEmail({to, username, verifyUrl, expiresAt})` → `{ok:true, delivery:"sent", ref}`.
구현 규칙:
- credential은 `process.env.N1_EMAIL_SMTP_HOST/USER/PASS` 등 env만 읽는다. 값 반환·로깅 금지.
- 수신자는 서버가 검증한 계정 이메일만 — 요청 body로 주소를 조립하지 않는다.
- `resolveEmailProvider()`에 어댑터 분기 추가 + `configSummary` 갱신 + `liveEmailAvailable:true`.

### Step 2 — env 주입 (배포 호스트)

```
N1_EMAIL_PROVIDER=smtp                # 어댑터 식별자
N1_EMAIL_SMTP_HOST=...                # 어댑터가 읽는 키들 (값은 소스에 기록 금지)
N1_EMAIL_SMTP_USER=...
N1_EMAIL_SMTP_PASS=...
N1_PUBLIC_BASE_URL=https://<도메인>    # 인증 링크 베이스 (미설정 시 요청 origin 사용 — 로컬 배포에서는 localhost가 된다)
```

### Step 3 — 검증 (순서 엄수)

1. **단위/통합**: `node --test tests/*.test.cjs` 전부 PASS (221+).
2. **라이브 발송 1건**: 테스트 주소로 가입 → 실제 수신 확인 (링크 클릭 → 인증 완료 페이지).
3. **거절 경로**: 존재하지 않는 주소 재발송 → 균일 응답(유출 없음) 확인.
4. **쿨다운**: 60초 내 재발송 → 429 `VERIFY_RESEND_COOLDOWN` 확인.

### Step 4 — 운영 관측

- 발송 실패는 응답에 정직 코드(`EMAIL_SEND_FAILED`) — 실패가 반복되면 provider 대시보드 확인.
- `Email_Verifications` 시트는 해시만 저장 — 만료 행 주기 정리는 운영 cadence로 (선택).

## 3. 롤백

`N1_EMAIL_PROVIDER` 삭제 → `no_email_provider` 정직 거절로 복귀. 가입은 대기 상태까지
생성되며 CS 수동 인증(시트 `이메일인증` 수동 갱신)이 최종 수단이다.

## 4. 보안 체크리스트 (활성화 전 전부 확인)

- [ ] 어댑터에 credential literal 0 (소스·테스트·예시 전부)
- [ ] 브리지 큐에 credential이 포함된 적 없음 (큐 파일은 to/subject/text/verifyUrl뿐)
- [ ] 검증 토큰이 해시 아닌 값으로 시트·로그에 기록된 적 없음
- [ ] `N1_PUBLIC_BASE_URL`이 실제 도메인으로 설정됨 (고객이 받는 링크가 localhost가 아님)
- [ ] L4(오류 위생)·전체 테스트 스위트 PASS
