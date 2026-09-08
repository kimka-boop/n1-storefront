# N1 SESSION E — N°1 OUTFIT PAIRING ENGINE REPORT (TASK 26)

> 날짜: 2026-09-09 · 세션: E (Pairing Engine) · 정책: N1_PAIRING_POLICY_V1 (HERMES 소유)
> 결과: **COMPLETE — E1–E7 인수 테스트 28/28 통과, 배치 아티팩트 바이트 일치 재현, UI/Smart Fit 무변경**

---

## 0. 요약

Session E는 N°1 컬렉션의 TOP×BOTTOM 페어링에 대한 **정책(N1_PAIRING_POLICY_V1)과
사전 계산된 페어 데이터의 소유 세션**이다. 본 세션에서 (1) 선행 런치 RC 작업에서
초안된 정책·엔진·페어 데이터를 인수 검증하고, (2) 하드게이트를 명시적 함수로
구현해 엔진 정합성을 담보했으며, (3) TASK 26 계약 필드(`confidence`, `verified_at`)를
추가해 산출 데이터 계약을 확정했고, (4) E1–E7 인수 테스트 28 케이스를
신설·통과시켰다. **페어 배정·스코어·티어는 1건도 변경되지 않았다** (E7 바이트 일치로 증명).

## 1. 소유권 경계 (OWNERSHIP)

| 영역 | 상태 |
|---|---|
| N1_PAIRING_POLICY_V1.md | ✅ 소유 — 보완(§4 각주, §6 한계 고지, §7 테스트 게이트, §11 신설) |
| pairing_results.json (사전 계산 페어 데이터) | ✅ 소유 — 계약 필드 추가 재생성, 배정 무변경 |
| pairs_compute.py / recompute_pairs.py (엔진) | ✅ 소유 — 게이트 명시화·계약 필드·견고성 수정 |
| pairs_tests_e1_e7.py (인수 테스트) | ✅ 소유 — 신설 |
| 프론트엔드 UI / Smart Fit / lib/fit* / components | ⛔ **수정하지 않음 — STOP** |
| Master DB 라이브 시트 (Products/Pairs) | ⛔ 재기록하지 않음 — 라이브 Pairs 탭은 기존 배치와 동일 내용이므로 유지 |

## 2. HERMES 정책 (§1)

정책 문서 `N1_PAIRING_POLICY_V1.md`는 HERMES 비준(2026-09-09) 원안을 유지하며
아래 4개의 dated 정정·보강만 추가했다.

1. **§4 B COLOR** — "일측 미확인 15" 보간치를 명문화(양측 미확인 13, 한쪽만 아는 경우 중간값). 엔진이 이미 이 값으로 동작 중이었으므로 문서 정합화다.
2. **§6 매칭 한계 고지** — 플로어 우선 k-축소 시 제외 상품은 카탈로그 순서 후미부터다(부분집합 최적화 아님). RC 배치에서 비준된 미매칭 세트(여성 4개)를 산출한 방식이므로 유지, 최적 부분집합 선택은 V2 승격 후보로 기록.
3. **§7 테스트 게이트** — 배치 확정의 조건을 E1–E7 전량 통과로 명문화.
4. **§11 OUTPUT CONTRACT 신설** — 원본 배치 → Pairs 시트 → 프론트엔드 계약의 3계층 필드 정의.

trend/product research policy 재사용 지시에 따라, 페어링 입력은 선행 리서치
세션의 산출물을 그대로 재사용했다: TREND CLUSTERS T01–T10(N1_TREND_EVIDENCE,
FW26 리서치 73건), 상품 파생 태그(sub/colors/silhouette/season은 공급사 타이틀
토큰 기반), catalog_selected.json(44종). 신규 리서치는 수행하지 않았다.

## 3. 하드게이트 (§2) — 구현

스코어 계산 **이전**에 `passes_hard_gates()` + `partition_scopes()`로 적용한다.

| 게이트 | 내용 | 구현 |
|---|---|---|
| Category | TOP(의류-상의) × BOTTOM(의류-하의)만. 그 외 조합 불가 | `top_bottom` 검사 — 아우터·악세사리는 후보 자체가 안 됨 |
| Availability | 판매불가(품절/SOLD OUT/중단 토큰, `publish_ready=false`) 제외 | `availability_ok()` — 감사 토큰 부재는 불가 판정 근거가 아님(§8 uncertainty) |
| Gender/context | 스코프(MALE/FEMALE/GENDERLESS) 교차 페어 금지 | `partition_scopes()` — 스코프별 후보군 분리로 교차가 구조적으로 불가능 |
| Data quality | 상품ID·명칭·매입가·판매가 결손 제외 | 식별/가격 필드 존재 검사 |

E4·E5·E6 테스트가 각 게이트를 합성 fixture로 검증한다 (§7 표).

## 4. 스코어 (§3) — 7축, 고객 노출 금지

PAIR SCORE V1(정책 §4) 그대로: TREND 20 · COLOR 20 · SILHOUETTE 20 ·
MATERIAL·SEASON 15 · OCCASION 10 · PRICE 5 · DATA 5 (합계 상한 95, H DIVERSITY는
스코어 축이 아니라 매칭 목적함수의 동색 반복 패널티 −2/중복으로 반영).
`pair_score_internal`·`score_breakdown`·`confidence`는 **내부 전용**이며
프론트엔드 계약 필드에 존재하지 않는다. 노출 문구는 "함께 입기 좋은" 수준의
QUIET 톤만 허용(정책 §9) — 테스트가 reason 내 점수·퍼센트·AI 표기 유무를 검사한다.

## 5. 최대가중 매칭 (§4) — 그리디 금지

