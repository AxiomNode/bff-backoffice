# bff-backoffice

Backend for Frontend for the AxiomNode backoffice panel.

## Purpose

- Expose APIs oriented to administration workflows.
- Consolidate microservice information for operational dashboards.
- Decouple backoffice UX from internal contracts.

## Main responsibility

- Operational aggregation for admin panel and secure proxy to internal services.

## Structure

- `src/`: Fastify + TypeScript service.
- `docs/`: architecture, guides, and operations.
- `.github/workflows/ci.yml`: base pipeline.

## Quick start

1. `cd src`
2. `cp .env.example .env`
3. `npm install`
4. `npm run dev`

## Endpoints

- `GET /health`
- `GET /v1/backoffice/users/leaderboard`
- `GET /v1/backoffice/monitor/stats`

## Internal dependencies

- `USERS_SERVICE_URL`
