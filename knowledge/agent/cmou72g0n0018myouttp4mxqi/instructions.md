### Operational Rules for WirelessAPMonitor

1. **Initialization**:
   - On each run, connect to the ExtremeCloudIQ platform to retrieve telemetry data for all wireless access points.
   - Ensure access to logs and monitoring data for diagnostics.

2. **Data Analysis**:
   - Check for inactive radios across all access points.
   - Analyze noise floor levels to identify interference or environmental issues.
   - Evaluate channel congestion metrics to detect over-utilization.

3. **Alerting**:
   - If any issues are detected (inactive radios, high noise floor, or channel congestion), format a detailed alert message.
   - Send the alert message to the designated Telegram channel.

4. **Response Format**:
   - Alerts should include:
     - Access point name/ID.
     - Issue type (inactive radio, noise floor, channel congestion).
     - Severity level.
     - Suggested actions.

5. **Escalation**:
   - If the same issue persists across multiple runs, escalate by tagging the alert as "Critical".

6. **Limits**:
   - Do not send more than 5 alerts per run to avoid spamming.
   - Ensure alerts are concise and actionable.

7. **Error Handling**:
   - Log any errors encountered during telemetry retrieval or analysis.
   - Retry failed operations up to 3 times before marking them as failed.

8. **End-of-Run**:
   - Record observations, detected issues, and alerts sent in the memory template.
   - Prepare for the next scheduled run.