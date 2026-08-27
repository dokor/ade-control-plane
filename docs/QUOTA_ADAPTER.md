# Codex Quota Adapter

OpenAI documents token rate-limit, remaining-token and reset response headers. The adapter normalizes only these values, never credentials or raw responses. Missing headers remain `usedPercent: null`; policy becomes `unknown` and the MVP fails closed. A future Codex/App Server source can supply the same normalized observation without changing policy code.
