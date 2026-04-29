# Wi-Fi Troubleshooting Guide

## Decision Tree — Client Can't Connect

```
Client can't connect to Wi-Fi
│
├── Does SSID appear in scan?
│   ├── NO → AP not broadcasting / client out of range / wrong band
│   │         Check: AP status in XIQ, RSSI, SSID broadcast enabled, band steering
│   └── YES → Continue...
│
├── Authentication failure?
│   ├── PSK mismatch → Wrong passphrase; check WPA2/WPA3 setting matches
│   ├── 802.1X failure → Check RADIUS reachability, certificate, EAP type, credentials
│   ├── MAC blocked → Check MAC ACL / blacklist in XIQ
│   └── Continue on success...
│
├── Gets IP address?
│   ├── NO (169.254.x.x) → DHCP failure
│   │         Check: DHCP pool exhausted, VLAN tagging, DHCP relay (ip helper-address)
│   └── YES → Continue...
│
└── Can reach gateway / internet?
    ├── Can ping gateway, can't reach internet → DNS or upstream routing issue
    ├── Can't ping gateway → Routing / VLAN / firewall issue
    └── Connected but slow → Radio quality issue (check RSSI/SNR/CU below)
```

## Decision Tree — Poor Wi-Fi Performance

```
Client connected but slow / intermittent
│
├── Check RSSI: below -70 dBm?
│   └── YES → Client too far from AP; roaming not triggering
│             Solutions: Enable 802.11k/v, reduce min RSSI threshold on AP
│
├── Check SNR: below 20 dB?
│   └── YES → Interference or noise floor issue
│             Solutions: Check for interference sources, change channel, reduce channel width
│
├── Check Channel Utilisation: above 60%?
│   └── YES → Too many clients on AP or channel contention
│             Solutions: Enable OFDMA (Wi-Fi 6), split clients across bands, add APs
│
├── Check Retry Rate: above 20%?
│   └── YES → Frames being lost/retransmitted — signal quality or interference
│             Solutions: Improve RSSI (move client or AP), fix interference
│
├── Legacy clients on same SSID?
│   └── YES → 802.11b/g clients pull everyone down (DTIM, protection mode)
│             Solutions: Disable 802.11b rates, create separate legacy SSID
│
└── Client using power-save mode?
    └── YES + VoIP issues → DTIM too high or client buffering causing audio gaps
              Solutions: Set DTIM = 1 for voice, check WMM enabled, check AC_VO queue
```

## Decision Tree — Client Keeps Dropping

```
Intermittent drops / frequent reconnects
│
├── Regular pattern (every ~20 min)?
│   └── DHCP lease timeout or Wi-Fi power management (Windows)
│             Check: DHCP lease time, disable "Allow the computer to turn off this device"
│
├── Drops when walking around?
│   └── Sticky client or missing 802.11r
│             Check: 802.11k/v/r enabled, minimum RSSI threshold on APs
│
├── Drops on DFS channel?
│   └── Radar event detected → AP changing channel (normal DFS behaviour)
│             Solutions: Avoid DFS channels for latency-sensitive clients; use non-DFS or 6 GHz
│
├── Multiple clients dropping simultaneously?
│   └── AP rebooting, firmware issue, or upstream network event
│             Check: AP uptime in XIQ, system logs, switch port status, PoE budget
│
└── Only one client dropping?
    └── Client-specific issue: driver, power save, OS config
              Check: Update drivers, disable Wi-Fi power management, check OS Wi-Fi settings
```

## Common Issues Quick Reference

| Issue | First Check | Second Check | Fix |
|---|---|---|---|
| No IP (APIPA 169.254.x.x) | DHCP pool full | DHCP relay misconfigured | Expand pool or fix helper-address |
| IP conflict | ARP table shows duplicate MAC | Static IP in DHCP range | Exclude static range from DHCP scope |
| Auth timeout (802.1X) | RADIUS server reachable? | Certificate expired? | Fix RADIUS connectivity or renew cert |
| Channel noise / interference | Noise floor > -85 dBm | Non-Wi-Fi source? | Spectrum analysis; change channel |
| AP PoE issue | Switch PoE budget exceeded | PoE class mismatch | Check switch PoE allocation; use PoE+ |
| Client stuck on old AP | RSSI < -75 dBm on current AP | 802.11v enabled? | Enable BSS Transition Request |
| VoIP choppy | SNR < 25 dB | WMM AC_VO prioritised? | Improve signal; enable QoS DSCP marking |
| Slow on 2.4 GHz | CU > 50% | 802.11b clients present? | Disable 802.11b rates; steer to 5 GHz |
| DFS radar events | APs on DFS channels | Radar source nearby? | Move APs to non-DFS channels or 6 GHz |

## Signal Thresholds Summary (Quick Reference)

| Metric | Minimum | Good | Excellent |
|---|---|---|---|
| RSSI (dBm) | -70 | -67 | -55 |
| SNR (dB) | 15 | 25 | 35+ |
| Channel Utilisation | < 50% | < 30% | < 15% |
| Retry Rate | < 20% | < 10% | < 5% |
| Noise Floor (dBm) | -85 | -90 | -95+ |

## XIQ-Specific Diagnostic Steps

1. **Check client status:** Go to Clients → find client → check RSSI, SNR, last seen, connected AP
2. **Check AP health:** Devices → select AP → check CPU, memory, connected clients, uptime
3. **Check alarms:** Alarms/Events → filter by severity; correlate time with issue
4. **Network health overview:** Dashboard → Network Summary → look for red/amber indicators
5. **Client trail:** Client detail → Connection History → shows AP-to-AP roaming events
6. **Channel plan:** Radio → RF Management → check for co-channel interference, overlapping coverage

## Useful CLI Commands (when SSH access available)

### Linux/macOS client diagnostics
```bash
# Check current Wi-Fi connection
iwconfig wlan0          # Linux: signal level, ESSID, frequency
/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I  # macOS

# DNS check
nslookup google.com
dig google.com @8.8.8.8

# Route / gateway
ip route show           # Linux
netstat -rn             # macOS

# ARP table
arp -a

# DHCP release/renew
sudo dhclient -r wlan0 && sudo dhclient wlan0  # Linux
```

### Windows client diagnostics
```cmd
netsh wlan show interfaces
netsh wlan show networks mode=bssid
ipconfig /all
ipconfig /release && ipconfig /renew
arp -a
nslookup google.com
tracert 8.8.8.8
```
