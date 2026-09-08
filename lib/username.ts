/**
 * USERNAME 규칙 — 클라이언트/서버 공용 (Session A §1)
 *
 * 이 모듈은 node 전용 모듈(crypto 등)을 import하지 않는다 — 클라이언트 번들에서도
 * 안전해야 하기 때문이다. 서버 코어(lib/authServer.ts)도 이 모듈을 재사용해
 * 정규화 규칙이 한 곳에서만 정의된다.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** 정규화 후 허용 집합: 영문 소문자 · 숫자 · 밑줄 (한글 아이디는 이번 기반에서 제외 — 보고서 기재) */
export const USERNAME_RE = /^[a-z0-9_]+$/;

/** 정규화: trim + 소문자. 유일성은 항상 이 정규형 기준으로 판정한다. */
export function normalizeUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateUsername(raw: unknown): UsernameCheck {
  const value = normalizeUsername(raw);
  if (!value) return { ok: false, error: "아이디를 입력해 주세요" };
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX)
    return { ok: false, error: `아이디는 ${USERNAME_MIN}~${USERNAME_MAX}자여야 해요` };
  if (!USERNAME_RE.test(value))
    return { ok: false, error: "아이디는 영문 소문자, 숫자, 밑줄(_)만 사용할 수 있어요" };
  return { ok: true, value };
}