- 스코프별 TOP×BOTTOM **전수 순열 탐색**으로 정확 최적해(최대가중 1:1 매칭)를 구한다. RC 규모(≤8×8)에서 그리디가 놓치는 전역 최적(합 173 vs 150 합성 케이스)을 엔진이 잡는 것을 E2가 증명한다.
- **플로어 우선**: SECONDARY_FLOOR(68) 미달을 피해 k를 2쌍까지 줄인다(스코프당 미매칭 ≤4). 그래도 불가하면 전부 매칭하되 BELOW_THRESHOLD로 표기해 primary 뷰에서 제외한다 — **나쁜 조합을 억지로 만들지 않는다**(E3 검증).
- 구조적으로 1:1이다 — 한 상품이 2개 페어에 등장하는 것은 배치 불변식 위반(E2).

## 6. 산출 데이터 (§5) — stable contract

`pairing_results.json` (20 pairs — 남성 8 · 여성 6 · 젠더리스 6, BEST 5 · BELOW 3,
미매칭 4 = 여성 상2·하2, 배치일 2026-09-09) 레코드 필드:

`pair_id` · `collection_scope`/`scope_label` · `top_product_id`/`bottom_product_id`(+표시명) ·
`pair_score_internal` · `score_breakdown` · `tier` · `trend_clusters` ·
`pair_reason_short` · **`confidence`(신설: G DATA 축 파생 HIGH/MEDIUM)** ·
**`verified_at`(신설: 본 배치 QA 검증일)** · `generated_at`

3계층 노출 축소(정책 §11): 원본 배치(json) → Master DB Pairs 시트(스코어 포함 9열,
confidence·verified_at 미기록) → 프론트엔드 `lib/pairs.ts` `CatalogPair`
(스코어·confidence·tier 제거 후 반환, BELOW_THRESHOLD 제외).
**NO LLM ON PAGEVIEW(§6)**: 페어링은 배치 사전 계산이며 페이지뷰 시점 LLM 호출·
런타임 스코어 계산은 금지 — 프론트엔드는 mapping만 읽는다. 이번 세션에서 페이지뷰
경로에 어떤 변경도 가하지 않았다.

## 7. 테스트 (§7) — E1–E7, 28/28 PASS

실행: `python pairs_tests_e1_e7.py` (2026-09-09, 18.9s) → **OK (28 tests)**.

| ID | 시나리오 | 케이스 | 결과 |
|---|---|---|---|
| E1 | valid top-bottom — 전 페어 상의×하의, 게이트 통과, tier↔threshold 일치, breakdown 합계, QUIET reason, 계약에 스코어 없음 | 6 | ✅ |
| E2 | duplicate exposure — pair_id 유일, 상품 2페어 등장 금지, 최대가중이 그리디를 이김, 합성 1:1 | 4 | ✅ |
| E3 | unmatched — 미매칭 4개(여성 하2 상2, 스코프당 상한 4), BELOW 3쌍 primary 제외, 플로어 우선으로 나쁜 페어 강제 안 함, 한쪽 부족 시 min(n,m)쌍 | 4 | ✅ |
| E4 | bad data — 식별자/카테고리 결손 게이트, UNKNOWN 색상 중간값(13/15), 부분 데이터 → confidence MEDIUM, 오염 상품 배치 생존 | 5 | ✅ |
| E5 | gender scope — 배포 페어 전체 동일 스코프, 분리 파티션, 교차 페어 구조적 불가 | 3 | ✅ |
| E6 | unavailable — 품절/판매중단/게시중지 게이트, 감사 토큰 부재는 거부 근거 아님, 품절 하의 배치 제외 | 3 | ✅ |
| E7 | deterministic — compute 순수성, **배포 아티팩트와 바이트 일치**, pair_id 순서 안정 | 3 | ✅ |

**테스트 과정에서 발견·수정한 사항**
- 엔진이 top 수 > bottom 수인 스코프에서 매칭을 통째로 포기하던 결함 → `min(n,m)`쌍까지 매칭하도록 수정(현 배치에는 영향 없음).
- 정책 문서와 엔진 주석의 B COLOR·D MATERIAL 수치 불일치 → 정책 문서를 단일 소스로 정합화.
- 부분집합 선택이 입력 순서 의존인 것을 확인 → 엔진 유지(비준된 배치 보존), 정책 §6에 한계 고지 + V2 후보 등록.

## 8. STOP — 경계 외 변경 없음

실제 UI(페어 컬렉션 렌더링), Smart Fit(`lib/fit*`, `components/SmartFitFlow`),
CS·카트·체크아웃 경로, 라이브 Google Sheets는 **일절 수정하지 않았다.**
페어 배정·스코어·티어가 선행 비준 배치와 완전히 동일함을 E7이 보장하므로,
라이브 Pairs 탭 및 프론트엔드는 재배포 없이 그대로 유효하다.

## 9. 산출물

| 파일 | 구분 |
|---|---|
| `mission-20260909/N1_PAIRING_POLICY_V1.md` | 정책 (HERMES 소유) — Session E dated 보강 |
| `mission-20260909/pairing_results.json` | 사전 계산 페어 데이터 — confidence·verified_at 추가, 배정 무변경 |
| `mission-20260909/pairs_compute.py` | 페어링 엔진 — 게이트 명시화·계약 필드·견고성 |
| `mission-20260909/recompute_pairs.py` | 재계산 래퍼 (§10 케이던스 준수) |
| `mission-20260909/pairs_tests_e1_e7.py` | E1–E7 인수 테스트 (28 케이스) |
| `mission-20260909/N1_SESSION_E_PAIRING_ENGINE_REPORT.md` | 본 보고서 |
