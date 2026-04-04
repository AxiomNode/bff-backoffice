# bff-backoffice docs

Technical documentation for the backoffice BFF service.

## Sections

- `architecture/README.md`: architecture boundaries and aggregation model.
- `guides/README.md`: endpoint design for admin and reporting flows.
- `operations/README.md`: local runbook and secret injection flow.

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `bff-backoffice`.
