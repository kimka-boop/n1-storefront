# N°1 — Editorial Experience V2

## Scope and baseline
Local frontend mission. No deployment, product publishing, production-data writes, paid API calls, credential changes, new agents or backend changes. Baseline HEAD 12ef45a; clean working tree on resumed inspection. Earlier uncommitted lockfile change was already absent when this mission resumed. Work branch n1-editorial-experience-v2. Recoverable source backup: ../n1-website-redesign-20260907_225855/backup. Existing dev server: http://127.0.0.1:3210.

## Phase 1 — concise audit
1. Current experience: live home exposes 60 rows, 56 PREPARING cards, 4 LOADING cards, gender enum regression. Local previous redesign limits to 4 but retains identical two-column treatments and unsupported future-drop promises.
2. Intended: the brand edits the assortment; the visitor encounters a garment, explores its form, understands fit/material, then chooses without pressure.
3. Gap: documentary intent and deployed code diverge. Main's historical Liquid Glass V2 and ProtoDetail exist in Git but were not integrated into the newer branch (common ancestor 67ad610). Recover principles, not a wholesale merge.
4. Home: countdown leads over curation; supplier SEO names; empty image fields; no distinctive relationship between pieces. Reference screenshot at Desktop/N1작업/48867ee5-85c2-458d-be42-fbfded0e48a5.png demonstrates garment-first crop and asymmetric editorial hierarchy; its fictional products/prices and literal perfume props are NOT data.
5. PDP: one image repeated as hero/material/fit; desktop hero taller than viewport; no working purchase route in deployed older PDP. Local CTA routes to home but loses selected color. M55 Drive folder is treated as an image and its listing API returns ok=true/files=[]/thumb=null.
6. Motion: entrance effects repeat without informational value. Mobile CS overlaps purchase bar. Reduced motion removes scene fades but global smooth scrolling remains.
7. Glass: a persistent product reading rail can preserve place; blur on a static option panel has no contextual benefit and should be removed.
8. Images: existing generated imagery is reusable, but M51 45-degree is round-neck whereas corrected front is V-neck; do NOT use as a rotation sequence. Product-only strips require selecting one existing frame, not regeneration. G50 and M55 original model photos cut off feet; label honestly rather than fabricate full-body coverage. AI pictures are styling illustrations, not material or body-measurement evidence.
9. IA: isolate object/fit/material/detail/story/decision, while retaining direct access. G50 says Size confirmed despite absent measurements. Specs repeated; undefined measurements and default manufacturer/date copy imply facts without evidence.
10. Constraints: Next 14.2.15/React18/TypeScript, plain global CSS + CSS modules, no animation library or test framework. Products API has 60 records; all sizeOptions=[] and optionStock={}; 4 ready IDs M51/M55/W52/G50. API has no gallery, description, color-material mapping. Existing POST /api/orders rejects empty stock. Frontend cannot honestly make these purchasable without data approval. Preserve contract; provide explicit availability inquiry, never fake stock or send incomplete orders.
11. Priorities: P0 media identity and truthful readiness; exact option + purchase handoff; missing/error/reduced-motion states. P1 editorial home and continuous PDP; garment crops; contextual navigation; readable Korean UI and accessible touch controls. P2 lightweight comparison, refined chapter pacing, image delivery.

### Primary sources and interpretation
- n1_md/N1_VISUAL_LANGUAGE_v1.md; N1_VISUAL_REFERENCE_ANALYSIS.md.
- n1_md/N1_RESEARCH/01–13, especially 05_N1_VISUAL_CONSTITUTION_v2.md and 12_LIQUID_GLASS_V2_INTERACTION_MODEL.md.
- N1_BRAND_EXPERIENCE_DIRECTION_V1.md; N1_PRODUCT_DETAIL_EXPERIENCE_V1.md; N1_REFERENCE_ANALYSIS_APPLE_LIKE.md; N1_ZCODE_IMPLEMENTATION_HANDOFF.md; source-backed batch stories.
- User's latest brief supersedes historical equal-density 60-piece grid, blanket crop/closeup prohibitions and rigid space percentages. Preserve Entry → Silence → Object, Cotton feeling, Blotter discovery, and Glass behavior. Equal respect does not mean identical composition. Readable facts override low-contrast atmosphere.
- Historical original visual-reference PNGs / original constitution skill were not found in the inspected directories. Text records are available; do not claim original images were reviewed.

