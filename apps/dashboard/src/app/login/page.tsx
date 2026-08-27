import { redirect } from "next/navigation";

import { LoginForm } from "../../components/LoginForm.js";
import { readSession } from "../../lib/auth.js";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session } = await readSession();
  const params = await searchParams;
  const requested = typeof params.next === "string" ? params.next : "/";
  // Only same-site relative paths are accepted as a post-login destination.
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (session?.canRead) redirect(next);

  return (
    <div className="shell">
      <header className="top">
        <h1>ADE Control Plane</h1>
      </header>
      <main>
        <section className="panel">
          <h2>Sign in</h2>
          <p className="muted">
            Supervision and control require an authenticated session.
          </p>
          <LoginForm next={next} />
        </section>
      </main>
    </div>
  );
}
