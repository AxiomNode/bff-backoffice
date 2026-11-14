# Architecture

Last updated: 2026-11-14.

## Purpose

This section documents the repository-local architecture of `bff-backoffice`.

## Scope

It should describe:

- API behavior focused on internal business operations
- data aggregation for operational dashboards and admin panels
- integration and synchronization with `api-gateway` and internal services

## Runtime position

`bff-backoffice` is both a channel adapter and a narrow runtime control component.

It sits behind `api-gateway`, aggregates operational data from internal services, and proxies one runtime control: the ai-engine llama target, which is owned and persisted by `ai-engine-api`.

## Owned architectural responsibilities

- expose monitoring and control endpoints for the backoffice UI
- aggregate data from users, quiz, word-pass, and AI diagnostics sources
- let operators read, probe, set and reset the ai-engine llama target (`/v1/backoffice/ai-engine/target`, `/v1/backoffice/ai-engine/probe`) and read the ai-engine plugin capabilities, forwarding changes to `ai-engine-api` `/internal/admin/llama-target`
- record admin and mutating actions in an append-only audit trail

## Downstream dependency model

Primary direct dependencies:

- `microservice-users`
- `microservice-quizz`
- `microservice-wordpass`
- `ai-engine-stats`
- `ai-engine-api` (llama target and plugin capabilities, private `/internal/*` routes)
- `api-gateway` (service metrics and logs reads only)

## Runtime state model

The BFF holds no persisted routing state. Upstream service URLs come from environment variables, and the llama target override is persisted by `ai-engine-api` (`AI_ENGINE_LLAMA_TARGET_STATE_FILE`). The only state the BFF writes itself is the audit trail.

Service-target overrides, shared AI presets and connections, routing history and the Kubernetes overview were removed (PR #9); see `../docs/operations/runtime-routing-and-service-targeting.md` in the central docs repository.

## Failure boundaries

- diagnostics aggregation fails while the BFF remains healthy
- allowlist policy (`ALLOWED_ROUTING_TARGET_HOSTS`) blocks intended retargeting
- the call to `ai-engine-api` fails, and the target change is reported as `400`

## When to update

Update this section when changing operator API boundaries, the llama target control, or its `ai-engine-api` dependency.
