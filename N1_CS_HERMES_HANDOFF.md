# N1_CS_HERMES_HANDOFF

N°1 AI CS V1 → HERMES / Telegram 인계 문서 (SESSION C 작성, 2026-09-09)
브랜치: `n1-commerce-cs-v1`

---

## 1. 현재 아키텍처

```
고객(CS 위젯) ──POST /api/chat──▶ lib/csEngine (상태 머신 + 검증 데이터 응답)
                                   │
                                   ├─ 주문 조회: lib/sheets (Orders/Customers 시트)
                                   ├─ 상품 답변: lib/catalog (Products 시트 — PDP와 동일 데이터)
                                   ├─ 정책 답변: lib/cs (확정 텍스트)
                                   │
                                   └─ escalation ──▶ lib/telegram (봇3 CS 채널)
                                                      RAW transcript + summary + 사유
운영자 답장 ──Telegram──▶ /api/telegram/webhook ──▶ lib/csRelay ──▶ 고객 VERBATIM 릴레이
(webhook 미설정 시: POST /api/telegram/poll 폴백)
```

- AI는 규칙 기반 + 검증 데이터 전용이다. 독립 LLM service는 만들지 않았으며,
  LLM 기반 n1-cs worker가 필요하면 HERMES Master에 capability contract로 요청하는 위치는
  `lib/csEngine.buildTopicalAnswer()` (응답 생성기) 교체 지점이다. 인터페이스:
  `handleCustomerMessage(sid, message, customer) → { sid, reply, status, escalated }`
- 세션 스토어: V1 서버 인메모리 (`lib/csStore.ts`, `globalThis.__csStore`).
  서버 재시작 시 초기화 — 클라이언트는 sid 무효(404) 감지 시 새 대화 시작.

## 2. 대화 상태 머신 (lib/cs.ts)

`NEW → GREETED → AI_ACTIVE ⇄ ORDER_CONTEXT → HUMAN_PENDING → HUMAN_ACTIVE → RESOLVED`

- scripted welcome은 대화당 1회 (첫 메시지가 인사-only일 때만). 이후 인사는 문맥 응답.
- 첫 메시지에 주문번호가 있으면 welcome 생략하고 바로 조회 (미션 §43).
- HUMAN_PENDING/HUMAN_ACTIVE에서 AI는 응답하지 않는다 (전사 기록 + 운영자 알림만).
- escalation 중복 생성 금지 (한 대화 = 하나의 활성 티켓).

## 3. 권한 경계 (미션 §23 — lib/cs.classifyEscalation)

AI 처리(READ/설명): 인사·이용안내, 검증된 상품정보(소재/사이즈/세탁/가격/재고상태),
주문 상태 조회, 배송/교환/반품/환불 **정책 설명**.

Human escalation: 상담원 명시 요청, 정책 예외·보상·할인, 환불·결제 분쟁, 불량·사고 책임 판단,
주문 변경 등 쓰기 작업(주문 컨텍스트에서의 취소/교환/변경 요청), 계정·개인정보, 사기·법률,
확인된 데이터 부족, 고객 불만 2회 연속.

## 4. 데이터 계약

### Orders 시트 (기존 + 신규 3컬럼)
기존 컬럼 유지 + `고객ID`, `고객이메일`, `주문출처`(cart|buynow) 추가.
CS 조회 함수: `findOrderById`, `findOrdersByPhoneLast4`, `findOrdersByCustomerEmail` (lib/sheets.ts).

### Customers 시트 (신규 — 최소 구조)
`customer_id / 유형(MEMBER|GUEST) / account_email / 이름 / 연락처 / 생성일 / 수정일 / 상태`
- 주문 인입 시 upsert. 회원은 email 키, 게스트는 연락처 키 재사용.
- 게스트가 이후 회원 주문을 하면 유형만 MEMBER로 승격 (원본 주문 history 불변).

