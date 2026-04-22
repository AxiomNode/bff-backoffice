# Guides

## Scope

This section groups repository-local guidance for evolving `bff-backoffice` safely.

## Change rules

- add functionality here only when it belongs to operator-facing aggregation or control
- do not hide runtime override behavior from operators; surface source and effect explicitly
- keep UI-facing control routes reversible and auditable

## Intended topics

- admin and reporting endpoint design
- diagnostics and targeting workflow evolution
- compatibility rules for backoffice-facing contracts

## Compatibility checklist

Before changing a backoffice-facing endpoint, verify:

1. whether the endpoint is read-only diagnostics or live control
2. whether the response must expose default versus override state
3. whether the change also affects `api-gateway` synchronization
4. whether the behavior is shared across operators or only browser-local
