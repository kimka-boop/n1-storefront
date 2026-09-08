export interface RetailProduct {
  id: string; name: string; gender?: string; category?: string; price: number;
  stockStatus: string; lookbookStatus: string; lookbookImage: string;
  material?: string; washingInfo?: string; sizeChart?: string; modelInfo?: string;
  origin?: string; fit?: { thickness?: string; stretch?: string; sheer?: string; lining?: string; shape?: string };
  notice?: { manufacturer?: string; madeAt?: string; colorSize?: string; quality?: string; as?: string };
  colorOptions?: string[]; sizeOptions?: string[]; optionStock?: Record<string, number>;
}

export function productColors(raw: string[] = []): {value: string; label: string}[] {
  const values = raw.flatMap(value => value.includes('·') ? value.split('·') : value.split(/\s+\/\s+/))
    .map(value => value.trim()).filter(value => value && !/UNKNOWN|상세페이지 참조/i.test(value));
  return Array.from(new Set(values)).map(value => ({ value, label: value.replace(/겨자/g, '머스타드') }));
}

export function quickBuyUrl(id: string, color: string, size: string): string {
  return '/?' + new URLSearchParams({product: id, color, size}).toString();
}

export function purchaseState(p: Pick<RetailProduct, 'stockStatus'|'colorOptions'|'sizeOptions'|'optionStock'>, color: string, size: string): 'ready'|'choose'|'soldout'|'unconfirmed' {
  if (p.stockStatus === '품절') return 'soldout';
  if (p.stockStatus !== '판매중' || !Object.keys(p.optionStock || {}).length || !p.sizeOptions?.length) return 'unconfirmed';
  const colors = productColors(p.colorOptions);
  if ((colors.length && !colors.some(c => c.value === color)) || !p.sizeOptions.includes(size)) return 'choose';
  const key = color ? `${color}_${size}` : size;
  const stock = p.optionStock?.[key];
  if (stock === undefined || !Number.isFinite(stock)) return 'unconfirmed';
  return stock > 0 ? 'ready' : 'soldout';
}

export function selectCollection<T extends { name: string; gender?: string; lookbookStatus: string; lookbookImage: string }>(rows: T[], gender = 'all', query = ''): T[] {
  // 2026-09-08 Owner 지시: 컬렉션의 모든 상품(남20/여20/젠더리스20)을 상태와 무관하게 전시한다.
  // 룩북 미생성(대기) 상품은 카드에서 '이미지 준비 중' 플레이스홀더로 정직하게 표시.
  const term = query.trim().toLocaleLowerCase();
  return rows.filter(p =>
    (gender === 'all' || p.gender?.toUpperCase() === gender) &&
    (!term || p.name.toLocaleLowerCase().includes(term)));
}

// ── Top × Bottom 페어 merchandising (N1_PAIRING_POLICY_V1 — 사전 계산 mapping만 소비) ──

export interface CollectionPair {
  pairId: string;
  collectionScope: string;
  scopeLabel: string;
  topProductId: string;
  bottomProductId: string;
  trendClusters: string[];
  pairReasonShort: string;
}

export interface PairRow<T> {
  pair: CollectionPair;
  top: T;
  bottom: T;
}

export function buildCollectionPairs<T extends RetailProduct>(
  products: T[],
  pairs: CollectionPair[],
  gender: 'all' | 'MALE' | 'FEMALE' | 'GENDERLESS',
  query = '',
): { rows: PairRow<T>[]; singles: T[] } {
  const byId = new Map(products.map(p => [p.id, p] as const));
  const term = query.trim().toLocaleLowerCase();
  const rows: PairRow<T>[] = [];
  const used = new Set<string>();
  for (const pair of pairs) {
    if (gender !== 'all' && pair.collectionScope !== gender) continue;
    const top = byId.get(pair.topProductId);
    const bottom = byId.get(pair.bottomProductId);
    if (!top || !bottom) continue; // unavailable 상품이 페어를 깨면 조용히 제외 (§38)
    if (term && !(top.name.toLocaleLowerCase().includes(term) || bottom.name.toLocaleLowerCase().includes(term))) continue;
    rows.push({ pair, top, bottom });
    used.add(top.id);
    used.add(bottom.id);
  }
  // 미매칭·미달 페어 상품 — quiet 단품 영역 (§46: 나쁜 조합 강제 금지)
  const singles = selectCollection(products, gender === 'all' ? 'all' : gender, query)
    .filter(p => !used.has(p.id));
  return { rows, singles };
}
