# bclaw Endpoints Registry

This file is the authoritative list of systems/endpoints available to agents.
It is loaded into the database on startup via `npm run db:seed`.
Add entries here and re-run `npm run db:seed` to register them.

---

## Format

```
## <unique-name>

- **description**: Human-readable description
- **baseUrl**: https://...
- **tags**: comma-separated list for discovery
- **notes**: (optional) free-form markdown for agents to reference
```

---

## extreme-xco-primary

- **description**: Extreme Networks XCO Controller (primary datacentre)
- **baseUrl**: https://xco.example.com
- **tags**: networking, extreme-xco, primary
- **notes**: |
  XCO is the management controller for Extreme Networks fabric switches.
  Authentication: Bearer token via `/oauth2/token` (client credentials).
  Primary API: `/rest/v1/` — see OpenAPI spec at `/rest/v1/openapi.json`.
  Rate limit: 120 req/min per client.

## extreme-xco-dr

- **description**: Extreme Networks XCO Controller (DR / failover site)
- **baseUrl**: https://xco-dr.example.com
- **tags**: networking, extreme-xco, dr
- **notes**: |
  Disaster recovery instance. Read-only for normal operations.
  Promoted to primary only during failover events.
