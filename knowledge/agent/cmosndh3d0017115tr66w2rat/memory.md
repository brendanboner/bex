### Memory Template

#### Observations
- **Timestamp**: [Insert timestamp]
- **Access Points Monitored**: [List of access points]
- **Issues Identified**: [Description of issues]
- **Client Radio Analysis**: [Summary of findings]

#### Actions Taken
- **Plans Developed**: [Details of implementation plans]
- **Permissions Requested**: [Details of permission requests]
- **Changes Implemented**: [Description of changes]

#### Open Items
- **Unresolved Issues**: [List of unresolved issues]
- **Pending Actions**: [List of pending actions]

#### Notes
- [Additional observations or comments]

<!-- 2026-05-05T13:12:59.630Z — Wireless_Network_Monitor — scheduled -->
### Wireless Network Summary
- **Total Access Points Monitored**: 7
- **Access Points with Radio Data**: 5
- **Total Locations**: 1
- **Timestamp**: 2026-05-05T13:12:44.235Z

### Access Point Radio Details
| Access Point         | Radio | Frequency | Channel | Channel Width | TX Power (dBm) | Noise Floor (dBm) | Mode       | Client Count |
|----------------------|-------|-----------|---------|---------------|----------------|-------------------|------------|--------------|
| Office AP5020        | wifi0 | 2.4GHz    | 11      | MHZ_20        | 18             | 0                 | _11be_2g   | 3            |
| Office AP5020        | wifi1 | 5GHz      | 153     | MHZ_20        | 9              | 0                 | _11be_5g   | 4            |
| Office AP5020        | wifi2 | 6GHz      | 53      | MHZ_80        | 18             | 0                 | _11be_6g   | 1            |
| FrontAP3000          | wifi0 | 2.4GHz    | 1       | MHZ_20        | 14             | 0                 | _11ax_2g   | 3            |
| FrontAP3000          | wifi1 | 5GHz      | 36      | MHZ_20        | 9              | 0                 | _11ax_5g   | 4            |
| TestAP3000           | wifi0 | 2.4GHz    | 1       | MHZ_20        | 9              | 0                 | _11ax_2g   | 1            |
| TestAP3000           | wifi1 | 5GHz      | 44      | MHZ_20        | 18             | 0                 | _11ax_5g   | 1            |
| Beverly Main AP5010  | wifi0 | 2.4GHz    | 6       | MHZ_20        | 18             | 0                 | _11ax_2g   | 3            |
| Beverly Main AP5010  | wifi1 | 5GHz      | 36      | MHZ_40        | 5              | 0                 | _11ax_5g   | 4            |
| Beverly Main AP5010  | wifi2 | 6GHz      | 69      | MHZ_80        | 18             | 0                 | _11ax_6g   | 1            |
| TestAP5010U          | wifi0 | 2.4GHz    | 0       | MHZ_20        | 0              | 0                 | _11ax_2g   | 1            |
| TestAP5010U          | wifi1 | 5GHz      | 36      | MHZ_20        | 10             | 0                 | _11ax_5g   | 1            |
| TestAP5010U          | wifi2 | 6GHz      | 0       | MHZ_80        | 0              | 0                 | _11ax_6g   | 1            |

### Observations
1. **TestAP5010U**:
   - Radios `wifi0` and `wifi2` are inactive (TX Power = 0, Channel = 0).
   - Requires further investigation to determine if this is intentional or a fault.

2. **General Noise Floor**:
   - Noise floor is consistently reported as 0 dBm across all radios, which is unusual and may indicate a reporting issue.

3. **Channel Utilization**:
   - All radios report 0% utilization, which is unexpected for active networks. This may require validation.

4. **Client Distribution**:
   - Most clients are connected to 5GHz radios, indicating effective band steering.

### Next Steps
1. Investigate inactive radios on **TestAP5010U**.
2. Validate noise floor and channel utilization reporting for accuracy.
3. Monitor client distribution and ensure balanced load across APs.
4. Develop a plan to address any identified issues.

Would you like me to proceed with further diagnostics or draft a resolution plan?

<!-- 2026-05-05T13:20:32.091Z — manual-cmosnoope001b115tls3g5j0e -->
### Current Monitoring Summary

#### Access Points Overview
- **Total Access Points Monitored**: 7
- **Access Points with Radio Data**: 5
- **Locations Monitored**: 1

#### Observations
1. **Inactive Radios**:
   - **TestAP5010U**: Radios `wifi0` and `wifi2` are inactive (TX Power = 0, Channel = 0). Requires investigation to determine if this is intentional or a fault.
   
2. **Noise Floor Reporting**:
   - Noise floor is consistently reported as 0 dBm across all radios, which is unusual and may indicate a reporting or telemetry issue.

3. **Channel Utilization**:
   - All radios report 0% utilization, which is unexpected for active networks. This may require validation.

4. **Client Distribution**:
   - Most clients are connected to 5GHz radios, indicating effective band steering. However, client load balancing across APs should be monitored.

---

### Next Steps
1. **Investigate Inactive Radios**:
   - Validate the configuration and status of **TestAP5010U** radios `wifi0` and `wifi2`.
   - Check for hardware issues or intentional configuration settings.

2. **Validate Noise Floor and Channel Utilization**:
   - Confirm if the 0 dBm noise floor and 0% channel utilization are accurate or a telemetry reporting issue.
   - Use spectrum analysis tools if necessary.

3. **Monitor Client Distribution**:
   - Ensure balanced client load across APs and radios.
   - Identify any APs with high client counts or uneven distribution.

4. **Develop a Resolution Plan**:
   - If issues are confirmed, draft a plan for configuration updates or testing.
   - Obtain permissions from the interface channel before implementing changes.

Would you like me to proceed with diagnostics for the inactive radios or validate the noise floor and channel utilization?