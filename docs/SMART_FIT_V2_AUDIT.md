# N°1 Smart Fit V1 → V2 감사 (Mission §4–§5)

- **Branch / Worktree**: `n1-smart-fit-v2` @ `C:\Users\MY-PC\Documents\n1-smartfit-v2`
- **Base commit**: `bd72204` (`n1-editorial-experience-v2` HEAD). Glass Lab 세션의 미커밋 파일(`app/glass-lab/`)은 이 worktree에 존재하지 않음 — 자연 격리.
- **Data reality (60 products, products-before.json 기준)**:
  - `sizeOptions`: **전 상품 공란** → V1의 `fitPresetSize` 칩 프리셋은 실제로 발동한 적 없음.
  - `fit.shape`: 의류 '종류' 코드(SHIRT/TSHIRT/JEANS…) — 실루엣 정보가 아님.
  - 실루엣 키워드(와이드/루즈핏/슬림핏/세미오버)는 상품 **이름**에만 존재.
  - `fit.stretch`: 60개 중 8개만 값 보유(있음/보통/약간/없음/좋음). 대부분 UNKNOWN.
  - 실측 `sizeChart`: 15/60만 실제값, 나머지 UNKNOWN/공란.
  - 데이터 오염 예: PRD-G-58 모자(버킷햇)가 `의류-하의`로 분류됨.

## 분류

| V1 요소 | 분류 | 근거 |
|---|---|---|
| 선호 핏 질문(A/B/C) | **KEEP** | 결과에 실질 참여하는 유일한 취향 입력 |
| 성별 질문 | **REMOVE** (컨텍스트에서 제거, 레거시 필드만 유지) | 어떤 판단 로직에도 사용되지 않음(§5 "결과에 필요 없는 입력"). /api/auth 계약 유지를 위해 저장 시에만 `미지정`으로 위임 |
| 단일 기준 사이즈(상하의 공용) | **REIMPLEMENT** — topSize/bottomSize 분리 | 하의를 볼 때 상의 기준 사이즈로 판단하는 오류 (§17) |
| 3단 고정 form (fit→gender→size) | **REFINE** — progressive (§7) | 카테고리에 필요한 질문만, 아는 값은 재질문 금지 |
| `fitGuidance` 텍스트 생성 | **REIMPLEMENT** — `interpretFit` 4층 결과 모델 + evidence level (§14–15) | 상품 실루엣·수치표·재고를 전혀 읽지 않고 종류+수치표 유무만 봄 |
| localStorage `n1_fit_profile` 저장 | **KEEP** (v2 스키마로 마이그레이션) | 세션+기기 연속성 충족 (§9–10) |
| 로그인 시 서버 프로필이 게스트 컨텍스트를 덮어씀 | **REFINE** — merge policy | AuthNav 헤더 로그인 시 게스트 컨텍스트 소실 (§11 위반) |
| 게스트→계정 저장 handoff | **KEEP** | SmartFitFlow 내부 handoff는 동작함 |
| PDP Your Fit 블록 | **REFINE** — evidence 기반, 카테고리별 규칙 | Scene 전환 시 결과 유지는 로컬스토리지로 이미 충족 |
| 홈 gtab-fit 라벨 | **REFINE** — "스마트 핏 · 설정됨" 조용한 상태 (§23) | 배지 남발 금지 |
| 수정 flow | **KEEP** | PDP/홈 진입 존재 |
| 초기화 | **NEW** | V1에 없음 — 숨은 상태 영구 잔존 (§27) |
| LiquidSurface / LqSeg | **KEEP** (이 세션 소유 아님 — 재질은 Glass Lab 인계 대상) | 시맨틱 경계로 사용, 시각 재질 확정 안 함 (§33) |
| 키(height) 질문 | **NOT ASKED** | 현재 데이터로는 결과 개선에 실질 기여 없음(§7). 상품이 `권장키`를 표기하면 상품 FACT로만 노출 |

## V2 결과 판단 근거 (evidence) — runtime-derived, DB 변경 없음

- **READY**: 실루엣 확인(이름 파싱) + 실측 수치표 + 해당 카테고리 평소 사이즈 → 방향 해석 + 수치표 anchor 안내
- **PARTIAL**: 위 중 일부 누락 → 방향 또는 팩트만 + 한계 문장
- **UNCONFIRMED**: 종류는 아나 실루엣·수치표 모두 미확인
- **UNAVAILABLE**: 비의류(모자 등) 또는 판단 근거 전무
- 품절: 해석은 가능하나 구매 제안처럼 표현하지 않음, size anchor 억제 (§29)
- stretch 미확인: 신축성 언급 자체 금지 (§19)
- AI 이미지: 측정 근거로 사용 금지 — 엔진은 이미지를 입력으로 받지 않음 (§20)
