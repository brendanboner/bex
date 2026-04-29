# IP Networking Reference

## IPv4 Addressing

### CIDR Notation
`<network address>/<prefix length>` e.g., `192.168.1.0/24`

| Prefix | Hosts | Subnet Mask | Common Use |
|---|---|---|---|
| /8 | 16,777,214 | 255.0.0.0 | Large enterprise / ISP |
| /16 | 65,534 | 255.255.0.0 | Campus / large site |
| /24 | 254 | 255.255.255.0 | Standard LAN / VLAN |
| /25 | 126 | 255.255.255.128 | Medium subnet |
| /26 | 62 | 255.255.255.192 | Small subnet |
| /27 | 30 | 255.255.255.224 | Tiny subnet / point-to-point |
| /30 | 2 | 255.255.255.252 | Point-to-point links |
| /32 | 1 | 255.255.255.255 | Host route / loopback |

### RFC 1918 Private Ranges
| Range | CIDR | Available addresses |
|---|---|---|
| 10.0.0.0 – 10.255.255.255 | 10.0.0.0/8 | ~16.7 million |
| 172.16.0.0 – 172.31.255.255 | 172.16.0.0/12 | ~1 million |
| 192.168.0.0 – 192.168.255.255 | 192.168.0.0/16 | ~65,000 |

### Special Addresses
| Address | Purpose |
|---|---|
| 169.254.0.0/16 | APIPA — auto-assigned when DHCP fails; indicates DHCP problem |
| 127.0.0.0/8 | Loopback (localhost = 127.0.0.1) |
| 255.255.255.255 | Limited broadcast (LAN only) |
| 224.0.0.0/4 | Multicast |

## DHCP (Dynamic Host Configuration Protocol)

### DORA Process
1. **Discover** — Client broadcasts to 255.255.255.255 looking for DHCP server
2. **Offer** — Server responds with proposed IP, subnet, gateway, DNS, lease time
3. **Request** — Client broadcasts acceptance of the offer
4. **Acknowledge** — Server confirms lease

### Key DHCP Options
| Option | Number | Purpose |
|---|---|---|
| Subnet Mask | 1 | Network mask |
| Router | 3 | Default gateway |
| DNS | 6 | DNS server(s) |
| Hostname | 12 | Client hostname hint |
| Domain Name | 15 | DNS search domain |
| Lease Time | 51 | IP lease duration |
| DHCP Server | 54 | Server identification |
| TFTP Server | 66 | PXE boot server |

### Common DHCP Issues
| Symptom | Cause | Fix |
|---|---|---|
| 169.254.x.x address | DHCP server unreachable or pool exhausted | Check server, check pool size, check VLAN routing |
| IP conflict | Duplicate static + DHCP overlap, or DHCP cache stale | Exclude static IP range from DHCP scope; clear ARP/DHCP cache |
| Slow DHCP | Large broadcast domain, DHCP snooping misconfigured | Check relay agent (ip helper-address), check snooping trusted ports |
| DHCP not working after VLAN change | DHCP relay not configured on new VLAN interface | Add `ip helper-address <dhcp-server>` to SVI |

## DNS (Domain Name System)

- **Port 53 UDP** (queries) / **Port 53 TCP** (zone transfers, large responses)
- **A record:** hostname → IPv4
- **AAAA record:** hostname → IPv6
- **PTR record:** IP → hostname (reverse DNS)
- **CNAME:** alias → canonical name
- **MX record:** mail server for domain

### Common DNS issues
| Symptom | Cause |
|---|---|
| "Can't resolve hostname" with ping IP working | DNS server unreachable or misconfigured |
| Slow first connection | DNS TTL expired; lookup in progress |
| Different results from different clients | Split DNS or DNS caching inconsistency |

## VLANs (802.1Q)

- **VLAN:** Virtual LAN — logical segmentation of a physical network
- **802.1Q Tag:** 4-byte header inserted into Ethernet frame; contains VLAN ID (1–4094)
- **Access port:** Carries traffic for one VLAN; tag is stripped by switch
- **Trunk port:** Carries multiple VLANs; tags preserved between switches
- **Native VLAN:** Untagged VLAN on a trunk port (default VLAN 1; change this for security)

### Common VLAN Design
| VLAN | Use |
|---|---|
| 1 | Default (avoid for data traffic; leave unused) |
| 10–19 | Management (switches, APs, servers) |
| 20–29 | Corporate Wi-Fi clients |
| 30–39 | Guest Wi-Fi |
| 40–49 | IoT devices |
| 50–59 | Voice / VoIP |
| 100+ | Server / DMZ segments |

## ARP (Address Resolution Protocol)

- Resolves IPv4 address → MAC address on local segment
- **ARP Request:** Broadcast — "Who has 192.168.1.1? Tell 192.168.1.10"
- **ARP Reply:** Unicast — "192.168.1.1 is at aa:bb:cc:dd:ee:ff"
- **ARP cache timeout:** Typically 4 hours (OS-dependent)
- **Gratuitous ARP:** Device announces its own IP/MAC — updates neighbours' caches; used on failover
- **GARP attack:** Attacker sends gratuitous ARP to poison caches → MITM

## QoS / WMM (Wireless Multimedia)

Wi-Fi QoS is implemented via **WMM (Wi-Fi Multimedia)** — maps to 4 Access Categories:

| WMM AC | Priority | DSCP / 802.1p | Traffic Type |
|---|---|---|---|
| AC_VO (Voice) | Highest | DSCP 46 / CS7 | VoIP, real-time |
| AC_VI (Video) | High | DSCP 34 / CS5 | Video streaming |
| AC_BE (Best Effort) | Normal | DSCP 0 / CS0 | General data |
| AC_BK (Background) | Low | DSCP 8 / CS1 | Bulk transfers, backups |

**WMM is mandatory for WPA2/WPA3 certification.** Voice and video traffic should be DSCP-marked at the source.

## IPv6 Quick Reference

| Prefix | Use |
|---|---|
| ::1/128 | Loopback |
| fe80::/10 | Link-local (not routable) |
| fc00::/7 | Unique local (RFC 4193 — like RFC 1918) |
| 2000::/3 | Global unicast (routable) |
| ff00::/8 | Multicast |

- **SLAAC:** Stateless Address Autoconfiguration — client generates its own IPv6 from prefix + EUI-64 or random
- **DHCPv6:** Dynamic IPv6 assignment (stateful) or prefix delegation
- **NDP:** Neighbour Discovery Protocol — replaces ARP for IPv6

## Routing Basics

- **Default gateway:** Next-hop router for non-local traffic (0.0.0.0/0)
- **Subnet routing:** Packets destined for the same /24 go directly; others go to gateway
- **Static routes:** Manually configured; no overhead; no automatic failover
- **Dynamic routing:** OSPF, BGP, EIGRP — automatic topology discovery and failover
- **ECMP:** Equal-Cost Multi-Path — traffic load-balanced across multiple equal-cost paths
