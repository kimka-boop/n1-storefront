/**
 * N°1 Idempotency — 서버 측 멱등 계약 (Session C, 미션 §7)
 *
 * 목표: 더블 클릭 / 새로고침 재제출 / 콜백 재시도가 주문·입금확인을 중복 생성하지 않는다.
 *
 * 2층 방어:
 *  1) in-flight dedup (이 모듈): 같은 인스턴스에서 동시에 도착한 동일 키 요청을
 *     하나의 Promise 로 합친다 — 시트 검사-삽입 사이의 레이스를 막는 1차 방어.
 *  2) 영구 멱등키 (route 측): POST /api/orders 는 Orders 시트 `멱등키` 컬럼을 먼저 조회해
 *     이미 인입된 주문이면 재차 생성·재고 차감 없이 원본 응답을 replay 한다.
 *     인스턴스가 달라도 시트가 단일 진실이므로 이 계약이 최종 방어선이다.
 *
 * 실패(throw)는 캐시하지 않는다 — 재시도는 새 실행이어야 하고, 성공만 replay 된다.
 * TTL 24h 후 자동 폐기 (serverless 인스턴스 메모리 기준 fast-path 용도).
 */

const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  key: string;
  promise: Promise<unknown>;
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __n1_idempotency: Map<string, Entry> | undefined;
}

function store(): Map<string, Entry> {
  if (!global.__n1_idempotency) global.__n1_idempotency = new Map();
  return global.__n1_idempotency;
}

function sweep(): void {
  const now = Date.now();
  const s = store();
  for (const [k, v] of Array.from(s.entries())) if (now - v.createdAt > TTL_MS) s.delete(k);
}

export function makeIdempotencyScope(domain: string, key: string): string {
  return `${domain}::${String(key || "").trim()}`;
}

/**
 * 동일 키 동시/재도착 요청을 한 번의 실행으로 수렴시킨다.
 * - 실행 중 같은 키가 오면 같은 Promise 를 기다렸다 같은 결과를 반환
 * - 성공한 결과는 TTL 내 재도착 시 즉시 replay ({ replayed: true })
 * - 실패는 캐시하지 않아 재시도가 가능
 */
export async function withIdempotency<T>(
  domain: string,
  key: string,
  run: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) {
    // 키 없는 호출은 정책상 그냥 실행 (키 필수 도메인은 route에서 400 처리)
    return { value: await run(), replayed: false };
  }
  sweep();
  const scoped = makeIdempotencyScope(domain, cleanKey);
  const s = store();
  const existing = s.get(scoped);
  if (existing) {
    return { value: (await existing.promise) as unknown as T, replayed: true };
  }
  const entry: Entry = {
    key: scoped,
    promise: run(),
    createdAt: Date.now(),
  };
  s.set(scoped, entry);
  try {
    const value = (await entry.promise) as unknown as T;
    return { value, replayed: false };
  } catch (e) {
    s.delete(scoped); // 실패는 재시도 가능하게
    throw e;
  }
}

/** 테스트/운영용 — 도메인 키 전체 제거 */
export function resetIdempotency(domain?: string): void {
  const s = store();
  if (!domain) {
    s.clear();
    return;
  }
  const prefix = `${domain}::`;
  for (const k of Array.from(s.keys())) if (k.startsWith(prefix)) s.delete(k);
}

/**
 * 동시 도착 병합 전용 — 결과를 캐시하지 않는다 (webhook용).
 * withIdempotency 는 성공 결과를 TTL 내 replay 하므로, 상태가 진행하는 거래(PENDING→CONFIRMED)
 * 의 두 번째 webhook 이 첫 결과로 덮이는 문제가 있다. 결제 webhook의 영구 방어는 결제 레코드의
 * 상태 자체(CONFIRMED 이후 duplicate)이고, 여기서는 실행 중인 같은 키만 하나로 합친다.
 * 완료(성공/실패 무관) 즉시 엔트리를 치운다 — 다음 도착은 새 검증이다.
 */
export async function withInFlightMerge<T>(domain: string, key: string, run: () => Promise<T>): Promise<T> {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return await run();
  const scoped = makeIdempotencyScope(`${domain}.inflight`, cleanKey);
  const s = store();
  const existing = s.get(scoped);
  if (existing) return (await existing.promise) as unknown as T;
  const entry: Entry = { key: scoped, promise: run(), createdAt: Date.now() };
  s.set(scoped, entry);
  try {
    return (await entry.promise) as unknown as T;
  } finally {
    s.delete(scoped); // 성공도 캐시하지 않는다 — 다음 webhook은 새 검증
  }
}
