# Wi-Fi Radio Metrics Reference

## RSSI Thresholds by Use Case

RSSI (Received Signal Strength Indicator) is measured in dBm (decibel-milliwatts). Higher (less negative) is better.

| RSSI (dBm) | Rating | Supported Use Cases |
|---|---|---|
| -30 to -50 | Excellent | Maximum throughput, all MCS rates |
| -51 to -60 | Good | HD video, VoIP, business apps |
| -61 to -67 | Fair | Standard browsing, email; VoIP starts to degrade |
| -68 to -70 | Weak | Basic connectivity; frequent retries; not suitable for voice/video |
| -71 to -80 | Poor | Unreliable; intermittent drops; IoT minimum |
| Below -80 | No signal | Connection unlikely to be stable |

### Use Case Minimums
| Application | Minimum RSSI |
|---|---|
| VoIP / real-time voice | -67 dBm |
| Video streaming (HD) | -67 dBm |
| General data / browsing | -70 dBm |
| IoT / sensor data | -75 dBm |
| Location tracking (RTLS) | -75 dBm (requires 3+ APs seeing client) |

## SNR Thresholds

SNR = RSSI − Noise Floor. Measured in dB. Higher is better.

| SNR (dB) | Rating | Notes |
|---|---|---|
| 40+ | Excellent | Maximum MCS rates achievable |
| 25–40 | Good | Reliable high-throughput; VoIP suitable |
| 15–25 | Fair | Usable; lower MCS rates; some retries |
| 10–15 | Poor | Very low rates; drops likely |
| Below 10 | Unusable | Connection will fail or be extremely slow |

### SNR → Approximate MCS (802.11ac, single stream)
| SNR (dB) | Typical MCS | Notes |
|---|---|---|
| 35+ | MCS 9 | 256-QAM 5/6 |
| 28–35 | MCS 8 | 256-QAM 3/4 |
| 22–28 | MCS 7 | 64-QAM 5/6 |
| 18–22 | MCS 5–6 | 64-QAM |
| 12–18 | MCS 3–4 | 16-QAM |
| 8–12 | MCS 1–2 | QPSK |
| Below 8 | MCS 0 | BPSK — barely functional |

## Noise Floor

- **Typical indoor noise floor:** -95 to -85 dBm
- **High interference / dense environments:** -80 to -70 dBm (poor — check for interference sources)
- **Sources of noise:** Microwave ovens, Bluetooth (2.4 GHz), neighbouring Wi-Fi networks, DECT phones, baby monitors, radar (5 GHz)
- **Tool:** Spectrum analyser to identify non-Wi-Fi interference sources

## Channel Utilisation (CU)

Percentage of time the medium (channel) is busy. High CU = contention = latency + lower throughput.

| CU % | Rating | Notes |
|---|---|---|
| 0–30 % | Low | Healthy; good throughput |
| 30–50 % | Moderate | Acceptable for most use cases |
| 50–70 % | High | Throughput degrading; VoIP affected |
| 70 %+ | Very high | Significant contention; redesign required |

**Causes of high CU:** Too many clients, wide channel widths in dense areas, legacy 802.11b/g clients, hidden nodes, interference.

## Retry Rate

Frame retransmission rate — high retries indicate poor link quality.

| Retry Rate | Notes |
|---|---|
| 0–10 % | Healthy |
| 10–20 % | Moderate — investigate if combined with poor RSSI |
| 20–40 % | High — signal quality or interference issue |
| 40 %+ | Critical — connectivity will be severely impacted |

## TX Power Considerations

- **Too high:** Creates co-channel interference with neighbouring APs; clients with low TX power can hear AP but AP cannot hear client (near-far problem)
- **Too low:** Coverage holes; clients roam late / stay on far APs
- **Best practice:** TX power on APs should match client device TX power (~17–20 dBm typical)
- **EIRP:** Effective Isotropic Radiated Power = TX power + antenna gain. Regulated per country.

## Antenna Gain Reference

| Antenna Type | Gain (dBi) | Coverage pattern |
|---|---|---|
| Omni (internal) | 2–5 | 360° horizontal |
| Directional panel | 8–16 | Focused sector |
| High-gain omni | 7–12 | Narrow elevation, wide azimuth |

## Coverage Cell Sizing

Rule of thumb for enterprise Wi-Fi (802.11ac/ax, indoor):

| Band | Per-AP coverage radius | Walls |
|---|---|---|
| 2.4 GHz | ~30–50 m (open); ~15–25 m (walled office) | Penetrates well |
| 5 GHz | ~15–25 m (open); ~10–15 m (walled office) | Attenuates more |
| 6 GHz | ~10–15 m (open) | Very short range |

**Overlap:** 15–20% cell overlap recommended for seamless roaming.

## Common Interference Sources

| Source | Band | Impact |
|---|---|---|
| Microwave oven | 2.4 GHz (ch 6–11) | Intermittent high noise floor |
| Bluetooth | 2.4 GHz | Frequency hopping; modest impact |
| Neighbouring Wi-Fi | 2.4 / 5 GHz | Co-channel or adjacent channel interference |
| DFS Radar | 5 GHz (DFS channels) | Channel change event on AP |
| Baby monitors / video cams | 2.4 GHz | Can saturate 2.4 GHz band |
| ZigBee / Z-Wave | 2.4 GHz (ch 25–26) | Minor in most cases |
