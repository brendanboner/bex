# BEX Skill Registry Server

A standalone Docker service that runs the BEX skill registry, compatible with `skills.octorapidlabs.com`. Any BEX instance can push/pull skills to/from this registry.

## Quick Start

```bash
cd registry-server
cp .env.example .env
# Edit .env: set a strong REGISTRY_TOKEN
docker-compose up -d
```

The registry will be available at `http://localhost:5050`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5050` | Port to expose the registry |
| `REGISTRY_TOKEN` | `bex-registry-token` | Bearer token for auth |
| `REGISTRY_DATA_DIR` | `/data` | Data directory (volume-backed) |

## Connecting a BEX Instance

In your BEX `.env`:

```env
SKILL_REGISTRY_URL=https://your-registry.example.com
SKILL_REGISTRY_TOKEN=your-token-here
```

Or use the CLI:

```bash
bex registry set https://your-registry.example.com --token your-token-here
bex registry test
```

Or from the dashboard: **LLM Providers → Registry Config → Set URL**.

## Running skills.octorapidlabs.com

This is the canonical BEX public skill registry. To host your own equivalent:

1. Deploy this Docker service behind a domain (e.g. `skills.yourdomain.com`)
2. Configure TLS (Let's Encrypt via nginx or Caddy)
3. Set `REGISTRY_TOKEN` to a strong secret
4. Point BEX instances to your domain

## Health Check

```bash
curl http://localhost:5050/health
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/registry/skills` | List available skills |
| `GET` | `/registry/skills/:domain/:version` | Fetch a skill manifest |
| `POST` | `/registry/publish` | Publish a skill (requires auth) |
