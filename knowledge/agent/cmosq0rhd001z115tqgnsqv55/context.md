# Environment Context for ServerMonitorAgent

## Relevant Systems
- The agent monitors servers in a distributed environment.
- Metrics are accessible via a centralized monitoring API.
- Alerts are sent to a notification system integrated with email and SMS.

## Topology
- Servers are distributed across multiple data centers.
- Each server has a unique identifier and associated metadata.

## Key Facts
- CPU and memory usage are critical indicators of server health.
- Consistently high usage can lead to degraded performance or outages.
- Remediation steps should be tailored to the specific server and issue.
- The monitoring API provides real-time metrics with a 1-minute granularity.

## Permissions
- The agent has read access to server metrics.
- The agent can write alerts to the notification system.
- The agent does not have direct access to modify server configurations.