### External principles (actual research, not visual copying)
- Apple https://www.apple.com/iphone-air/: chapter navigation, closer-look controls and feature-dependent detail. Actual page has early Buy and direct navigation: progressive disclosure is not enforced waiting. Learn continuity and optional depth; do not copy typography, blue pills, spectacle or promotions. Media capture was partially unreliable; exact timing is not asserted.
- https://developer.apple.com/design/human-interface-guidelines/materials: material separates navigation from content, sparingly. Translate to a single contextual reading rail, not glass product cards.
- https://amomento.co: browser showed 26FW paired editorial image and concise collection entry; search cache showed older SS content. Current browser takes precedence. Learn collection viewpoint and varied crops; do not copy its campaign, full-bleed faces or visual identity.
- https://auralee.jp/item/detail/1_1_A26AJ01MG_1/2513?lang=en and https://auralee.jp/material-matters/09: measured dimensions linked to locations; optional material story explains construction. Learn evidence next to image; do not copy brand claims or mandatory region overlay.
- https://www.studionicholson.com/pages/studio-nicholson-fit-guide-womens: extracted guide compares waist/leg/length with direct product links. Local browser redirects to SSF; do not claim global guide rendered locally. Learn concise comparison axes, not promotion-heavy SSF layout.

## Phase 2 — design and interaction contract (before implementation)
### Visual thesis
An edited wardrobe, one garment at a time. The signature is an annotated relationship between garment, viewpoint and fact—not a luxury-template hero plus repeated cards.

1. Hierarchy: brand wordmark/short Korean editorial statement → lead garment → two supporting pieces → quiet fourth object. Names are fact-preserving display labels, with original supplier name available in product facts.
2. Type: existing Korean/system sans for body 15–16px; restrained Georgia serif only for N°1 wordmark and editorial English micro-headings, never Korean fallback pretending to be a designed typeface. Korean headings 28–46px depending viewport, line-height 1.25–1.4. Functional labels at least 12px, legible dark muted ink.
3. Color/material: warm paper #faf9f7, ink #242722, muted #66685f, warm line #deddd5, quiet olive #555e4c for selection. No gradients/glows/textures. Image color unaltered.
4. Space: 8px base; 16/24/32px related groups, 64/96px chapter intervals, no empty viewport or fixed scroll runway. Width governed by garment legibility, not legacy space percentage.
5. Images: copy/compress existing generated files into a new public/editorial-media folder; preserve originals and source hashes. Separate art-directed representative crops from full/source frames. Five labeled viewpoints when reliable. M51 uncertain angles explicitly unavailable; no fabricated substitute. Material detail is an enlarged styling image with disclosure, never physical-fabric proof.
6. Grid: asymmetrical lead composition, supporting pairing and quieter object presentation. Mobile changes order/scale deliberately, not compressed desktop columns.
7. Navigation: compact N°1 home link, collection anchor, optional search and account entry. Existing auth preserved. Filters operate on ready items and exact API gender enums, never inferred gender from image. Search within selected collection only; explicit no-results/reset.
8. Cards: image and short name link to existing /product/[id]; secondary comparison toggle. No hover-only information, badge clutter, hover scale or fake scarcity. Hover/focus indicates actionable text; static state complete.
9. PDP: intro → object/views → fit → material → detail → editorial note → decision/facts. Same visual stage changes context on desktop; stacked stage with touch viewpoint controls on mobile. Every chapter has an ordinary anchor and normal document flow.
10. Motion: crossfade 180–240ms only on view/chapter change; no movement on passive text. Scale/crop change only for detail examination. Keep loading/error explicit. Reduced-motion uses instant changes and native auto scroll.
11. Scroll-state relationship: observer selects nearest active chapter. Intro uses representative crop; object uses model-front/view choice; fit uses full/suitable side; material uses studio object; detail uses bounded studio crop; story returns object; decision keeps selected view. Manual view selection takes precedence until another chapter becomes active. Labels explain why the visual changed. No autoplay or scroll hijack.
12. Glass: one sticky reading/control rail may be lightly translucent over passing content with opaque fallback. Options/material text remain solid. User-selected zoom opens a real dialog retaining product context with Escape, focus return and scroll lock.
13. Responsive: desktop paired visual+reading column; mobile media ahead of each relevant group, no huge sticky hero. Safe bottom offsets for support/order overlays. 375/390/768/1440 coverage.
14. States: loading ≠ empty ≠ error; missing media has a recoverable explanation; missing data stated once near the decision; sold-out distinct from unconfirmed inventory. Color selection preserves raw values separately from translated labels; stock must match exact variant. Do not infer sizes from marketing text or substitute UNKNOWN with facts.

### Commerce boundary
No production calls during QA. Keep existing order/auth/CS APIs untouched. Existing valid-stock products must still reach the original order submission contract. Current four products have no option stock, so provide truthful availability guidance and existing CS entry (opening only; no automatic message). No false purchase success. Production-data remediation remains an owner-gated limitation, not a frontend workaround.

### Acceptance and verification
Node tests execute actual TypeScript helpers through installed TypeScript transpilation, plus browser DOM assertions/screenshots. TDD slices: ready collection → option preservation/readiness → chapter/media behavior. Typecheck and production build. Browser iteration logs list three largest issues and corrections. No new agents: independent-agent review is intentionally not run under the explicit mission prohibition; use source self-review plus automated tests/browser evidence and state this limitation.
