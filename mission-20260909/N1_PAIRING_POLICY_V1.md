# N1 OUTFIT PAIRING POLICY V1

> N°1 상하의 페어링 정책 — 2026-09-09 제정 (LAUNCH RC 기준)
> Owner: HERMES Master (정책 소유) / 작성·구현: ZCode (engineering arm)
> 상태: **APPROVED — HERMES 비준 2026-09-09** (§6 스코프당 미매칭 상한 4개로 정정, 그 외 원안)

## 1. PURPOSE

N°1 컬렉션은 단일 상품 나열이 아니라 **한 row = 추천 코디 1벌(TOP×BOTTOM)** 로 전시한다.
이 문서는 어떤 상/하의 조합을 추천 조합으로 계산·전시할지의 유일한 기준이다.

- 페어링은 **catalog curation 단계에서 사전 계산**된다 (§37 — LLM per pageview 금지).
- 결과는 Master DB의 `Pairs` 탭 + 상품 레코드의 `primary_pair_id` 로 저장된다.
- 프론트엔드는 계산된 mapping만 읽는다. 런타임 점수 계산 금지 (§80).

## 2. INPUTS

- MASTER DB Products 레코드 (publish eligible 상태만)
- TREND CLUSTERS T01–T10 (N1_TREND_EVIDENCE — FW26 리서치 73건 기반)
- 상품 파생 태그: `sub`(아이템 타입), `colors`(색상 패밀리), `silhouette_class`, `season_class`

## 3. HARD GATES (§38)

페어 후보는 스코어 계산 **이전에** 아래를 모두 충족해야 한다.

1. TOP(의류-상의) + BOTTOM(의류-하의) 조합 — 그 외 조합 불가
2. 양측 모두 publish eligible (`publish_ready=true`, 재고상태 정상)
3. 동일 gender scope (MALE/FEMALE/GENDERLESS) — §35 동일 customer-use context 원칙
4. 기본 데이터 존재 (sub, cost, name)
5. `silhouette_class` 미확정 항목은 "regular"로만 하며 이미지 감으로 실측을 단정하지 않는다 (§43)

## 4. PAIR SCORE V1 — 100점 모델 (§39)

내부 머천다이징 랭킹 전용. **고객 노출 금지** (§40 — "96% 궁합" 류 표현 금지).

| 축 | 배점 | 규칙 |
|---|---|---|
| A TREND | 20 | 클러스터 교집합 10/개 (최대 16) + evidence 보완 조합 보너스 4 (니트×셔츠/니트×데님/셔츠×슬랙스 — T02·T06 근거). 교집합 0은 4점 |
| B COLOR | 20 | neutral×neutral 20 / 데님 관여 17 / neutral+color 16 / color+color 11 / 미확인쌍 13 (§44 — UNKNOWN은 가감 없이 중간값) |
| C SILHOUETTE | 20 | oversized×straight 20 / regular×straight 18 / regular×semiwide 16 / oversized×wide 6 — §41 "compact top + relaxed bottom" 반복 관찰 반영 |
| D MATERIAL·SEASON | 15 | 셔츠×니트 15 (T06 레이어링), 니트×데님 15 (T02 기본 공식), 기모×니트 14, 동일 시즌 13, 시즌 상충 11 |
| E OCCASION | 10 | 셔츠×슬랙스(오피스) 10, 캐주얼 공식(니트/스웨트×데님/트레이닝) 10, 체크×체크 3, 기타 8 |
| F PRICE | 5 | 세트 판매가 4–9만원 5 / 3–12만원 4 / 극단 2 |
| G DATA | 5 | 양측 sub+cluster 완비 5 / 일측 결손 3 |
| H DIVERSITY | (matching 단계) | 동일 색패밀리 반복 −2/중복, 매칭 목적함수에서 반영 |

## 5. THRESHOLD (§46 — 분포 기반 조정)

V1 실측 분포 (44상품, 2026-09-09): min 60 / median 71 / max 80.

- **BEST_MATCH ≥ 78** — primary 컬렉션 row 1순위
- **SECONDARY ≥ 68** — primary row 허용
- **< 68** — primary 페어 금지. 양측 상품은 컬렉션 하단 quiet "단품으로 보기" 영역으로.

예시의 80/70이 아니라 78/68을 채택한 근거: 점수 상한이 95점(7축 합)이고
UNKNOWN 데이터 비중이 높은 RC 카탈로그 특성상 80+는 상위 10%뿐.
§46 "실제 distribution을 보고 threshold 조정" 조항 적용.

**2026-09-09 HERMES 비준 각주**: 소싱 실측은 풀 1,752건(유니크 1,717) → 감사 후
그룹 725개 → 44개 선별. BELOW 3쌍(66·66·65)·미매칭 4개(여T 2·여B 2)는
quiet 단품 영역만 노출.

## 6. MATCHING ALGORITHM (§45)

- 스코프별(남성/여성/젠더리스) TOP×BOTTOM **최대가중 1:1 매칭**.
- RC 규모(≤8×8)는 **전수 순열 탐색으로 정확 최적해** 보장 (그리디 금지 — 같은 bottom 반복 방지).
- **플로어 우선**: 플로어(68) 미달을 피하기 위해 매칭 크기를 줄여가며 탐색 —
  스코프당 미매칭 최대 4개(=2쌍 축소) 허용. (HERMES 비준 시 정정 문안 — 실측 FEMALE 4개 미매칭 반영)
- 미매칭 상품은 secondary 영역으로. 나쁜 조합을 만들지 않는다.
- '전체' 컬렉션 = 3개 스코프 primary 페어의 합집합 (스코프 교차 페어 생성 금지 — §35).

## 7. QA (§48)

HERMES/n1-qa 최종 검토 항목: top/bottom 정확성, gender scope, 중복 페어,
시즌 상충(니트×여름하의), 색상 과밀, misleading reason 금지.
`pair_reason_short`은 관측된 근거만 서술 (예: "오버 핏 × 일자 하의 균형").

## 8. UNCERTAINTY

- 상품 색상·소재 데이터는 공급사 타이틀 토큰 기반이며 상세 고시 미확인 필드는 UNKNOWN.
- 옵션별재고 미확정 상태의 상품은 페어링 대상이지만 주문 가능 상태와는 무관 (재고 게이트 별도).
- PairScore는 고객 선호 데이터가 아닌 **merchandising 휴리스틱** (주문 0건 상태).

## 9. CUSTOMER-FACING RULES (§40)

- 노출 문구: "함께 입기 좋은", "이런 조합 어때요" 수준의 QUIET 톤.
- 점수·퍼센트·AI 언급 금지. pair_reason_short 중 관측 근거만 조용히 노출 가능.
- 각 상품은 개별 구매 가능. 페어는 세트 강제가 아니다 (§49–§53).

## 10. UPDATE CADENCE (§84)

재계산 트리거: 신규 상품 추가 / 상품 unavailable / 시즌 전환 / trend cluster 업데이트.
페이지뷰 기반 재계산 금지. 재계산 시 본 정책의 threshold·가중치를 그대로 적용하고
결과를 새 버전(예: PAIRING_RESULTS_YYYYMMDD)으로 보존한다.
