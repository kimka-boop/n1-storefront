#!/usr/bin/env node
/**
 * 통합 아티팩트 생성 (STEP 82) — 실행 위치: mission-20260909/
 * - N1_TREND_EVIDENCE/N1_TREND_EVIDENCE.json  (클러스터 정의 + 73건 레코드 + 소스 레지스트리)
 * - N1_IMAGE_GENERATION_QUEUE.json            (§81 — paid generation 전 큐만)
 */
const fs = require("fs");

const CLUSTERS = {
  T01: { name: "슬림·스트레이트 회귀", confidence: "HIGH",
    statement: "FW26 남성 실루엣이 오버사이즈에서 슬림/스트레이트로 피벗 (Vogue Korea 'Slender Man' 2026-09-08; 블로거 간 wide-vs-straight 논쟁 자체가 전환기 신호)" },
  T02: { name: "니트 퍼스트 레이어링", confidence: "HIGH",
    statement: "브이넥·터틀넥·하프/쿼터집업·가디건 등 니트가 간절기 탑의 기본값; 니트×데님/슬랙스가 기본 공식" },
  T04: { name: "브라운·어스 팔레트 + 버건디 포인트", confidence: "HIGH",
    statement: "카멜/초콜릿/차콜 베이스 + 버건디 포인트가 가장 강한 크로스소스 수렴 (5+ 독립 소스). Elle Korea는 올리브를 시즌 컬러로 지목" },
  T05: { name: "워싱·빈티지 파브", confidence: "HIGH",
    statement: "워싱 데님·피그먼트·톤다운 가공이 남성 탑/바텀 전반 (thisisneverthat FW26, Covernat 'lowered saturation')" },
  T06: { name: "셔츠 레이어링 레시피", confidence: "HIGH",
    statement: "셔츠 카라·커프스 노출, 쿼터집업+옥스퍼드, 셔츠+니트 레이어 공식 반복 관찰" },
  T07: { name: "체크 셋업", confidence: "MEDIUM",
    statement: "타탄/버팔로체크 풀 셋업·체크 클래싱 (에디토리얼 4소스; 도매 소재 가용성은 셔츠/스커트 수준)" },
  T08: { name: "울·플리스 코지", confidence: "MEDIUM",
    statement: "울블렌드 니트·기모·플리스 — 초겨울 보온축. 그래놀라 코어 무드와 결합" },
  T09: { name: "올블랙 텍스처", confidence: "MEDIUM",
    statement: "블랙 온 블랙을 컬러가 아닌 소재 대비로 스타일링 (W Korea 2026-08-27, Marie Claire 'reinforced black')" },
  T10: { name: "미디 스커트 리바이벌", confidence: "MEDIUM",
    statement: "H라인 펜슬 미디·스커트 수트 부활 (Elle·Bazaar·W Korea; 블로거 펜슬스커트 언급)" },
  T03: { name: "스웨이드·레더 텍스처 아우터", confidence: "HIGH — RC 스코프 제외",
    statement: "29CM 거래액 +124% YoY(2026-08-07~18 실측 데이터), GQ·무신사스탠다드·복수 리테일 확인. 그러나 RC 카탈로그는 TOP×BOTTOM 페어 모델 전용이라 아우터 SKU 제외 — 이미지/아우터 후속 미션에서 최우선 검토" },
};

const records = [];
const registry = [];
for (const name of ["editorial", "commerce", "brand", "community"]) {
  const arr = JSON.parse(fs.readFileSync(`N1_TREND_EVIDENCE/evidence_${name}.json`, "utf-8"));
  for (const r of arr) { r.record_family = name; records.push(r); }
  const tail = fs.readFileSync(`N1_TREND_EVIDENCE/tail_${name}.md`, "utf-8");
  registry.push({ family: name, synthesis_tail: tail.slice(0, 4000) });
}
const uniq = new Map();
for (const r of records) {
  const u = r.source_url || "";
  if (u && !uniq.has(u)) {
    uniq.set(u, { source_name: r.source_name, source_type: r.source_type,
      url: u, publication_date: r.publication_date, family: r.record_family });
  }
}
const out = {
  mission: "N1 LAUNCH 20260910 — FW26 trend research",
  captured_at: "2026-09-09",
  method: "4 parallel evidence researchers (editorial/commerce/brand/community), public access only, no bot bypass (§8). Popularity claims prohibited (§14) — prevalence language only.",
  temporal_window: "2026-08 ~ 2026-09 우선",
  cluster_count: Object.keys(CLUSTERS).length,
  clusters: CLUSTERS,
  evidence_record_count: records.length,
  unique_source_count: uniq.size,
  evidence_records: records,
  source_registry: Array.from(uniq.values()),
  family_syntheses: registry,
};
fs.writeFileSync("N1_TREND_EVIDENCE/N1_TREND_EVIDENCE.json", JSON.stringify(out, null, 1));
console.log(`N1_TREND_EVIDENCE.json: ${records.length} records, ${uniq.size} unique sources`);

const cat = JSON.parse(fs.readFileSync("catalog_selected.json", "utf-8"));
const queue = cat.catalog.map((c) => ({
  product_id: c.product_id, name: c.name, gender: c.gender, top_bottom: c.top_bottom,
  priority: c.cluster_ids.length ? "P1" : "P2",
  required_views: ["front"], source_reference: c.source_image, source_url: c.source_url,
  image_status: "SOURCE_ONLY",
  note: "paid generation(FASHN/GPT Image) deferred — Owner approval required (§81)",
}));
fs.writeFileSync("N1_IMAGE_GENERATION_QUEUE.json",
  JSON.stringify({ generated_at: "2026-09-09", count: queue.length, queue }, null, 1));
console.log(`N1_IMAGE_GENERATION_QUEUE.json: ${queue.length}`);
