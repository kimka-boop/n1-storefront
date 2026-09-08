# N°1 Integrated Storefront V1

> Integration commit: `n1-storefront-integrated-v1` (worktree `C:\Users\MY-PC\Documents\n1-storefront`)
> Preview: `http://127.0.0.1:3211` (검증용) / `http://127.0.0.1:3210` (기존 프리뷰 포트)
> Production deploy: **하지 않음** — Owner 확인 후 별도 publish approval.

## Source Sessions

| Session | Branch | Head | 상태 |
|---|---|---|---|
| A — Glass Material / Production Integration | `n1-glass-production-integration` | `f102b7a` | committed, clean |
| B — Smart Fit V2 | `n1-smart-fit-v2` | `ce7c9d3` | committed, clean |
| C — Commerce + Customer Service V1 | `n1-commerce-cs-v1` | `a337577` | committed, clean |

## Merge Strategy

1. Base = **Session A** (`f102b7a`) — bd72204 이후 Glass production 통합 + CS dismiss까지 포함하는 최신 production-compatible 브랜치.
2. `git merge n1-smart-fit-v2` (ce7c9d3) — **충돌 0건** 자동 병합 (B는 globals.css 미수정, A는 B의 신규 파일과 무충돌).
3. `git merge n1-commerce-cs-v1` (a337577) — 충돌 2파일: `app/product/[id]/page.tsx`, `components/CsWidget.tsx`.

## Conflicts Resolved

- `components/CsWidget.tsx`
  - fab 버튼: A의 `fabRef`(focus 반환) 유지 — C는 형식만 다름.
  - header: **C의 HUMAN_ACTIVE/HUMAN_PENDING 상태 표시 채택** + A의 `closePanel`(focus 반환) 유지.
- `app/product/[id]/page.tsx`
  - import: A의 `quickBuyUrl` + B의 `interpretFit, categoryOf` 채택 — C의 구버전 `fitGuidance/FitProfile` 제외(V2 대체됨).
  - useAuth: B의 V2 시그니처(`fit: authFit`) + C의 `useCart`/`useRouter`.

## Glass

- Canonical: **C Perfume** (Lab `319d2ba` 최종 검증값 — 배경 대비 약 -7% 내부 밀도).
- Tokens: `--n1-glass-fill / fill-active / fill-surface(~60%) / optics / optics-active / specular / edge / shadow / transition`.
- 적용: Category Lens · Contact Orb · Cart Orb · CS send · Smart Fit surface · Auth surface(공유 LiquidSurface).
- Glass Lab(`/glass-lab`)은 dev-only 비교 자료로 보존.

## Smart Fit

- V2 기능 전량 보존: Fit Context(lib/fitContext) · Guest 사용 · 점진 수집(선호 핏 → 사이즈) ·
  즉시 저장 · 상시 수정/초기화 · PDP 상주 Your fit 블록 · evidence 4단계(READY/PARTIAL/UNCONFIRMED/UNAVAILABLE) ·
  로그인 병합(서버 우선·게스트 승격·실패 무변경).
- Glass: 단일 C Perfume 서페이스(밀도 ~60%) — LiquidSurface 공유, 카드 중첩 없음, CTA는 재질 고밀도.
- B의 SMART_FIT_V2_GLASS_HANDOFF.md 요구사항(타이밍 보존 420/480ms, LqSeg thumb, auth 공유 재질) 준수.

## Auth

- LiquidSurface 공유(C Perfume surface) — 로그인/회원가입/스마트핏→계정 전환이 같은 서페이스 안에서 상태 변환.
- 게스트 핏 프로필 보유 시 회원가입 2단계 원클릭 승격, 로그인 후 context 보존.

## Cart

- CartProvider/CartDrawer/lib/cart 통합. Guest cart(localStorage) · Member cart · raw 옵션 값 보존 ·
  수량 변경/삭제 · 장바구니 orb → CartDrawer.
