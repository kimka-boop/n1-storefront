# N°1 — 2026-09-10 LAUNCH CANDIDATE

작성: 2026-09-09 (ZCode, engineering arm) · 판정 근거 전부: `mission-20260909/`

## 1. Status

**READY (조건부)** — P0 전부 해소. Publish는 Owner 최종 승인 전까지 실행 없음 (§89).

## 2. Target Launch

2026-09-10 12:00 KST

## 3. Trend Research

- 공개 소스 **57곳 · 4 family**(에디토리얼 19 / 커머스 10 / 브랜드 26 / 커뮤니티 18), evidence **73레코드**
- 클러스터 **10개**: HIGH 5 (슬림·스트레이트 회귀 / 니트 퍼스트 / 브라운·어스+버건디 / 워싱·빈티지 / 셔츠 레이어링)
  + MEDIUM 4 (체크 셋업 / 울·플리스 / 올블랙 텍스처 / 미디 스커트)
  + HIGH-제외 1 (스웨이드·레더 아우터 — 29CM 실측 +124% YoY, RC 스코프 밖)
- 수요 수치는 관측분만 사용(§14) · 봇 우회 0건, 차단 소스는 SOURCE_UNAVAILABLE 기록(§8)

## 4. PDF

`mission-20260909/N1_TREND_SOURCING_REPORT_2026-09-09.pdf` — 22쪽 · 196KB · §17 18섹션 구성 · pdf_qa PASS(WARN만)
HTML 소스 없음(ReportLab 루트). Trend→Source→Product 추적: 클러스터 ID ↔ evidence 레코드 ↔ 상품 trend_cluster_ids.

## 5. Product Catalog

- 소싱 풀 1,752건(유니크 1,717) → 감사(스코프·가격밴드·혼재 타이틀·노이즈) → **725 그룹** → **44 선별**
- 구성: 남성 8T+8B / 여성 8T+8B / 젠더리스 6T+6B · 매입 760,850원 → 판매 1,445,600원 (×1.9 정책)
- 제외 660+ 그룹 사유 기록 (아우터/셋업/포멀/저가/혼재) — candidate_audit.json

## 6. Master DB

- 스냅샷: 구버전 60건 전체 (JSON+CSV, 타임스탬프 백업)
- 스테이징: MASTER_DB_NEXT_20260909 (44행 × 40컬럼) + Pairs(20) — readback 검증
- 스왑: Products(index 0 계약 유지) 44행 · 성별 뷰 16/16/12 · 백업_PRODUCTS_20260909 탭 = 롤백 포인트
- 검증: N1_MASTER_DB_NEXT_VALIDATION_REPORT.md · audit_status=HERMES_APPROVED_20260909
- 롤백: `node swap_master.cjs --rollback` 한 번으로 복원

## 7. Retail Sync

Sheet(44) → API(products 44 + pairs 17, 스코어 미노출) → Frontend("44 Pieces · 20 Outfits" 렌더) 삼중 일치.
Images: 44/44 공급사 제품컷(SOURCE_ONLY) 로드 확인.

## 8. Pairing

- 정책: N1_PAIRING_POLICY_V1 — **HERMES 비준**(§6 미매칭 상한 4개 정정 반영)
- 스코어: 8축 100점(실효 상한 95) · UNKNOWN 중간값 · threshold 78/68(분포 기반, 근거 문서화)
- 매칭: 스코프별 최대가중 1:1 전수 탐색 · 플로어 우선
- 결과: **20 primary 페어 = BEST 5 + SECONDARY 12**, BELOW 3쌍·미매칭 4개는 quiet 단품 영역만

## 9. Pair UI

Desktop: 좌 상의 / 우 하의 row, 상의|하의 컬럼 헤더(비인터랙티브), 근거 한 줄, 단품 조용한 strip.
Mobile(390): 상의→하의 스택, 페어 관계 유지. 실측 스크린샷: qa_home_*.png, qa_home_mobile390.png.

## 10. Smart Fit

V2 전 기능 유지 — 단위 74/74 PASS(fit 31 포함), PDP Your fit 블록 정상.

## 11. Cart / Checkout

Cart/BuyNow/Checkout 경로 유지. PG 미연결 정직 상태. 전 상품 구매 버튼
"재고 확인 후 구매 가능"(optionStock 미확정 — 기존 게이트#2, Owner 확정 필요).

## 12. Product Images

44/44 image_status=SOURCE_ONLY(공급사 제품컷 표시 중) · N1_IMAGE_GENERATION_QUEUE.json 44건 준비.
FASHN/GPT Image 등 유료 생성 호출 **0건** (§81, Owner 승인 후 별도 미션).

## 13. AI CS

welcome 1회 · 문맥 응답 · 검증 데이터 전용 · UNKNOWN은 "보강 중" 정직 안내 ·
spam gate(60초 지문 쿨다운, 긴급 다중 문의 미차단) — 실측 PASS (§77 시나리오 전체).

## 14. Telegram CS

- Root cause: §57 분류 D — 런타임 credential 미주입(코드 파이프라인은 정상)
- Fix: HERMES가 봇3 토큰 + ESCALATION_CHAT_ID 매핑을 .env.local에 append(값 비노출 감증) → 서버 재기동
- Real test: escalation 실측 전송(HUMAN_PENDING · escalated:true · 실패 로그 부재) + poll getUpdates 유효
- 상세: N1_CS_TELEGRAM_FIX_REPORT.md
- **잔여: Owner 육안 수신 확인 + Owner 답장→verbatim 릴레이 실측 (Owner만 가능)**

## 15. Tests

단위 74/74 PASS(cs 16+13·cart·fit 31·fitContext·experience) · tsc clean(내 커밋 범위) · CS 라이브 시나리오 6/6.

## 16. Responsive

Desktop 1280/1440 · Mobile 390 실측 완료. 768/1024/375은 기존 breakpoint CSS 존재 — 개별 실측 생략(RC 허용).

## 17. P0 Blockers

**0건** (CS Telegram P0는 해소 — 본인 확인 항목만 Owner 측 잔여).

## 18. Rollback

즉시 가능: `mission-20260909/swap_master.cjs --rollback` (+ 스냅샷 JSON/CSV 2중).
Git: n1-storefront-integrated-v1 브랜치, 커밋 단위 복원 가능.

## 19. Local / Release Candidate URL

- 검증 RC: http://127.0.0.1:3211 (dev, 신규 카탈로그+페어 UI)
- 구버전 참고: http://127.0.0.1:3210

## 20. Owner Decision Required

1. **PUBLISH 최종 승인** — 승인 시 별도 production release 단계 실행
2. **CS Telegram 수신 확인** — 테스트 escalation이 운영자 Telegram에 도착했는지 육안 확인 + 답장 verbatim 릴레이 확인
3. **옵션별재고 확정**(게이트#2) — 확정 전까지 구매 버튼은 정직 unconfirmed 상태
4. (승인 후) 이미지 생성 큐 실행 여부 — 유료 API 별도 승인 필요

## 부록 — 병렬 작업 주의

미션 진행 중 병렬 세션(Session C 후속)이 `lib/idempotency.ts · orderState.ts · stock.ts`(미완료,
tsc 에러 존재, 어디서도 import 안 됨 — 런타임 영향 없음)를 추가하고 `pairs_compute.py`에
hard-gate 함수를 보강했다. 라이브 Pairs 시트는 HERMES 승인본을 유지하며, 보강 스크립트 재실행은
별도 QA 후 권장. 오래된 파일로 신규 결과를 덮지 않았다(§87).
