# Wi-Fi Security Reference

## Security Protocol Evolution

| Protocol | Year | Encryption | Auth | Status |
|---|---|---|---|---|
| WEP | 1997 | RC4 (broken) | Shared key | **Deprecated — never use** |
| WPA | 2003 | TKIP (RC4) | PSK / 802.1X | **Deprecated — use WPA2 minimum** |
| WPA2-Personal | 2004 | AES-CCMP | PSK (passphrase) | Current standard for home/small business |
| WPA2-Enterprise | 2004 | AES-CCMP | 802.1X + RADIUS | Required for enterprise environments |
| WPA3-Personal | 2018 | AES-CCMP | SAE (Dragonfly) | Recommended for new deployments |
| WPA3-Enterprise | 2018 | AES-CCMP / GCMP-256 | 802.1X + RADIUS + PMF | Highest security; 192-bit mode optional |
| OWE (Enhanced Open) | 2018 | AES-CCMP | None (opportunistic) | Encrypted open networks (no password) |

## WPA2 vs WPA3 Key Differences

| Feature | WPA2 | WPA3 |
|---|---|---|
| Key exchange | 4-way handshake (PSK) | SAE — Simultaneous Authentication of Equals |
| Offline dictionary attacks | Vulnerable (KRACK, PMKID) | SAE protects against offline attacks |
| Forward secrecy | No | Yes (SAE) |
| PMF (Management Frame Protection) | Optional | **Mandatory** |
| Open network encryption | None | OWE |
| Transition mode | n/a | WPA3-Transition (WPA2/WPA3 mixed) — use during migration |

## 802.1X / EAP (Enterprise Authentication)

Three components:
1. **Supplicant** — client device (Windows, macOS, iOS) — presents credentials
2. **Authenticator** — wireless AP / switch — forwards EAP frames to RADIUS
3. **Authentication Server** — RADIUS server (FreeRADIUS, Cisco ISE, Microsoft NPS) — validates credentials

### EAP Methods Comparison

| EAP Type | Client Cert | Server Cert | Credential | Security | Notes |
|---|---|---|---|---|---|
| EAP-TLS | ✅ Required | ✅ Required | Certificate | **Highest** | Gold standard; requires PKI; no passwords |
| PEAP-MSCHAPv2 | ❌ | ✅ Required | Username/password | High | Most common enterprise method |
| PEAP-GTC | ❌ | ✅ Required | Token / OTP | High | Used with RSA SecurID, Duo |
| EAP-TTLS/PAP | ❌ | ✅ Required | Username/password | High | Good cross-platform support |
| EAP-FAST | ❌ | Optional | Username/password | Medium | Cisco; replaces LEAP |
| LEAP | ❌ | ❌ | Username/password | **Weak** | Cisco legacy; do not use |

**Best practice:** EAP-TLS (certificate-based) if PKI is available. PEAP-MSCHAPv2 with server certificate validation for username/password.

## Protected Management Frames (PMF / 802.11w)

- Protects management frames (Deauth, Disassoc, Action) from spoofing attacks
- **WPA3: mandatory**; WPA2: optional but strongly recommended
- **PMF modes:** Optional (mixed), Required (WPA3 only), Disabled
- Prevents deauthentication attacks used by evil-twin / rogue AP tools

## Rogue AP / Evil Twin Detection

- Rogues: unauthorised APs using legitimate SSID or broadcasting on your infrastructure
- Detection: WIDS/WIPS (Wireless Intrusion Detection/Prevention System)
- ExtremeCloud IQ: provides rogue AP detection and classification
- Indicators: BSSID not in managed inventory, SSIDs matching your networks, ARP on wrong VLAN

## MAC Address Randomisation (iOS 14+ / Android 10+)

- **Problem:** Modern clients use randomised MACs per SSID/network to prevent tracking
- **Impact:** Per-client analytics, client counts, and MAC-based access control are unreliable
- **iOS Private Wi-Fi Address:** Random MAC per SSID, rotates periodically (14-day default on iOS 16+)
- **Detection:** SNR/RSSI may show 0 for some clients; MAC OUI won't match known vendor
- **Workaround for enterprise:** 802.1X authentication identifies the user, not the MAC

## Common Attack Vectors

| Attack | Description | Mitigation |
|---|---|---|
| Deauthentication flood | Sends spoofed deauth frames to disconnect clients | PMF (802.11w) |
| Evil twin / rogue AP | Attacker sets up same SSID to capture credentials | WIPS, certificate-based auth (EAP-TLS) |
| KRACK | Key Reinstallation Attack on WPA2 4-way handshake | WPA3 or patched WPA2 |
| PMKID attack | Offline WPA2-Personal password cracking from one frame | WPA3-SAE; strong passphrases |
| MITM on open networks | Eavesdropping on unencrypted open Wi-Fi | OWE (Enhanced Open) or VPN |
| Captive portal phishing | Fake login pages on public networks | HTTPS-only, certificate transparency |

## RADIUS / AAA Notes

- **Port 1812:** RADIUS Authentication
- **Port 1813:** RADIUS Accounting
- **Shared secret:** Must be long and random (32+ chars); used to encrypt RADIUS packets
- **Timeout:** 30 seconds typical; failover to secondary RADIUS if primary unreachable
- **Certificate validation:** Clients MUST validate server certificate CN or SAN to prevent MITM
- **NAS IP:** Access point sends its management IP as NAS-IP in RADIUS requests

## VLAN Assignment via RADIUS (Dynamic VLAN)

RADIUS can return VLAN assignment per user/device using these attributes:
- `Tunnel-Type` = VLAN (13)
- `Tunnel-Medium-Type` = 802 (6)
- `Tunnel-Private-Group-ID` = VLAN ID (e.g., "100")

This enables role-based network segmentation without separate SSIDs.

## ExtremeCloud IQ Security Notes

- **Network Policy:** Configures SSID, security mode, RADIUS servers, VLAN assignments
- **CWP (Captive Web Portal):** Guest authentication via web redirect
- **PPSK (Private Pre-Shared Key):** Per-user unique PSKs — gives per-client tracking without 802.1X overhead
- **MAC-based authentication:** Fallback for devices that can't do 802.1X (IoT, printers)
