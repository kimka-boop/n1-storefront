/**
 * EMAIL_VERIFY_DEFERRED — 이메일 소유 확인 지연 계약 (Session A §3, 2026-09-09)
 *
 * 현재 상태:
 *  - transactional email 인프라(발송 가능한 SMTP/API provider)가 없다.
 *    새 유료 provider를 임의 도입하지 않는다(미션 제약).
 *  - 따라서 가입 이메일은 "형식만 검증된 미확인 주소"로 취급한다.
 *    account.emailVerified는 항상 false이며, UI는 이를 사실로 말해야 한다.
 *
 * 이 계약이 잠근 것:
 *  - 비밀번호 recovery(이메일 링크/코드 재설정)는 이 계약이 해제될 때까지
 *    구현·활성화하지 않는다. 확인되지 않은 주소로 recovery를 열면 계정 탈취
 *    (오타/타인 주소 입력)로 직결되기 때문이다.
 *
 * 해제 조건 (향후 provider 도입 승인 시):
 *  1. provider가 env 주입으로 연결된다 (소스에 credential literal 금지).
 *  2. requestEmailVerify()를 실발송 구현으로 교체 — 시그니처 유지.
 *  3. confirmEmailVerify()가 단일사용 토큰(10분 만료)을 검증해
 *     Account.emailVerified를 true로 승격한다.
 *  4. 그 이후에만 password recovery 경로를 열 수 있다.
 *
 * 이 파일은 그 전환을 위한 자리표이다 — 동작하는 코드가 아니라 계약이다.
 */

export const EMAIL_VERIFY_STATUS = "EMAIL_VERIFY_DEFERRED" as const;

/** 활성화 전까지 서버가 이 응답으로 정직하게 거절한다. */
export interface DeferredVerifyResponse {
  ok: false;
  code: typeof EMAIL_VERIFY_STATUS;
  message: string;
}

export interface EmailVerifyContract {
  /** 확인 메일 발송 (활성화 전: 발송하지 않고 DEFERRED로 응답) */
  requestEmailVerify(email: string): Promise<DeferredVerifyResponse>;
  /** 발송된 토큰 확인 → emailVerified=true (활성화 전: 도달하지 않음) */
  confirmEmailVerify(email: string, token: string): Promise<DeferredVerifyResponse>;
}

/** 현재 구현 — 계약의 DEFERRED 자리표. provider 승인 전까지 그대로다. */
export const deferredEmailVerify: EmailVerifyContract = {
  async requestEmailVerify(): Promise<DeferredVerifyResponse> {
    return {
      ok: false,
      code: EMAIL_VERIFY_STATUS,
      message:
        "이메일 확인은 아직 열리지 않았어요. 계정 복구가 필요하면 고객센터로 연락해 주세요.",
    };
  },
  async confirmEmailVerify(): Promise<DeferredVerifyResponse> {
    return { ok: false, code: EMAIL_VERIFY_STATUS, message: "이메일 확인은 아직 열리지 않았어요." };
  },
};

/** 회원 탈퇴 시 스마트핏 개인화 프로필 처리 — 정책 초안(docs/N1_SMARTFIT_DATA_POLICY_DRAFT.md)과 짝을 이루는 코드 자리표. */
export const SMARTFIT_ON_WITHDRAWAL = "DELETE_PERSONALIZATION_KEEP_ORDER_RECORDS" as const;
