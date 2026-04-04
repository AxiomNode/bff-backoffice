# AGENTS

## Repo purpose
Backoffice BFF that aggregates internal services into admin-friendly endpoints.

## Key paths
- src/: Fastify handlers, service clients, schemas
- docs/: architecture, guides, operations
- .github/workflows/ci.yml: CI + infra dispatch

## Local commands
- cd src && npm install
- cd src && npm run dev
- cd src && npm test && npm run lint && npm run build

## CI/CD notes
- Push to main dispatches platform-infra build-push with service=bff-backoffice.
- Platform-infra handles rollout to dev.

## LLM editing rules
- Keep BFF orchestration logic separate from domain services.
- Maintain stable response shapes for backoffice clients.
- Reflect contract/route updates in docs.
