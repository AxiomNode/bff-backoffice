# bff-backoffice docs

Last updated: 2026-05-08.

Technical documentation for the backoffice BFF service.

## Purpose

This local docs folder explains the concrete implementation surface of `bff-backoffice`:

- operator-facing orchestration behavior
- repository-owned runtime routing state and synchronization behavior
- local operational workflow for diagnostics and targeting features

## Navigation

- `architecture/README.md`: repository-local architecture and control-plane boundary.
- `guides/README.md`: admin and reporting endpoint evolution guidance.
- `operations/README.md`: local runbook and runtime-state troubleshooting notes.

## Reading order

1. Start with `architecture/README.md`.
2. Continue with `guides/README.md` when changing operator APIs.
3. Use `operations/README.md` for local run and routing-state checks.

## When to use this

- when the central platform docs are too broad for a backoffice BFF change
- when you need the repository-local navigation entry for architecture, guides, and operations

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `bff-backoffice`.