- 현재 시트 데이터상 전 상품 옵션 재고 미확정 → 구매 버튼은 "재고 확인 후 구매 가능" 정직 상태(버그 아님).

## Buy Now / Checkout

- PDP Buy Now → `stashBuyNow`(단일 항목 전용, 기존 카트 미포함) → CheckoutFlow.
- Checkout: 주문 항목 / 배송·고객 / 결제 섹션 구조. **Fake payment 성공 없음** — PG 미연결 상태 정직 처리.

## CS

- AI CS 소톡/문맥 응답 추가(§27~30): 날씨·반려동물·감사 등 규칙 기반 짧은 응답, 동일 문구 연속 방지,
  구 macro fallback("네, 말씀해 주세요. 주문번호나…") 제거.
- Spam gate(§31~33): 60초 window 정규화 지문 추적 — 동일 지문 3회 → 15초 쿨다운 deterministic 응답,
  의미 있게 다른 긴급 문의는 차단하지 않음. LLM 호출 구조가 아니므로 비용 리스크 0.
- Outside click/tap dismiss + ESC + 스와이프 오타 방지 + focus 반환(§26·§50).
- HUMAN_PENDING/HUMAN_ACTIVE 헤더 상태 표시, 상담원 응대 중 AI 개입 없음.

## Telegram

- Escalation event → transcript(conversation ID / 고객 라벨 / 주문 컨텍스트 / reason / RAW transcript) →
  `sendTelegramLong`(api.telegram.org 화이트리스트, SSRF 가드) → message_id 앵커(운영자 답장 매핑) →
  webhook/poll relay가 운영자 답장을 **verbatim** 고객 전달.
- **Root cause (§38 분류 D)**: 로컬/배포 runtime에 `N1_CS_BOT_TOKEN`/`N1_CS_CHAT_ID` 미주입 →
  `sendEscalationTranscript`가 정직하게 미전송 반환(warn 로그). 코드 파이프라인은 완전 구현.
- **필요 조치**: HERMES가 보유한 CS Bot credential을 런타임 env에 주입(Owner 작업) — 주입 즉시 E2E 가능.

## Tests

- 전체 **61개 통과**(fit 31 + fitContext + cart + cs 12 + csTalk 8 + experience 3), tsc clean.
- 신규 `tests/csTalk.test.cjs`: CS1~CS6(첫 인사 1회·두 번째 contextual·날씨·고양이·nonsense macro 금지) +
  SP1~SP4(동일 반복 쿨다운·긴급 다중 문의 미차단·쿨다운 해제 복귀).

## Browser QA

- Home(1440): 60 pieces · 렌즈 C Perfume · 오브 대칭 · story editorial.
- 탭 5종 클릭/스냅 배치 검증(all 107px 등), 드래그 체인(이전 미션) 회귀 없음.
- Smart Fit surface: 배경 컨텍스트 투과 + 밀도 이동 확인(3211).
- CS: 오픈/외부 닫기/스와이프 무시/모바일 tap 닫힘.
- Mobile(375/390): 탭·오브·CS outside tap 통과.
- 참고: 검증 환경(IAB 게스트)의 getComputedStyle가 일부 구간에서 width를 60px로 오보 —
  rect 실측·픽셀 디코딩·코드 근거로 교차 판정. Owner 실브라우저 확인 권장.

## Remaining PG Work

- PG 미연결 — Checkout은 PG-ready boundary만. 실제 결제 연동/서버 검증은 별도 승인 작업.

## Remaining Production Gates

1. `N1_CS_BOT_TOKEN` / `N1_CS_CHAT_ID` runtime env 주입(HERMES 소유 credential) → Telegram E2E 재검증.
2. 상품 옵션 재고(optionStock) 시트 확정 → 구매 버튼 활성화(전 상품 unconfirmed 상태 해소).
3. 룩북 이미지 생성 상품 확대(카드 hover 각도 스왑 자동 확대).
4. Owner 최종 시각 확인 후 publish approval.
