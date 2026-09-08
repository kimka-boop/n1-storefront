# N1_SESSION_D_CS_TELEGRAM_REPORT

# SESSION D — N°1 AI CS + TELEGRAM / TASKS 24–25 (P0 release blocker)

작성: ZCode / 2026-09-09
브랜치: `n1-cs-provenance-telegram-p0` (worktree `C:\Users\MY-PC\Documents\n1-cs-p0`)
소유권: Customer Center Intelligence + Human Handoff 만 수정 — 그 외 시스템 무변경

---

## 1. Natural CS (미션 §1)

- 첫 greeting: scripted welcome **대화당 정확히 1회** (`greetSent` 플래그). 이후 같은 인사에는
  짧은 문맥 응답(`SECOND_GREETING`) — D1·D2 테스트로 검증.
- Small talk / nonsense: 고정 macro 반복 금지 — 소톡 패턴 응답 + 일반 fallback 3종이
  직전 응답과 다른 문구를 선택(`lastFallback` 회피). 서로 다른 입력 5개에 서로 다른 응답
  최소 2개 이상을 D3 테스트로 강제.
- 응답 생성은 규칙 기반 + 검증 데이터 전용(주문 시트·카탈로그·확정 정책 텍스트).
  전 경로에서 LLM 호출 0.

## 2. Spam Gate Before LLM (미션 §2)

- 60초 window 내 정규화(공백·문장부호·대소문자 무시) 지문 중복 급증 감지.
- 동일 지문 3회 → **15초 cooldown**(10–20초 범위) 진입, cooldown 중 응답은
  deterministic 문구 1종(재처리 0 — 이 엔진은 애초에 LLM call이 없어 cooldown 중 LLM 0이 구조적으로 보장).
- 주문번호·상담원 요청 등 의미 있는 입력은 spam gate **이전** 단계에서 처리되어
  count로 차단되지 않는다. D4·D5·D6 테스트로 검증 (D6: 서로 다른 정상 문의 10연속 전부 정상 응답).

## 3. Human Escalation Trace (미션 §3) — 전 경로 evidence

TEST-N1-CS 실측 (production 서버, 포트 4310):

```
[고객 웹 입력]  "상담원 연결해주세요."
  → [cs:audit] CUSTOMER_WEB_MESSAGE_RECEIVED conversation=CS-001
[HUMAN_PENDING]  status 전환 + system 안내 1회
[Escalation Event]
  → [cs] escalation 매핑: conversation=CS-001 telegram_messages=[49]
[HERMES credential]  N1_CS_BOT_TOKEN / N1_CS_CHAT_ID (env 주입, 값 미노출)
[CS Telegram]  sendMessage ok:true, message_id=49 ← Telegram 수락 = 채널 도달
[Owner]  [TEST][N°1 전문상담 요청] 티켓 수신 (TEST-N1-CS 식별 표기)
[Owner Reply]  reply_to=49
  → [cs:audit] HUMAN_REPLY_MAPPED conversation=CS-001 telegram_message=9901
  → [cs:audit] HUMAN_MESSAGE_PERSISTED conversation=CS-001 message=M-5
[Customer Web]  전문 상담원 배지 + 원문, 새로고침 없이 표시 (4초 폴링)
```

운영자 답장이 실제 Telegram 클라이언트에서 들어오는 경로는 상시 소비자(lib/telegramInbound)가
담당하며, 직전 P0 세션에서 실제 운영자 답장 2건이 이 경로로 유입·라우팅된 실측이 있다.
본 세션의 답장은 재현 가능성을 위해 webhook 경계(실제 authorized chat id)로 주입했다 —
webhook과 long-poll은 `processTelegramUpdate` 단일 처리 경로를 공유한다.

## 4. HERMES Credential (미션 §4)

신규 봇 생성 없음. HERMES가 주입한 기존 CS 봇 credential(env: `N1_CS_BOT_TOKEN` /
`N1_CS_CHAT_ID`)만 사용. 토큰 값은 코드·로그·리포트 어디에도 출력·기록하지 않았다.
`.env.local`은 gitignore 대상(리포지토리 미포함).

## 5. Telegram Payload (미션 §5) — D8·D9

`buildTranscriptPayload()` 표준 포맷 (4096자 분할 발송, 전체 청크 conversation 매핑):

```
[TEST][N°1 전문상담 요청]      ← is_test 세션만 [TEST] + 테스트 식별자
고객: 비회원 1                 ← safe customer context (운영자 전용 라벨)
유형: GUEST | MEMBER           ← member/guest 명시
Conversation: CS-001
상태: HUMAN_PENDING
테스트: TEST-N1-CS             ← is_test 세션만
관련 주문: ORD-…               ← 주문 컨텍스트 아는 경우만
문의 요약: …
연결 사유: …
──── 전체 대화 ────            ← RAW transcript (고객 원문 + AI responses 포함)
고객: …
AI: …
──── 답변 방법 ────
이 고객에게 답변하려면 이 Telegram 메시지에 '답장(Reply)' 기능으로 메시지를 보내주세요.
```

