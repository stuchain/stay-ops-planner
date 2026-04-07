# Notification Provider Interface and Delivery Policy

## Purpose
Define a provider-agnostic interface for WhatsApp/SMS delivery, plus retry behavior and failure handling expectations for future implementation.

## Interface Contract
```ts
interface NotificationProvider {
  send(message: OutboundAlert, idempotencyKey: string): Promise<DeliveryResult>;
  health(): Promise<ProviderHealth>;
}
```

## Interface Semantics
- `send(...)` must be safe to retry with the same `idempotencyKey`.
- `health()` returns provider availability and degraded-state metadata for readiness checks.
- Interface remains transport-neutral so WhatsApp and SMS implementations conform to one contract.

## Idempotency Policy
- `idempotencyKey` should be deterministic from `(eventType, scope, occurredAtBucket)`.
- Sending with an already-seen key must not produce duplicate user-visible messages.
- Providers without native idempotency support require an app-side dedupe store.

## Delivery State Model
- `queued`: accepted for asynchronous send attempt.
- `sent`: provider accepted and returned a delivery identifier.
- `failed`: terminal failure for this attempt, no further retries for permanent class.
- `dead_letter`: moved after retry exhaustion or policy-driven quarantine.

## Error Normalization
All provider-specific errors should map to normalized classes:
- `transient_network`: timeout, temporary network interruption.
- `rate_limited`: provider throttling or quota window reached.
- `provider_unavailable`: service outage or dependency unavailable.
- `invalid_recipient`: malformed or unsupported destination.
- `invalid_template`: missing/invalid approved template.
- `unauthorized`: credential/authentication failure.
- `unknown`: unmapped provider error.

## Retry and Backoff Strategy
- Retry only normalized transient classes: `transient_network`, `rate_limited`, `provider_unavailable`.
- Do not retry permanent classes: `invalid_recipient`, `invalid_template`, `unauthorized`.
- Use exponential backoff with jitter (example sequence: 30s, 2m, 10m, 30m, 2h).
- After max attempts, transition to `dead_letter`.

## Dead-Letter and Operator Visibility
- Dead-letter entries must include event metadata, final error class, and last provider response summary.
- Expose dead-letter counts and oldest age in operator dashboards.
- Trigger operator alert when dead-letter backlog exceeds threshold.

## Normalization Layer Requirements
- Keep raw provider response for forensic review, but do not leak provider-specific details into domain contracts.
- Preserve correlation identifiers for tracing across send attempts and retries.
- Ensure all mappings are versioned and testable before provider rollout.
