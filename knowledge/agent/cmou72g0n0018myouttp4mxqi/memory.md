### Memory Template for WirelessAPMonitor

#### Run Summary
- **Timestamp**: {{timestamp}}
- **Access Points Monitored**: {{access_points_count}}
- **Issues Detected**:
  - Inactive Radios: {{inactive_radios_count}}
  - Noise Floor Problems: {{noise_floor_issues_count}}
  - Channel Congestion: {{channel_congestion_count}}

#### Alerts Sent
- **Total Alerts**: {{alerts_sent_count}}
- **Details**:
  - Alert 1: {{alert_1_details}}
  - Alert 2: {{alert_2_details}}
  - ...

#### Errors Encountered
- **Error Count**: {{error_count}}
- **Details**:
  - Error 1: {{error_1_details}}
  - Error 2: {{error_2_details}}
  - ...

#### Notes
- {{additional_notes}}

<!-- 2026-05-06T15:11:36.604Z -->
### Observed API Behavior for WirelessAPMonitor

#### Issue with Wireless Performance and Quality Index APIs
- **Problem**: The `viewType` parameter for `get_wireless_performance`, `get_wireless_quality_index`, and `get_wireless_connectivity_experience` APIs causes a `400 BAD_REQUEST` error.
- **Details**: The error message indicates a type conversion failure for `viewType` from `java.lang.String` to an expected enum type.
- **Impact**: Unable to retrieve wireless performance, quality index, or connectivity experience data.
- **Next Steps**: Investigate the correct `viewType` values or consult API documentation/support for clarification.

<!-- 2026-05-06T15:11:40.078Z — manual-cmou73965001cmyouht9m6fpo -->
I encountered errors while attempting to retrieve wireless performance, quality index, and connectivity experience data due to an issue with the `viewType` parameter. I've logged this behavior for further investigation.

Next, I will focus on alternative methods to monitor inactive radios, noise floor issues, and channel congestion. Let me know if you want me to proceed with a specific diagnostic approach.

<!-- 2026-05-06T15:15:47.616Z — reply-cmou731xs0001qrtbap7jj9ip -->
No specific locations with anomalies were found in the system. I will proceed to monitor all wireless access points for inactive radios, noise floor issues, and channel congestion across all locations. Let me know if you want me to focus on a specific area or approach.

<!-- 2026-05-06T16:42:32.838Z -->
### Wireless Diagnostics Dashboard Criteria

#### Client Health Criteria
- **RSSI Threshold**: ≤ -73 dBm
- **SNR Threshold**: ≤ 20 dB
- **Slow Association**: ≥ 5 seconds
- **Slow Authentication**: ≥ 5 seconds
- **Slow DHCP**: ≥ 5 seconds
- **Slow Roams**: ≥ 3000 ms
- **Onboarding Time**: > 10 seconds

#### Device Health Criteria
- **CPU Utilization**: ≥ 90%
- **Memory Utilization**: ≥ 90%
- **PoE Issues**: ≥ 8
- **Multicast Traffic**: ≥ 75%
- **Broadcast Traffic**: ≥ 75%

#### Usage and Capacity Criteria
- **Radio Utilization**:
  - 2.4 GHz: ≥ 70%
  - 5 GHz: ≥ 70%
  - 6 GHz: ≥ 70%
- **Link Errors**:
  - 2.4 GHz: ≥ 2
  - 5 GHz: ≥ 2
  - 6 GHz: ≥ 2
- **Retries**:
  - 2.4 GHz: ≥ 25%
  - 5 GHz: ≥ 25%
  - 6 GHz: ≥ 25%
- **Packet Loss**:
  - 2.4 GHz: ≥ 5%
  - 5 GHz: ≥ 5%
  - 6 GHz: ≥ 5%
- **Interference**:
  - 2.4 GHz: ≥ 50%
  - 5 GHz: ≥ 50%
  - 6 GHz: ≥ 50%
- **Noise Floor**:
  - 2.4 GHz: > -82 dBm
  - 5 GHz: > -82 dBm
  - 6 GHz: > -82 dBm

<!-- 2026-05-06T16:42:47.453Z — manual-cmouac8rx001emyoufskd325a -->
No wireless performance issues were detected for the specified location. I will continue monitoring all access points for inactive radios, noise floor issues, and channel congestion. Let me know if you want me to focus on a specific area or approach.

<!-- 2026-05-26T15:32:13.621Z — WirelessAPMonitor — scheduled -->
No issues were detected with inactive radios, noise floor, or channel congestion across monitored wireless access points. No alerts related to these parameters were found in the system. I will continue monitoring and notify you if any anomalies arise.