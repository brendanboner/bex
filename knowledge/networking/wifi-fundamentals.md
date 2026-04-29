# Wi-Fi Fundamentals Reference

## 802.11 Standard Evolution

| Standard | Band(s) | Max PHY Rate | Notes |
|---|---|---|---|
| 802.11b | 2.4 GHz | 11 Mbps | DSSS; legacy, avoid |
| 802.11a | 5 GHz | 54 Mbps | OFDM; superseded |
| 802.11g | 2.4 GHz | 54 Mbps | OFDM; superseded |
| 802.11n (Wi-Fi 4) | 2.4 / 5 GHz | 600 Mbps | MIMO, 40 MHz channels |
| 802.11ac (Wi-Fi 5) | 5 GHz | 3.5 Gbps | MU-MIMO, 80/160 MHz, beamforming |
| 802.11ax (Wi-Fi 6/6E) | 2.4 / 5 / 6 GHz | 9.6 Gbps | OFDMA, BSS Coloring, TWT, MU-MIMO UL+DL |
| 802.11be (Wi-Fi 7) | 2.4 / 5 / 6 GHz | 46 Gbps | Multi-Link Operation (MLO), 320 MHz channels, 4K QAM |

## Frequency Bands

### 2.4 GHz
- **Range:** 2.400–2.4835 GHz
- **Non-overlapping channels (20 MHz):** 1, 6, 11 (US); 1, 5, 9, 13 (EU)
- **Pros:** Long range, penetrates walls well
- **Cons:** Crowded (microwaves, Bluetooth, baby monitors), only 3 non-overlapping channels
- **Typical use:** IoT devices, legacy clients, background monitoring

### 5 GHz
- **Range:** 5.150–5.850 GHz
- **Non-overlapping channels (20 MHz):** Up to 25 (US), varies by region
- **DFS channels (U-NII-2A/C):** 52–144 — radar detection required; avoid for sticky clients
- **Channel widths:** 20 / 40 / 80 / 80+80 / 160 MHz
- **Pros:** Less congestion, higher throughput
- **Cons:** Shorter range, DFS radar events cause channel changes

### 6 GHz (Wi-Fi 6E / Wi-Fi 7)
- **Range:** 5.925–7.125 GHz (US; region-dependent)
- **Non-overlapping 80 MHz channels:** 7 (US)
- **Non-overlapping 160 MHz channels:** 3 (US)
- **Pros:** No DFS, no legacy interference, clean spectrum
- **Cons:** Very short range, requires Wi-Fi 6E client

## Key Terminology

| Term | Definition |
|---|---|
| SSID | Service Set Identifier — the human-readable network name broadcast by APs |
| BSSID | Basic Service Set ID — the MAC address of an individual radio/AP; unique per radio |
| BSS | Basic Service Set — single AP + its associated clients |
| ESS | Extended Service Set — multiple APs sharing the same SSID forming one logical network |
| IBSS | Independent BSS — ad-hoc (peer-to-peer) network, no AP |
| Beacon | Management frame broadcast by AP every 100ms (default); announces SSID, capabilities |
| DTIM | Delivery Traffic Indication Map — tells power-save clients when buffered frames are waiting |
| RSSI | Received Signal Strength Indicator — measured signal power at receiver (dBm) |
| SNR | Signal-to-Noise Ratio — signal above noise floor (dB); higher = better |
| MCS | Modulation and Coding Scheme — index combining modulation type + coding rate → throughput |
| OFDM | Orthogonal Frequency Division Multiplexing — used by 802.11a/g/n/ac/ax |
| OFDMA | OFDM Access — Wi-Fi 6 extension; subdivides channel into Resource Units for multiple clients simultaneously |
| MU-MIMO | Multi-User MIMO — simultaneous transmission to multiple clients on different spatial streams |
| Spatial Streams | Independent radio paths via multiple antennas; more streams = more throughput |
| Beamforming | Focusing radio energy toward a specific client to improve signal quality |
| Band Steering | AP-side feature pushing dual-band clients to prefer 5 GHz over 2.4 GHz |
| BSS Coloring | 802.11ax feature to reduce co-channel interference by tagging frames by BSS |
| TWT | Target Wake Time — 802.11ax; devices negotiate wake schedule to save battery |

## MCS Rate Quick Reference (802.11ac, 80 MHz, 1 spatial stream)

| MCS Index | Modulation | Coding | Rate (Mbps) | Typical Min RSSI |
|---|---|---|---|---|
| MCS 0 | BPSK | 1/2 | 29 | -82 dBm |
| MCS 1 | QPSK | 1/2 | 58 | -79 dBm |
| MCS 2 | QPSK | 3/4 | 87 | -77 dBm |
| MCS 3 | 16-QAM | 1/2 | 117 | -74 dBm |
| MCS 4 | 16-QAM | 3/4 | 175 | -70 dBm |
| MCS 5 | 64-QAM | 2/3 | 234 | -66 dBm |
| MCS 6 | 64-QAM | 3/4 | 263 | -65 dBm |
| MCS 7 | 64-QAM | 5/6 | 293 | -64 dBm |
| MCS 8 | 256-QAM | 3/4 | 351 | -59 dBm |
| MCS 9 | 256-QAM | 5/6 | 390 | -57 dBm |

*Multiply by spatial stream count; actual throughput is ~50–60% of PHY rate at application layer.*

## Frame Types

| Type | Subtypes (examples) | Purpose |
|---|---|---|
| Management | Beacon, Probe, Auth, Assoc, Deauth, Disassoc, Action | Network discovery, connection lifecycle |
| Control | RTS, CTS, ACK, BAck | Medium access, reliability |
| Data | Data, Null, QoS Data | Payload delivery |

## Channel Width Trade-offs

| Width | Max throughput | Interference risk | Use case |
|---|---|---|---|
| 20 MHz | Low | Low | Dense deployments, 2.4 GHz always |
| 40 MHz | Moderate | Moderate | Low-density 5 GHz |
| 80 MHz | High | Moderate | Standard enterprise 5 GHz |
| 160 MHz | Very high | High | Low-density, high-demand, 6 GHz |

**Rule of thumb:** Wider channels = higher peak rate but more interference. In dense environments, narrower channels with more spatial reuse outperform wide channels.
