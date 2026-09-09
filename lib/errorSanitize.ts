/**
 * [SESSION L · TASK 29] 고객 응답용 실패 위생 계층 — error UX failure matrix
 *
 * 라우트 catch 블록이 내부 예외 원문(Google API 오류·파일 경로·JSON 파서 메시지)을
 * 그대로 고객에게 보내는 것을 차단한다. 원문은 서버 로그에만 남기고, 고객 응답은
 * 실제 상태(업스트림 실패 = 잠시 후 재시도)에 맞는 고정 문구로 대체한다.
 *
 * - 계약 오류(라우트가 의도적으로 4xx status와 함께 던진 한국어 메시지)는 그대로 통과한다 —
 *   재고 409·필수항목 400 등은 이미 고객용 문구로 작성되어 있다.
 * - 그 외(예상 못한 예외·업스트림 실패)는 502 + 고정 문구로 치환한다.
 */

export const GENERIC_UPSTREAM_MESSAGE = "일시적인 접속 문제가 발생했어요 — 잠시 후 다시 시도해 주세요";

/** 내부 예외를 서버 로그에만 기록한다 — 고객 응답 본문에는 절대 원문을 실어 보내지 않는다 */
export function logInternal(scope: string, e: unknown): void {
  console.error(`[${scope}]`, e);
}

/**
 * 계약 오류(4xx status 보유)면 그대로, 아니면 502 고정 문구로 치환한다.
 * 상태 코드로 신뢰를 판정하는 이유: 이 코드베이스의 의도적 throw는 항상
 * Object.assign(new Error(고객용 문구), { status: 400|404|409 }) 형태다.
 */
export function clientSafeFailure(e: unknown): { status: number; message: string } {
  const status = (e as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { status, message: e instanceof Error ? e.message : String(e) };
  }
  return { status: 502, message: GENERIC_UPSTREAM_MESSAGE };
}
