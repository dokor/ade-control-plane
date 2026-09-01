"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { dashboardErrorMessage, requestDashboardJson } from "../lib/apiClient.js";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await requestDashboardJson("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      }, "Sign-in was refused.");
      setPassword("");
      router.replace(next);
      router.refresh();
    } catch (reason) {
      setError(dashboardErrorMessage(reason, "Sign-in was refused."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label htmlFor="password">Operator password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "…" : "Sign in"}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </form>
  );
}
