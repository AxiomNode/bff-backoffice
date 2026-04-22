# Architecture

## Scope

This section documents the repository-local architecture of `bff-backoffice`.

It should describe:

- API behavior focused on internal business operations
- data aggregation for operational dashboards and admin panels
- integration and synchronization with `api-gateway` and internal services

## Runtime position

`bff-backoffice` is both a channel adapter and a narrow runtime control component.

It sits behind `api-gateway`, aggregates operational data from internal services, and persists operator-visible routing metadata that affects the live topology.

## Owned architectural responsibilities

- expose monitoring and control endpoints for the backoffice UI
- aggregate data from users, quiz, word-pass, and AI diagnostics sources
- persist shared service-target overrides and AI destination presets
- synchronize AI target changes toward `api-gateway`

## Downstream dependency model

Primary direct dependencies:

- `microservice-users`
- `microservice-quizz`
- `microservice-wordpass`
- `ai-engine-stats`
- `api-gateway` sync path for live AI target changes

## Runtime state model

Repository-owned persisted state includes:

- shared service-target overrides
- shared AI destination presets

This state is part of the effective runtime topology and must be treated as operationally significant.

## Failure boundaries

- diagnostics aggregation fails while the BFF remains healthy
- persisted routing state diverges from gateway-effective target state
- allowlist policy blocks intended retargeting
- synchronization toward gateway fails after local state update

## When to update

Update this section when changing operator API boundaries, persisted routing-state behavior, or synchronization dependencies.
