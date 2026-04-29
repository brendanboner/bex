# XCO / EFA Domain Context

## What is XCO/EFA?
**ExtremeCloud Orchestrator (XCO)** is Extreme Networks' cloud-hosted IP fabric orchestration platform. The on-premises version is called **EFA (Extreme Fabric Automation)**. Both use the same REST API (`/rest/v1`).

XCO automates the design, deployment, and lifecycle management of **IP Fabrics** (CLOS topologies) built from Extreme Networks **SLX** and **VDX** series data centre switches.

## Core Concepts

| Concept | Description |
|---|---|
| **IP Fabric** | A layer-3 routed underlay using BGP between spines and leaves |
| **CLOS topology** | Fat-tree network — 3-stage, 5-stage, or 7-stage configurations |
| **EVPN** | BGP address family used as the control plane for VXLAN overlays |
| **VXLAN** | Layer-2 encapsulation over IP — used for L2 stretch and L3 VRF routing |
| **VTEP** | VXLAN Tunnel End Point — one per switch (usually loopback interface) |
| **VNI** | VXLAN Network Identifier — analogous to VLAN ID but for overlay networks |

## Supported Hardware
- **SLX Series**: SLX 9030, 9140, 9150, 9240, 9250, 9540, 9640, 9740, 9850
- **VDX Series**: VDX 6740, 6940, 8770
- Minimum firmware: SLX-OS 20.2, NOS 7.3

## API Summary
Base URL: `https://{xco-host}/rest/v1`

All API calls require a Bearer token. Token validation: `xco_validate_token`.

Key endpoints:
- `/devices` — switch inventory and state
- `/fabrics` — IP fabric CRUD and status
- `/alarms` — alarm history, acknowledge, close, purge
- `/system/health` — K8s platform health

## How BEX Uses XCO
- **XCO Monitor** (read-only): `xco_get_inventory`, `xco_get_fabrics`, `xco_validate_fabric`, `xco_get_alarm_*`, `xco_get_system_health`
- **XCO Operator** (writes require approval): `xco_register_device`, `xco_create_fabric`, `xco_ack_alarms`, `xco_close_alarms`, `xco_update_device_setting`

### ✅ Composite Topology Tool

For network topology diagrams use the **`xco_topology_mermaid`** composite tool instead of separate API calls.

```
xco_topology_mermaid()
  → topology_diagram: Mermaid "graph LR" string (spine/leaf nodes with LLDP edges, health-coloured)
  → summary: { total_switches, total_fabrics, lldp_links, spines, leaves }
  → switches: [{ name, ip, fabric, role, state, model }]
  → fabrics: [{ name, status, type, stage }]
```

**Dashboard prompt that works:** *"Show me a network topology diagram of the XCO fabric"*

**OUTPUT FORMAT for dashboards:** Always return a JSON object with `topology_diagram` as a plain Mermaid string:
```json
{
  "topology_diagram": "graph LR\n  subgraph PROD-DC1...",
  "summary": { "total_switches": 6, "spines": 2, "leaves": 4 },
  "switches": [...],
  "fabrics": [...]
}
```
Do NOT wrap the diagram in markdown fences.

All write operations follow the pattern: **Read current state → Describe change → Get approval → Execute**.

## Device States

| App State | Meaning |
|-----------|---------|
| `cfg in-sync` | Device config matches XCO — healthy |
| `cfg refreshed` | Device config diverged (out-of-band change detected) — run drift-reconcile |
| `cfg refresh error` | Drift-reconcile failed to sync — check device reachability |
| `provisioned` | Device registered and fabric config applied |
| `provisioning-failed` | Fabric provisioning encountered an error |
| `maintenance` | Device in maintenance mode (e.g., during DRC) |
| `unreachable` | XCO cannot reach the device via HTTPS |

## EFA/XCO Pod Services (Kubernetes)

Key pods running in the `efa` namespace:
- `goraslog-service` — log aggregation
- `gofaultmanager` — alarm/fault management
- `gopolicy` — policy engine
- `rabbitmq` — message bus (if stuck, most EFA functions break)
- `mariadb` / database pod — persistence layer

Common pod health commands:
```bash
kubectl get pods -n efa                    # all pods and status
kubectl logs -n efa <pod> --tail=100       # recent pod logs
kubectl describe pod -n efa <pod>          # events and state
sudo systemctl status k3s                  # K3s orchestrator status
journalctl -u k3s -n 100                   # K3s logs
```

## Troubleshooting Reference
See `knowledge/xco/troubleshooting.md` for detailed per-symptom guides extracted from the official XCO 4.0.0 Troubleshooting Reference Guide (December 2025).
