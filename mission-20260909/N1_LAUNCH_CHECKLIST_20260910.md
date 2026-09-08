# N1_LAUNCH_CHECKLIST_20260910

대상 출시: 2026-09-10 12:00 KST · RC 확정: 2026-09-09 (ZCode × HERMES)

## DATA
- [x] snapshot — N1_MASTER_DB_SNAPSHOT/MASTER_DB_BACKUP_2026-09-08T1940_* (60건 전체, JSON+CSV)
- [x] staging — MASTER_DB_NEXT_20260909 (44행 × 40컬럼) + Pairs (20페어)
- [x] validation — readback 44행 · 중복 0 · 필수 결손 0 (N1_MASTER_DB_NEXT_VALIDATION_REPORT.md)
- [x] swap — Products(index 0 유지) 44행 · 성별 뷰 16/16/12 재구성
- [x] rollback — `node swap_master.cjs --rollback` (백업_PRODUCTS_20260909 탭) 검증 절차 문서화
- [x] Sheet/API/Frontend 일치 — 삼중 readback (44 · 44+17페어 · 44 Pieces 20 Outfits 렌더)

## RESEARCH
- [x] sources — 57 고유 공개 소스 · 4 family · 차단 사이트 SOURCE_UNAVAILABLE 기록 (§8 준수)
- [x] evidence — 73 레코드 (N1_TREND_EVIDENCE/N1_TREND_EVIDENCE.json)
- [x] PDF — N1_TREND_SOURCING_REPORT_2026-09-09.pdf (22쪽 · 196KB · pdf_qa PASS/WARN-only)

## CATALOG
- [x] selected products — 44 (남 8T+8B / 여 8T+8B / 젠 6T+6B)
- [x] duplicates — canonical 그룹화(1,717 → 725) 후 중복 0
- [x] data quality — §29 게이트 통과. 소재·고시·옵션별재고는 UNKNOWN(정직) — 게이트#2 잔여
- [x] trend links — 42/44 명시 클러스터, 2건 베이스 보완 사유 기록

## PAIRING
- [x] policy — N1_PAIRING_POLICY_V1.md (HERMES 비준, §6 미매칭 상한 4개 정정 반영)
- [x] scores — 8축 V1 · 분포 min60/median71/max80 · threshold 78/68(분포 기반, 문서화)
- [x] matching — 스코프별 최대가중 1:1 전수 탐색 · 플로어 우선
- [x] QA — HERMES 전수 실측 승인 (20페어 · breakdown 합 일치 · 무재사용 · 스코프 교차 없음)
- [x] desktop — 페어 row(좌 상의/우 하의) + 근거 한 줄 + 단품 영역 실측
- [x] mobile — 390px 상의→하의 스택, 페어 관계 유지 실측

## SMART FIT
- [x] works — 단위 74/74 PASS(fit 31 + fitContext 포함), PDP Your fit 블록 유지 확인

## COMMERCE
- [x] cart — 장바구니 오브/Drawer 유닛 PASS (cart.test.cjs)
- [x] buy now — stashBuyNow 단일 항목 경로 유지
- [x] checkout — PG 미연결 정직 처리 유지 (fake success 없음)
- [x] 구매 버튼 — 전 상품 "재고 확인 후 구매 가능" 정직 상태 (optionStock 미확정 — 게이트#2)

## CS
- [x] AI — welcome 1회 · 문맥 응답 · 검증 데이터 전용 · UNKNOWN 정직 안내 (§77 실측 PASS)
- [x] spam control — 60초 윈도우 지문 쿨다운 · 긴급 다중 문의 미차단 (csTalk 13케이스)
- [x] order lookup — 미존재 주문번호 정직 실패 확인
- [x] human escalation — HUMAN_PENDING 전환 + escalated:true 실측

## TELEGRAM
- [x] outbound — credential 주입(HERMES) + 실측 전송 (N1_CS_TELEGRAM_FIX_REPORT.md)
- [x] transcript — RAW 전사본 + summary 구조 기존 구현 검증
- [ ] **Owner 수신 육안 확인 — 미완료 (Owner만 가능)**
- [ ] **Owner 답장 → verbatim 릴레이 실측 — 미완료 (Owner 답장 필요, 활성 대화 자동 라우팅 구현됨)**

## SECURITY
- [x] secrets not exposed — 토큰·키 값 어떤 로그/아티팩트에도 미기록 (HERMES turn A 감증)
- [x] PII protected — 주문번호 단독 조회 시 비민감 요약만 (toSafeOrderView)
- [x] SSRF 가드 — 소싱/상세 수집기 고정 호스트 검증 · same-site 리다이렉트 한정

## RESPONSIVE
- [x] desktop 1280/1440 — 페어 레이아웃 실측
- [x] mobile 390 — 스택 페어 실측
- [ ] 768/1024/375 — 컴포넌트 반응형 CSS 존재(640px breakpoint) · 개별 실측 생략 (RC 허용)

## IMAGES
- [x] status known — 44/44 SOURCE_ONLY (공급사 제품컷 표시 중)
- [x] paid generation deferred — FASHN/GPT Image 호출 0건 · N1_IMAGE_GENERATION_QUEUE.json 준비

## PG
- [x] honest status — 미연결 명시, fake success 없음

## PRODUCTION
- [ ] **NOT published — Owner 최종 승인 대기 (§89)**
