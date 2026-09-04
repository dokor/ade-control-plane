import Link from "next/link";
import type { ReactNode } from "react";

import { AutoRefresh } from "./AutoRefresh.js";
import { HeaderQuotaIndicator } from "./HeaderQuotaIndicator.js";
import { SignOutButton } from "./SignOutButton.js";

export function Shell({
  title,
  actorRef,
  refreshIntervalMs,
  children,
}: {
  title: string;
  actorRef: string;
  refreshIntervalMs: number;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <AutoRefresh intervalMs={refreshIntervalMs} />
      <header className="top">
        <h1>{title}</h1>
        <nav className="primary">
          <Link href="/">Dashboard</Link>
          <Link href="/tasks">Tasks</Link>
          <Link href="/runners">Runners</Link>
          <Link href="/analytics">Analytics</Link>
          <Link href="/settings">Settings</Link>
          <HeaderQuotaIndicator />
          <SignOutButton />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
