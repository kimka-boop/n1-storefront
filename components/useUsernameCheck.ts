"use client";

/**
 * [아이디 가용성 훅 — Session A §1]
 * - debounce 400ms 또는 blur 시 서버 가용성 확인을 호출한다(AI 판정 없음 —
 *   결정적 조회만).
 * - 결과: idle | checking | available | taken | invalid
 * - 클라이언트 피드백은 안내일 뿐이다 — 가입 submit에서 서버가 최종 중복을
 *   다시 검사한다(lib/authServer.AuthStore.register의 원자적 예약).
 */
import { useEffect, useState } from "react";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_RE, normalizeUsername } from "@/lib/username";

export type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

const DEBOUNCE_MS = 400;

export function usernameClientHint(raw: string): { status: UsernameStatus; message: string } {
  const value = normalizeUsername(raw);
  if (!value) return { status: "idle", message: "" };
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX || !USERNAME_RE.test(value))
    return { status: "invalid", message: "영문 소문자·숫자·밑줄(_) 3~20자로 입력해 주세요" };
  return { status: "idle", message: "" };
}

export function useUsernameCheck(raw: string) {
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const [message, setMessage] = useState("");

  const value = normalizeUsername(raw);

  useEffect(() => {
    const hint = usernameClientHint(raw);
    if (hint.status === "invalid") {
      setStatus("invalid");
      setMessage(hint.message);
      return;
    }
    if (hint.status === "idle" && !value) {
      setStatus("idle");
      setMessage("");
      return;
    }
    let alive = true;
    setStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check-username", username: value }),
        });
        const data = await res.json();
        if (!alive) return;
        if (data.available) {
          setStatus("available");
          setMessage("사용할 수 있는 아이디예요");
        } else {
          setStatus("taken");
          setMessage(data.reason || "이미 사용 중인 아이디예요");
        }
      } catch {
        if (alive) {
          // 조회 실패는 조용히 — 최종 판정은 가입 시 서버가 한다.
          setStatus("idle");
          setMessage("");
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /** blur 시 즉시 확인 — debounce를 기다리지 않는다. */
  const recheckNow = () => {
    const hint = usernameClientHint(raw);
    if (hint.status === "invalid") {
      setStatus("invalid");
      setMessage(hint.message);
      return;
    }
    if (!value) return;
    setStatus("checking");
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check-username", username: value }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.available) {
          setStatus("available");
          setMessage("사용할 수 있는 아이디예요");
        } else {
          setStatus("taken");
          setMessage(data.reason || "이미 사용 중인 아이디예요");
        }
      })
      .catch(() => {
        setStatus("idle");
        setMessage("");
      });
  };

  return { status, message, recheckNow };
}
