# Codex Quota History Contract

## Purpose

Define the simplest useful quota behavior for issue #4 and the Dashboard target.

This is not a billing or token-accounting system. It is a lightweight history of the quota values Codex actually exposes whenever the control plane asks for them.

## Observation rule

Every successful real quota read produces one normalized snapshot.

Conceptually:

```text
Codex/App Server quota read
→ provider adapter validates response
→ normalize supported fields
→ persist one provider_quota_snapshot
→ evaluate quota policy
→ expose current value + history to Dashboard
```

No synthetic interpolation is required between observations.

## Minimum normalized fields

Persist only values actually available:

```text
provider
account_ref
policy_state
used_percent        nullable
window_started_at   nullable
resets_at           nullable
observed_at
expires_at           nullable
metadata             bounded normalized metadata only
```

Never invent `used_percent` when Codex does not expose it.

## Retention

Initial retention is a rolling 30 days.

Rules:

- keep every successful observation for at least 30 days;
- observations older than 30 days may be deleted by a simple scheduled cleanup;
- cleanup must not delete the latest snapshot even if clock/configuration anomalies occur;
- retention is global provider telemetry, not per-project billing;
- raw provider payloads and credentials are not retained.

A later configurable retention period is allowed but is not required now.

## Sampling frequency

Do not poll solely to build a prettier chart.

Persist a snapshot whenever a quota read is already required by orchestration, for example:

- worker wake-up before dispatch;
- reset-aware wake-up;
- explicit Dashboard refresh when implementation chooses to fetch live state;
- recovery/startup refresh;
- a scheduled freshness refresh needed by quota policy.

Rate-limit unnecessary reads if the provider data is still fresh according to the adapter/policy.

## Dashboard representation

The Dashboard needs:

- current normalized quota state;
- used percentage when known;
- reset/window information;
- freshness/age;
- a simple 30-day history chart or timeline.

When values are missing or stale, show `unknown`/stale explicitly.

Do not display a smooth/generated curve that implies observations the system never made. A step/point history is acceptable.

## Cleanup behavior

A simple cleanup query is sufficient conceptually:

```sql
DELETE FROM provider_quota_snapshots
WHERE observed_at < NOW() - INTERVAL '30 days'
  AND id <> (
    SELECT id
    FROM provider_quota_snapshots
    ORDER BY observed_at DESC
    LIMIT 1
  );
```

The implementation may use a safer/provider-scoped variant; the important contract is 30-day rolling retention plus preservation of the latest observation.

## Failure behavior

If a quota read fails:

- do not create a fake successful snapshot;
- retain the last successful observation with its original timestamp;
- expose freshness/staleness honestly;
- apply the configured conservative stale/unknown scheduling policy;
- persist an operational/audit-safe failure event if useful, without raw provider response or credentials.

## Acceptance scenarios

1. Two quota reads with different values create two historical points.
2. Repeated reads on the same day are retained; no daily aggregation is required.
3. A failed read leaves the last successful snapshot unchanged and visible as stale when appropriate.
4. A missing percentage remains `null`, not `0` or an inferred value.
5. Cleanup removes data older than 30 days while preserving current state.
6. Dashboard history reflects actual observation timestamps.
7. No raw token, auth header or provider credential reaches the table or UI.

## Non-goals

- per-project Codex cost allocation;
- precise token accounting;
- invoices/billing reconciliation;
- forecasting spend;
- provider comparison analytics;
- long-term data warehouse.
