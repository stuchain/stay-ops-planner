# Alerts Rollout Checklist (WhatsApp + SMS)

## Purpose
Operational checklist to launch alerting safely with template governance, recipient consent, and failure handling.

## Ownership
- **Runbook owner**: Operations Engineering
- **Template owner**: Operations Lead
- **Consent/compliance owner**: Legal or Privacy delegate
- **Incident owner**: On-call Operations

## Pre-Launch Checklist

### Provider setup and security
- [ ] Provider account provisioned for production tenant.
- [ ] API credentials stored in secure secret manager.
- [ ] Credential rotation schedule defined (owner + cadence).
- [ ] Provider callback/webhook authenticity method documented.

### Template approvals and versioning
- [ ] All outbound templates approved by operator owner.
- [ ] Provider-side template approval IDs recorded.
- [ ] Versioning convention defined (e.g. `ops_alert_v3`).
- [ ] Rollback template version identified for emergency fallback.

### Recipient consent and governance
- [ ] Recipient source of truth documented (system/table/service).
- [ ] Consent capture path documented (who collected, when, purpose).
- [ ] Opt-out enforcement and SLA documented.
- [ ] Audit trail fields captured for consent updates.

### Delivery policy and quiet hours
- [ ] Severity routing policy approved (`medium` vs `high` behavior).
- [ ] Quiet-hours policy defined with exception rules for critical alerts.
- [ ] Regional/timezone handling validated for recipient groups.

## Failure Handling and Fallback

### Provider degraded or unavailable
- [ ] Fallback channel defined and tested (in-app banner and/or operator dashboard notice).
- [ ] Escalation path defined for prolonged provider outage.
- [ ] Manual notification playbook prepared for severe incidents.

### Retry and dead-letter operations
- [ ] Dead-letter queue ownership assigned.
- [ ] Dead-letter triage cadence defined (e.g. every 30 minutes during incidents).
- [ ] Alerting threshold for dead-letter backlog configured.
- [ ] Re-drive procedure documented with idempotency protections.

## Launch-Day Verification
- [ ] Send test alerts for each event type to non-production recipients.
- [ ] Validate template rendering with minimal payload and full payload variants.
- [ ] Confirm duplicate-send prevention with repeated idempotency key.
- [ ] Confirm failed sends are visible in operator telemetry.

## Sign-off Table
| Role | Name | Date | Status |
|---|---|---|---|
| Operations Lead |  |  | Pending |
| Compliance/Privacy |  |  | Pending |
| On-call Engineer |  |  | Pending |

## Go/No-Go Criteria
- Do not enable production alerts until all mandatory checklist items are complete.
- Any unresolved compliance item is an automatic no-go.
- Fallback channel readiness is required before first production send.
