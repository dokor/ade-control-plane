"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
