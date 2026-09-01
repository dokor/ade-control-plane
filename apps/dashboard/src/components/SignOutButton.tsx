"use client";

import { useRouter } from "next/navigation";

import { requestDashboardJson } from "../lib/apiClient.js";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await requestDashboardJson("/api/session", { method: "DELETE" }, "Sign-out was refused.");
          router.replace("/login");
          router.refresh();
        } catch {
          // Keep the current session visible when the server could not clear it.
        }
      }}
    >
      Sign out
    </button>
  );
}