### CS 세션 (lib/csStore.ts — 최소 persistence)
`conversation_id / status / customer(label·type·email) / messages(role·text·ts·delivered) /
orderRefs / greetSent / telegramMsgIds / timestamps`
- `label`(`비회원 N`)은 운영자 컨텍스트 전용 — 고객 UI 비노출.
- 영속화 필요 시: Sheets `CS_Conversations` 또는 Redis로 `getStore()`만 교체하면 된다.

## 5. Telegram 운영 봇(봇3) 설정

env (배포 시 설정, 시크릿은 리포트에 기록하지 않는다):

```
N1_CS_BOT_TOKEN      # CS 전담 봇 토큰 (봇3)
N1_CS_CHAT_ID        # 상담 운영 채널 chat id
N1_CS_WEBHOOK_SECRET # (권장) setWebhook secret_token
```

- escalation 발송: RAW 전사본 + 고객/주문 컨텍스트 + 사유. 4096자 제한 준수 분할 발송
  (`sendTelegramLong` — 첫 청크 message_id를 앵커로 저장).
- 답장 매핑(우선순위): ① 티켓 원문에 대한 `reply` → 해당 대화 ② 활성 대화 1개뿐이면 자동 ③
  아니면 지정 요청 안내 (추측 라우팅 금지).
- 운영자 명령: `/start`, `/help`, `/ai`(해당 대화를 AI 상담으로 복귀).
- webhook 등록: `setWebhook url=https://<도메인>/api/telegram/webhook`.
  webhook 미설정 환경은 `POST /api/telegram/poll {"offset": N}` 폴백 (getUpdates — webhook과 동시 사용 불가).
- 전송 실패 시 거짓 성공 없음: 로그 경로 `[cs] Telegram escalation 전송 실패`,
  고객 안내는 "연결하겠습니다" 상태만. (재시도: 다음 고객 메시지에서 messageId 미보유 시 재전송)

## 6. 프라이버시 규칙 (미션 §32–§36, lib/cs.ts)

- 주문번호만으로: 항목·상태·택배 정보 등 비민감 요약만 제공 (`toSafeOrderView`).
- 민감정보(전체 전화번호/주소/이메일/결제정보)는 제공 경로 자체가 없다 — 필요하면 상담원 경유.
- 본인확인: `verifyByPhoneLast4` (주문 연락처 뒷자리 4) — V1에서는 상담원 검증 보조용.
- 회원은 로그인 이메일 == 고객 레코드 email일 때 자기 주문을 문맥으로 조회
  (`findOrdersByCustomerEmail`, 1건이면 즉시 요약, 복수면 목록 제시 후 선택).

## 7. HERMES 의존 항목 (요청 목록)

1. **n1-cs LLM worker(선택)**: 규칙 기반 한계를 넘는 자연어 이해가 필요해지면,
   `lib/csEngine`의 응답 생성기를 HERMES n1-cs capability로 교체. 입력: conversation 전사 +
   검증 컨텍스트(orderView, productData). 출력: reply. hallucination 방지 규칙(검증 데이터 외 금지)은
   system contract로 유지.
2. **CS 세션 영속화(선택)**: 인메모리 → Redis/Sheets. `getStore()`/`writeStore` 교체 지점.
3. **재시도 큐(선택)**: Telegram 전송 실패 시 현재는 다음 메시지 시 재전송. 전용 retry가 필요하면
   HERMES task layer에 위임.

## 8. 테스트

- 유닛: `tests/cs.test.cjs` (16케이스 — greeting-once, escalation 경계, 주문번호 인식,
  프라이버시 마스킹, VERBATIM 릴레이, 전송 실패 정직성) — `node --test tests/*.test.cjs`
- 브라우저 QA: 인사 1회/재인사 문맥/상품 문의/상담원 escalation/상담원 응대 배지/
  새로고침 대화 복원/운영자 답장 verbatim 수신 — 2026-09-09 실측 완료.
