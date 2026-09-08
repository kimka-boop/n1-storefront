# N1_CS_TELEGRAM_FIX_REPORT

미션: N°1 LAUNCH 2026-09-10 · P0 LAUNCH BLOCKER (§54–§62)
작성: 2026-09-09 · ZCode (engineering) + HERMES Master (credential owner)

## 1. ROOT CAUSE (§56–§57 추적 결과)

분류: **D/F — 이벤트 생성·파이프라인 정상, 런타임 credential 미주입**

실측 이벤트 경로:

1. 고객 "상담원 연결" → CsWidget → `POST /api/chat` ✓
2. `lib/csEngine.ts:408` escalation → `HUMAN_PENDING` 전환 ✓
3. `sendEscalationTranscript` (`csEngine.ts:446`) 호출 ✓
4. `process.env.N1_CS_BOT_TOKEN / N1_CS_CHAT_ID` **빈 값** → 정직한 미전송 반환
   (`console.warn "[cs] N1_CS_BOT_TOKEN/N1_CS_CHAT_ID 미설정 — escalation 미전송"`)
5. Telegram API 호출에 도달하지 않음 (D단계)

코드 파이프라인(RAW transcript + summary + message_id 앵커 + verbatim relay)은
기존 구현이 완전했고, 수정은 credential 주입이었다. 코드 버그 없음.

## 2. FIX

- HERMES Master가 자체 도구 레이어로 `n1-storefront/.env.local`에 주입 (04:58:10 KST):
  - `N1_CS_BOT_TOKEN` — HERMES 루트 .env의 봇3(CS 전용) 토큰. `getMe` 무료 검증 PASS
    (is_bot=true, username `n1_c…`), 봇2(결제알림)와 id 프리픽스 대조로 봇3 판별, 09-03 백업 2종과
    지문 비교로 최신 로테이션 값 확인.
  - `N1_CS_CHAT_ID` — 키명 부재 → HERMES `ESCALATION_CHAT_ID`(cs_subagent_handler.py:35의
    긴급 에스컬레이션 수신처 = 운영자)를 매핑 주입.
  - `N1_CS_WEBHOOK_SECRET` — 저장소에 없음 → 미추가 (poll 폴백 사용).
  - 원본 1,895바이트 보존 검증(접두 sha256 일치), append-only.
  - 토큰·chat id 실제값은 어떤 회신·로그에도 출력되지 않음 (§55 준수).
- 서버 재기동(`next dev -p 3211`)으로 env 로드.

## 3. REAL SAFE TEST (§58)

- 시나리오: 신규 대화에서 "안녕하세요" → welcome 1회 → "상담원 연결해주세요"
- 결과: `status=HUMAN_PENDING, escalated=true` — 전송 실패 에러 로그 **부재**
  (코드는 실패 시 `[cs] Telegram escalation 전송 실패`를 기록)
- 반환 채널 검증: `POST /api/telegram/poll` → `ok:true` (getUpdates로 봇3 자격 유효 실측)
- delivery evidence: `sendTelegramLong`은 Telegram API 수락 시에만 message_id를 반환하고
  세션 앵커로 저장 — 실패 시 로그가 남는 구조상 수리된 것으로 판정.

## 4. VERIFIED vs OWNER CONFIRMATION 필요

| 항목 | 상태 |
|---|---|
| credential 런타임 주입 | ✅ 실측 (poll 200, getUpdates 유효) |
| escalation 전송 수리 | ✅ 강한 간접 증거 (fail-로그 부재 + message_id 앵커 구조) |
| 운영자 텔레그램 실물 수신 | ⏳ Owner 육안 확인 필요 (§58 후반부) |
| 인간 답장 → 고객 verbatim 릴레이 | ⏳ Owner가 티켓에 답장 시 자동 검증 (§61, 활성 대화 자동 라우팅 구현됨) |

## 5. REGRESSION (§63–§65, §77)

`mission-20260909/cs_regression.cjs` 전 시나리오 PASS:
welcome 1회 / 날씨 문맥 응답 / 상품 소재 질문(검증 데이터만 — UNKNOWN은 "보강 중" 정직 안내) /
미존재 주문번호 정직 실패 / escalation 트리거 / HUMAN_PENDING 중 AI 침묵.
단위: tests/cs.test.cjs 16케이스 + csTalk 13 + spam gate — 전체 74/74 PASS.
