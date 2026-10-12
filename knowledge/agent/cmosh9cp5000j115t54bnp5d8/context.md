# Environment Context for XCO Watcher

## Relevant Systems
1. **Inventory Service**: Provides device state and topology information.
2. **Health and Fault Signals**: Supplies alerts and alarms for the network.
3. **Policy vs Actual State**: Enables drift detection between intended and actual network states.

## Topology
1. **XCO-Managed Network**: Includes devices, fabric, tenants, and topology.
2. **Data Sources**: Integrated with ExtremeCloud IQ and XCO systems for monitoring and diagnostics.

## Key Facts
1. **Monitoring Scope**: Covers device health, fabric health, alerts, alarms, topology changes, and drift detection.
2. **Operator Goal**: Ensure the network is stable or identify areas requiring attention.
3. **Update Frequency**: Checks are performed every 5 minutes.

## Permissions
1. **Read Access**: Required for network data, alerts, telemetry, and topology.
2. **Escalation**: Notify operators when abnormalities or risks are detected.