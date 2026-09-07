/**
 * Scene 2 고객 노출 문구.
 *
 * 이력:
 * - 2026-09-06 D2 승인본(first_batch_s2_stories.md)을 최초 반영.
 * - 2026-09-07 Owner 직접 지시로 "번역투 나열 → 자연스러운 한국어"로 재작성.
 *   사실관계(소재·색상·사이즈·원산지·생산 이력)는 D2 승인 데이터 그대로 유지하고
 *   어순·결만 다듬었다. "※ 옵션 구성(1번/2번)…" 주석은 삭제 — 해당 안내는
 *   소재 영역의 ⓘ 툴팁(MaterialComposition)으로 이동했다.
 *
 * HERMES Master가 API 필드(selectionReason / description)를 제공하면
 * 이 맵을 폐기하고 API 값을 사용한다.
 */
export interface ProductStory {
  description: string;
  source: string;
}

export const PRODUCT_STORY: Record<string, ProductStory> = {
  "PRD-W-52": {
    description:
      "어깨가 편하게 떨어지는 오버핏 라운드넥 니트입니다. 울 블렌드 특유의 온기를 살리면서도 무게감을 줄여, 겉옷 안에 넣어도 단독으로 입어도 부담이 없습니다. 머스타드를 비롯해 9가지 색상과 두 가지 소재 구성(1번·2번)이 준비되어 있어 취향에 맞게 고를 수 있고, 신축성이 좋아 움직임이 많은 날에도 편합니다. 대한민국에서 생산되며, 2021년부터 이어져 온 구성입니다.",
    source: "first_batch_s2_stories.md PRD-W-52 (D2 승인 사실 유지 · 2026-09-07 어조 재작성)",
  },
  "PRD-G-50": {
    description:
      "LND의 투톤 맨투맨입니다. 앞면의 'GIVE LOVE BACK' 그래픽이 조용한 포인트가 되어 주고, 카키&블랙부터 크레이&와인, 화이트&네이비까지 다섯 가지 투톤 조합이 준비되어 있습니다. 색을 맞춰 입기 좋은 구성이라 함께 코디하기에도 쓰입니다. 90·100·110 사이즈로 남녀 모두 착용할 수 있습니다.",
    source: "first_batch_s2_stories.md PRD-G-50 (D2 승인 사실 유지 · 2026-09-07 어조 재작성)",
  },
  "PRD-M-51": {
    description:
      "순면 40수 원단으로 짠 V넥 긴팔티입니다. 가볍고 숨쉬는 감촉 덕분에 봄·가을 이너부터 단독 착용까지 계절을 가리지 않고, 레이어드의 기본으로 쓰기에 좋습니다. 화이트·블랙·그레이 세 가지 색상에 XL(95)부터 4XL(110)까지 실측치를 모두 공개합니다(모델 177cm/75kg 기준 2XL 착용).",
    source: "first_batch_s2_stories.md PRD-M-51 (D2 승인 사실 유지 · 2026-09-07 어조 재작성)",
  },
};
