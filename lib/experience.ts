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
  const term = query.trim().toLocaleLowerCase();
  return rows.filter(p => p.lookbookStatus === '생성완료' && Boolean(p.lookbookImage?.trim()) &&
    (gender === 'all' || p.gender?.toUpperCase() === gender) &&
    (!term || p.name.toLocaleLowerCase().includes(term)));
}
