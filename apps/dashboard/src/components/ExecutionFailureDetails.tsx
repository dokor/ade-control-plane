import React from "react";
import type { ExecutionDiagnosticView } from "../lib/executionDiagnostics.js";

export function ExecutionFailureDetails({ diagnostic }: { diagnostic: ExecutionDiagnosticView }) {
  return <section className="panel execution-diagnostic" aria-labelledby="failure-stage">
    <h2 id="failure-stage">Failed step: {diagnostic.stage || "Not recorded"}</h2>
    <p><strong>{diagnostic.code}</strong>{diagnostic.internalCode && diagnostic.internalCode !== diagnostic.code ? ` · ${diagnostic.internalCode}` : ""}</p>
    <p>{diagnostic.message || "No additional error message was recorded."}</p>
    <details><summary>Technical details · redacted operator diagnostic</summary>
      <dl className="project-metadata">
        <dt>Task / execution</dt><dd>{diagnostic.taskId}</dd>
        <dt>Error type</dt><dd>{diagnostic.errorType || "Unknown"}</dd>
        <dt>Command</dt><dd><code>{diagnostic.command || "No command recorded"}</code></dd>
        <dt>Exit code / signal</dt><dd>{diagnostic.exitCode ?? "Not available"} / {diagnostic.signal || "None"}</dd>
      </dl>
      <h3>Associated stderr</h3><pre>{diagnostic.stderr || "No stderr captured (the process may not have started)."}</pre>
      {diagnostic.stack ? <><h3>Server stack</h3><pre>{diagnostic.stack}</pre></> : null}
      <p className="muted">Output is bounded and redacted. Command argument values, prompts and environment are omitted.</p>
    </details>
  </section>;
}
