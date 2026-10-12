# Wi-Fi Roaming Reference

## Who Decides When to Roam?

**The CLIENT device decides when to roam — not the AP.** This is the most common misconception in Wi-Fi.

- APs can *suggest* (802.11v BSS Transition Management Request) but cannot force a client to move
- Clients roam based on their own internal signal thresholds (varies by OS, driver, power mode)
- Poor roaming = clients holding onto a distant AP despite a closer one being available ("sticky client")

## Roaming Trigger Thresholds (typical client defaults)

| OS / Device | Roaming trigger RSSI | Notes |
|---|---|---|
| Windows (default) | -70 dBm | Configurable via adapter properties |
| macOS | -65 to -70 dBm | Less aggressive than Windows |
| iOS | -65 to -75 dBm | Aggressive; uses 802.11k/v when available |
| Android | Varies by OEM | -65 to -80 dBm range |
| VoIP handsets | -65 dBm | Configured per device; critical for voice quality |

**Recommendation:** Configure 802.11k+v on all enterprise networks; aim for cell overlap at -65 to -67 dBm.

## 802.11r — Fast BSS Transition (FT)

- **Purpose:** Reduce roaming handoff time from ~200–500 ms to <50 ms
- **How it works:** Pre-authenticates client to target AP while still connected to current AP (over-the-DS or over-the-air FT)
- **Benefit:** Critical for VoIP and real-time video; eliminates authentication delay during roam
- **Caveat:** Some older clients have bugs with 802.11r; maintain FT + non-FT SSIDs if compatibility issues arise
- **ExtremeCloud IQ:** Enable FT in Network Policy → SSID → Fast Roaming

## 802.11k — Radio Resource Management (Neighbor Reports)

- **Purpose:** AP tells client about neighbouring APs and their channels/BSSIDs
- **How it works:** Client sends Neighbor Report Request; AP responds with list of nearby APs
- **Benefit:** Client builds a candidate list before signal degrades; faster, smarter roaming decisions
- **No guarantee:** Client still decides whether to use the information
- **ExtremeCloud IQ:** Enabled by default on 802.11ax APs

## 802.11v — BSS Transition Management

- **Purpose:** AP can request (not force) a client to roam to a better AP
- **How it works:** AP sends BSS Transition Management Request with a candidate AP list
- **Triggers:** AP overloaded (too many clients), client RSSI too low, load balancing
- **Client compliance:** Modern iOS/Android/Windows support it; older devices may ignore it
- **ExtremeCloud IQ:** "Client Load Balancing" and "Band Steering" use 802.11v

## Sticky Client Problem

**Symptom:** Client stays connected to far AP with RSSI < -75 dBm while a closer AP at -55 dBm exists.

**Root causes:**
- Client roaming threshold set too low
- Client power-saving mode reduces scanning
- 802.11k/v not enabled

**Solutions (AP-side):**
1. Enable 802.11k + 802.11v (BSS Transition Request)
2. Set minimum RSSI threshold on AP (reject re-association below e.g., -75 dBm) — forces client to seek another AP
3. Configure "aggressive client load balancing" in XIQ

**Solutions (client-side):**
- Adjust roaming aggressiveness in OS/driver settings
- Disable power-saving mode on Wi-Fi adapter for performance-critical devices

## Roaming Latency Breakdown

| Phase | Without 802.11r | With 802.11r (FT) |
|---|---|---|
| Scanning (passive + active) | 50–150 ms | 50–150 ms |
| Authentication | 50–100 ms | ~1 ms (pre-auth) |
| Re-association | 20–50 ms | ~5 ms |
| DHCP renewal | 100–2000 ms | 0 ms (IP kept) |
| **Total** | **200–2300 ms** | **~50–160 ms** |

**Note:** DHCP is the biggest contributor when clients request a new IP on roam. Use short DHCP lease / DHCP caching to mitigate.

## Band Steering (2.4 vs 5 GHz)

- Dual-band clients are pushed to 5 GHz (higher throughput, less congestion)
- Mechanism: AP temporarily ignores 2.4 GHz probe requests to "steer" client to 5 GHz
- **Risk:** If 5 GHz signal is weak, client may fail to connect; implement RSSI threshold for steering
- **ExtremeCloud IQ:** Band Steering configured in Radio Profile; minimum RSSI threshold recommended

## Minimum RSSI (Aggressive Roaming)

Setting a minimum RSSI threshold on APs causes them to reject clients below the threshold:
- Recommended threshold: **-75 to -80 dBm** (below this the link is unusable anyway)
- Client is forced to re-associate to a stronger AP
- Do NOT set too high (e.g., -65 dBm) — may briefly disconnect clients in border areas

## ExtremeCloud IQ Roaming Notes

- Roaming is intra-controller (same XIQ region) — seamless
- Clients roaming between XIQ-managed APs retain VLAN/policy
- **Client Trail** (`/client-details/topology/client-trail`) — shows AP-to-AP movement history per client
- Check "last seen" timestamp in `/clients/active` to determine if client has moved recently