## 6. Human Reply (미션 §6)

- `reply_to_message.message_id` → conversation 매핑(메시지 패밀리 전체)으로 **정확한 고객** 라우팅.
- sender "전문 상담원" 배지로 고객 UI 표시, 원문 VERBATIM(개행·오탈자 포함, trim 없음).
- AI rewrite 없음 — 릴레이 경로 LLM 호출 0.
- HUMAN_ACTIVE에서 AI 고객 응답 중단(경합 중 완료된 AI 응답도 폐기하는 가드 포함).

## 7. Real Safe Test (미션 §7)

- 테스트 식별자 **TEST-N1-CS**를 is_test 세션의 Telegram 티켓에 명시(`N1_CS_TEST_MODE=1`,
  `N1_CS_TEST_ID=TEST-N1-CS`) — 운영자 피드에서 실제 상담과 확실히 구분.
- Owner Telegram 실제 도착: Telegram Bot API가 sendMessage 수락(message_id=49 반환) +
  서버 매핑 로그. 전송 실패 시 거짓 성공 없음(실패 시 `[cs] 전송 실패` 로그 + 재전송 훅).
- Human test reply → Customer Center 원문 그대로 수신 실측(§3 trace 하단).

## 8. Tests — D1–D13 매트릭스 결과

`tests/sessionD.test.cjs` (신규 13케이스) + 기존 전체 스위트 **97/97 PASS**, `tsc --noEmit` 클린.

| # | 항목 | 결과 | 검증 |
|---|---|---|---|
| D1 | greeting scripted 1회 | PASS | 단위+E2E |
| D2 | second greeting 문맥 응답, 스크립트 반복 금지 | PASS | 단위+E2E |
| D3 | nonsense — 다양한 짧은 자연 응답 | PASS | 단위 |
| D4 | spam burst 60초 window 감지 | PASS | 단위 |
| D5 | cooldown 10–20s + deterministic 응답 | PASS | 단위 |
| D6 | legitimate burst(서로 다른 정상 문의 10건) 미차단 | PASS | 단위 |
| D7 | human request → 즉시 HUMAN_PENDING | PASS | 단위+E2E |
| D8 | Telegram outbound | PASS | 단위(payload 구성)+E2E(msg 49 실발송) |
| D9 | raw+summary+사유+유형+주문 컨텍스트 | PASS | 단위 |
| D10 | human inbound reply-to 라우팅 | PASS | 단위+E2E |
| D11 | verbatim 전달(개행 보존) | PASS | 단위+E2E |
| D12 | HUMAN_ACTIVE AI 침묵 + 고객 입력 전달 | PASS | 단위+E2E |
| D13 | duplicate ticket 방지(재 escalation 금지) | PASS | 단위 |

## 9. 운영 안정성 (세션 중 발견·수정)

- **소비자 이중 기동 race**: `ensureTelegramInbound`의 시작 가드가 await 뒤에 있어 동시
  요청 2개가 소비자 루프 2개를 띄울 수 있었고, 두 루프가 서로의 long-poll을 409로 킥하는
  요청 폭풍으로 서버가 응답 불능이 되는 것을 실측했다. 수정: 시작 플래그 동기 선점(단일
  canonical 소비자 보장) + 409를 네트워크 오류와 구분해 30초 백오프 + 모든 Telegram fetch에
  타임아웃 signal 부착. 수정 후 단일 기동 실증(`CONSUMER_STARTED` 1회).
- dev 서버(온디맨드 컴파일)는 병렬 세션들의 빌드와 CPU를 경합해 불안정 → E2E는
  production build(`next build` + `next start`)로 수행해 컴파일 변수를 제거했다.

## 10. Files Changed

- `lib/cs.ts` — testId() 테스트 식별자 헬퍼
- `lib/csEngine.ts` — payload에 유형(MEMBER/GUEST)·테스트 식별자 블록 추가
- `lib/telegramInbound.ts` — 이중 기동 race 수정, 409 구분 백오프
- `lib/telegram.ts` — getUpdates 반환에 conflict 플래그 + fetch 타임아웃
- `tests/sessionD.test.cjs` — 신규 (D1–D13)

## 11. Commit

`n1-cs-provenance-telegram-p0` 브랜치 — SESSION D 커밋 (이전 커밋: 9a5fe28 reply-to 단일 라우팅,
62bff2e provenance+상시 수신+phantom guest 봉쇄).

## 12. Remaining Notes

- 인메모리 대화 스토어(V1 계약) — 재시작 시 대화 소멸, 영속화 시 provenance 필드 동반 이관 필요.
- 배포 환경에서는 setWebhook 등록 권장 — 등록 시 프로세스 폴링은 자동으로 양보한다.
- E2E 서버(포트 4310, production, TEST-N1-CS 모드) 가동 중 — 확인 후 종료 가능.
