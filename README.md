# bff-backoffice

Backend for Frontend para el panel de backoffice de AxiomNode.

## Objetivo

- Exponer APIs orientadas a flujos de administracion.
- Consolidar informacion de microservicios para paneles operativos.
- Desacoplar UX de backoffice de contratos internos.

## Estructura

- `src/`: servicio Fastify + TypeScript.
- `docs/`: arquitectura, guias y operacion.
- `.github/workflows/ci.yml`: pipeline base.

## Inicio rapido

1. `cd src`
2. `cp .env.example .env`
3. `npm install`
4. `npm run dev`
