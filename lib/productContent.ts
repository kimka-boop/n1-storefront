/**
 * Scene 2 고객 노출 문구.
 *
 * 창작 금지 원칙(N1_ZCODE_IMPLEMENTATION_HANDOFF.md §1)에 따라,
 * 이 맵은 Owner 승인(D2, 2026-09-06)된 S2 스토리 Description
 * (n1_md/pipeline_runs/first_batch_s2_stories.md — 고객 노출용)만을 수동 반영한다.
 *
 * HERMES Master가 API 필드(selectionReason / description)를 제공하면
 * 이 맵을 폐기하고 API 값을 사용한다. 여기에 새 문구를 추가하지 말 것.
 */
export interface ProductStory {
  description: string;
  source: string;
}

export const PRODUCT_STORY: Record<string, ProductStory> = {
  "PRD-W-52": {
    description:
      "오버핏 라운드넥 니트. 울 60% 블렌드(1번)와 울 50% 블렌드(2번), 두 가지 소재 구성으로 겨자·오렌지·핑크·코랄·아이보리·그레이·브라운·카키·네이비 9색이 준비되어 있습니다. 공급사 표기 기준 신축성이 좋고 비침이 없으며, 국내에서 생산됩니다(2021년부터 지속 생산). ※ 옵션 구성(1번/2번)은 색상별로 확인 후 선택해 주세요.",
    source: "first_batch_s2_stories.md PRD-W-52 Description (D2 승인)",
  },
  "PRD-G-50": {
    description:
      "LND의 투톤 컬러 맨투맨. \"GIVE LOVE BACK\" 그래픽 프린트가 포인트이며, 카키/블랙부터 크레이&와인, 화이트&네이비까지 5가지 투톤 조합으로 커플룩까지 커버합니다. 폴리에스터 100% 원단(공급사 표기)이며, 컬러별 90/100/110 사이즈로 남녀 모두 착용 가능합니다.",
    source: "first_batch_s2_stories.md PRD-G-50 Description (D2 승인)",
  },
  "PRD-M-51": {
    description:
      "면 100%의 기본 V넥 긴팔티. 순면 40수 원단의 청량한 착용감을 살려 레이어드의 기본이 되는 아이템으로, 화이트·블랙·그레이 3색으로 준비했습니다. XL(95)~4XL(110)까지 어깨·가슴·밑단·소매·총장 실측치를 공개하며, 빅사이즈까지 커버합니다(모델 177cm/75kg 기준 2XL 착용).",
    source: "first_batch_s2_stories.md PRD-M-51 Description (D2 승인)",
  },
};
