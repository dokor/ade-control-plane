# Agent executors

The worker exposes one `AgentExecutor` contract for implementation work. The
executor receives a bounded prompt through stdin and returns the command result
and streamed output; it does not commit, push, create pull requests, or merge.

`V0_AGENT_PROVIDER` selects the implementation:

- `codex` (default): `codex exec --sandbox workspace-write --ephemeral --json -`
- `claude-code`: `claude --print --output-format json`

Both providers run inside the same checkout, ADE validation, Git branch, push,
and human-reviewed PR lifecycle. There is no automatic fallback between
providers. Provider selection is explicit so a provider failure remains a
failure and cannot be reported as success.
