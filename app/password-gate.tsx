"use client";

// 비밀번호를 입력해야 안쪽 화면을 보여 준다. 화면 가리기는 편의일 뿐이고, 실제 잠금은 서버 코드(API)가 한다.

import { useEffect, useState, type ReactNode } from "react";
import { card, fieldBox, heading, hint, primaryButton } from "./ui";

type State = "checking" | "locked" | "open" | "unconfigured";

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((response) => response.json())
      .then((body: { configured?: boolean; authenticated?: boolean }) => {
        if (cancelled) return;
        setState(body.configured === false ? "unconfigured" : body.authenticated ? "open" : "locked");
      })
      .catch(() => {
        if (!cancelled) setState("locked");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy || password === "") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        setPassword("");
        setState("open");
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "로그인하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.");
    } catch {
      setError("서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    setState("locked");
  }

  if (state === "checking") {
    return <p className="text-sm text-muted">확인하는 중…</p>;
  }

  if (state === "unconfigured") {
    return (
      <section className={card}>
        <h2 className={heading}>비밀번호가 설정되지 않았습니다</h2>
        <p className={hint}>.env 파일의 APP_PASSWORD 뒤에 사용할 비밀번호를 적고 서버를 다시 켜 주세요.</p>
      </section>
    );
  }

  if (state === "locked") {
    return (
      <section aria-labelledby="login" className={card}>
        <h2 id="login" className={heading}>
          비밀번호 입력
        </h2>
        <p className={hint}>이 도구는 비밀번호를 아는 사람만 쓸 수 있습니다.</p>
        <form onSubmit={login} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="password"
            autoComplete="current-password"
            aria-label="비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            className={`${fieldBox} min-w-0 flex-1`}
          />
          <button type="submit" disabled={busy || password === ""} className={primaryButton}>
            {busy ? "확인 중…" : "들어가기"}
          </button>
        </form>
        <div aria-live="polite" className="mt-3 text-sm">
          {error && (
            <p role="alert" className="rounded-2xl bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="-mb-2 flex justify-end">
        <button type="button" onClick={logout} className="text-sm text-muted hover:underline">
          로그아웃
        </button>
      </div>
      {children}
    </>
  );
}
