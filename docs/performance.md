# Performance validation

This package can be tested without private services or credentials.

## Unit tests (Docker not required)

```bash
npm ci
npm run check
npm run lint
npm run test:unit
npm run build
```

## Integration tests

Install Docker Engine and the Compose plugin, and ensure the daemon is running.
The repository's `docker-compose.yaml` builds `examples/demo-server.mjs`
inside a public Node.js container. It exposes `/ready`, `/alive`, and
Prometheus-format `/metrics` on port 8080, and the integration tests manage
its lifecycle.

```bash
docker compose build
npm run test:integration
```

The demo is intentionally lightweight and should not be used as a realistic
performance benchmark. For meaningful load tests, substitute your own service
that exposes the expected readiness and metrics endpoints.

## Runner correctness

Before relying on generated throughput or latency reports, verify that runner
request allocation preserves the requested total and that worker failure
paths settle and clean up resources. See `src/runner.ts` and
`test/unit/runner.test.ts` for the implementation and unit coverage.
