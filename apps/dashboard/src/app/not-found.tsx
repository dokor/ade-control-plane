import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell">
      <header className="top">
        <h1>ADE Control Plane</h1>
      </header>
      <main>
        <section className="panel">
          <h2>Page not found</h2>
          <p className="muted">The page you are looking for does not exist.</p>
          <Link className="button primary" href="/">
            Back to overview
          </Link>
        </section>
      </main>
    </div>
  );
}
