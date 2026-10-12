### Environment Context for WirelessAPMonitor

1. **ExtremeCloudIQ Platform**:
   - The agent operates within the ExtremeCloudIQ ecosystem, which provides telemetry, monitoring, and diagnostic data for wireless access points.
   - Access points are distributed across various locations and are managed centrally.

2. **Wireless Access Points**:
   - Each access point has multiple radios operating on different frequencies.
   - Radios can become inactive due to hardware issues, configuration errors, or environmental factors.

3. **Key Metrics**:
   - **Inactive Radios**: Radios that are not broadcasting or receiving signals.
   - **Noise Floor**: Background interference levels that can impact signal quality.
   - **Channel Congestion**: Over-utilization of specific channels leading to degraded performance.

4. **Alerting Mechanism**:
   - Alerts are sent via Telegram to ensure immediate visibility.
   - Alerts are formatted to include actionable insights.

5. **System Facts**:
   - Telemetry data is updated every 15 minutes.
   - Access points are tagged with location and ID for easy identification.
   - Noise floor and congestion thresholds are predefined based on industry standards.

6. **Permissions**:
   - The agent requires read access to telemetry and monitoring data.
   - Write access is needed for sending alerts and logging issues.