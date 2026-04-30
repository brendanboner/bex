/**
 * Domain intelligence — entity graphs and playbooks for the extremecloudiq
 * and networking domains. Called from provision.ts at startup and available
 * as a standalone CLI via scripts/seed-domain-intelligence.ts.
 */
import type { PrismaClient } from '@prisma/client';

function log(msg: string)  { console.log(`\n[DOMAIN-INTEL] ${msg}`); }
function ok(msg: string)   { console.log(`  ✓ ${msg}`); }
function info(msg: string) { console.log(`  → ${msg}`); }

interface Playbook {
  name: string;
  triggerPatterns: string[];
  content: string;
}

// ─── ExtremeCloud IQ ──────────────────────────────────────────────────────────

const EXTREMECLOUDIQ_ENTITY_GRAPH = {
  Device: {
    type: 'AP/Switch (infrastructure)',
    keyField: 'id (integer, NOT mac_address)',
    listEndpoint: 'GET /devices',
    note: 'Use numeric id for all device-specific API calls',
  },
  Client: {
    type: 'EndUser device (phone/laptop/tablet)',
    keyField: 'mac_address for lookup; numeric id for detail endpoints',
    listEndpoint: 'GET /clients/active',
    note: "Clients connect TO devices. 'Devices on AP X' usually means clients connected to that AP.",
  },
  SSID: {
    linkedTo: ['NetworkPolicy', 'UserProfile', 'VLAN'],
    resolutionChain:
      'GET /network-policies → GET /network-policies/{id}/ssids → GET /user-profiles/{up_id} → GET /network/vlan-profiles',
  },
  RadioInfo: {
    endpoint: 'GET /devices/radio-information',
    CRITICAL:
      'Requires deviceIds[] query param (integer array). MUST call GET /devices first to get numeric IDs.',
    correctTool:
      'Use xiq_radio_quality_by_ap composite tool — it handles the ID chaining automatically',
  },
  VendorDetection: {
    CRITICAL:
      'searchString does NOT filter by os_type or manufacturer. Use xiq_clients_by_vendor tool for Apple/Android/Windows vendor queries.',
    appleSignals:
      "os_type contains 'Apple iOS'/'macOS'/'iPadOS', OR hostname contains 'iPhone'/'iPad'/'MacBook', OR MAC OUI matches Apple IEEE ranges",
  },
};

const EXTREMECLOUDIQ_PLAYBOOKS: Playbook[] = [
  {
    name: 'radio-information-chaining',
    triggerPatterns: ['radio quality', 'radio parameter', 'radio information', 'signal strength', 'rssi snr', 'noise floor', 'device radio'],
    content: `## Radio Information Chaining Pattern

ALWAYS use the \`xiq_radio_quality_by_ap\` composite tool for radio quality queries. It handles the required ID chaining automatically.

If you must use the raw API:
1. Call GET /devices to get numeric integer device IDs
2. Pass those IDs as deviceIds[] to GET /devices/radio-information
3. NEVER call /devices/radio-information directly without deviceIds — it returns 400 BAD_REQUEST

The endpoint signature: GET /devices/radio-information?deviceIds=12345&deviceIds=67890 (repeat param for each ID)

Radio quality thresholds:
- SNR ≥ 25 dB → Good | 15-24 dB → Fair | < 15 dB → Poor
- RSSI ≥ -67 dBm → Good | -68 to -80 dBm → Fair | < -80 dBm → Poor`,
  },
  {
    name: 'apple-client-detection',
    triggerPatterns: ['apple client', 'apple device', 'ios device', 'iphone ipad', 'mac vendor', 'vendor filter', 'apple clients'],
    content: `## Apple Client Detection

NEVER use searchString="Apple" — it searches display names, not os_type or manufacturer.

Always use the \`xiq_clients_by_vendor\` composite tool:
  xiq_clients_by_vendor(vendor="apple")              → all Apple clients  
  xiq_clients_by_vendor(vendor="apple", apName="X")  → Apple clients on AP matching "X"

Apple detection uses 3 signals:
1. os_type contains: 'Apple iOS', 'macOS', 'Mac OS X', 'iPadOS', 'watchOS'
2. hostname contains: 'iPhone', 'iPad', 'MacBook', 'iMac', 'AirPods', 'Apple Watch'
3. MAC OUI matches known Apple IEEE-registered prefixes (handles MAC randomisation)

iOS devices with MAC randomisation may show os_type='Undetermined' — hostname is the reliable signal.`,
  },
  {
    name: 'ssid-vlan-correlation',
    triggerPatterns: ['ssid vlan', 'client vlan', 'vlan mapping', 'network policy vlan', 'ssid network policy', 'user profile vlan'],
    content: `## SSID → VLAN Correlation Chain

To find which VLAN a client is on:
1. GET /network-policies                    → list policies (get numeric IDs)
2. GET /network-policies/{id}/ssids         → SSIDs for each policy (get user_profile_id)  
3. GET /user-profiles/{up_id}              → user profile with vlan_profile and default_vlan_id
4. GET /network/vlan-profiles              → vlan name + default_vlan_id

NEVER guess VLAN IDs. Always follow this chain.
Client's SSID field matches the SSID name from step 2.`,
  },
  {
    name: 'client-troubleshooting',
    triggerPatterns: ['client disconnected', 'client not connecting', 'poor signal', 'sticky client', 'client health', 'client problem', 'wifi issue'],
    content: `## Client Troubleshooting Playbook

Step 1: xiq_client_snapshot(clientName="<name>")
  → is_currently_connected, current_connection {ap, ssid, ip, snr, rssi}, last_seen_at

Step 2: If connected with poor signal (SNR < 15 or RSSI < -80):
  → Check get_client_stats for real-time metrics
  → Check get_client_events for disconnect/auth-fail history
  → Report: RSSI, SNR, retry rate, connected AP

Step 3: If not connected:
  → get_client_events(startTime=last24h) for disconnect events
  → get_connection_trail for AP roaming history

Step 4: Root cause categories:
  - Poor RSSI/SNR → coverage hole or too far from AP
  - High retry rate → interference or congestion
  - Frequent disconnects → auth issues, band steering, IP renewal
  - Sticky client → client not roaming despite weak signal (see 802.11r/k/v config)`,
  },
  {
    name: 'scheduled-job-warning',
    triggerPatterns: ['scheduled job', 'monitoring job', 'trigger job', 'enable job', 'list jobs'],
    content: `## Scheduled Jobs Are NOT Data Sources

Scheduled jobs are automation tools for recurring tasks. NEVER use them to answer data questions.

WRONG: list_scheduled_jobs → trigger job → wait for data
RIGHT: Call the direct XIQ tool immediately

| User asks | CORRECT | WRONG |
|---|---|---|
| "Show Apple clients" | xiq_clients_by_vendor(vendor="apple") | ~~trigger monitoring job~~ |
| "Radio quality" | xiq_radio_quality_by_ap() | ~~enable radio job~~ |
| "Active clients" | list_active_clients() | ~~check job status~~ |

Only use scheduled job tools when user EXPLICITLY says "set up a scheduled job" or "automate this check".`,
  },
  {
    name: 'policy-sankey-diagram',
    triggerPatterns: ['policy ssid', 'policy flow', 'ssid ap client', 'policy client distribution'],
    content: `## Policy → SSID → AP Sankey Diagram

Use \`xiq_policy_sankey\` for policy/SSID/AP client distribution flow diagrams.

xiq_policy_sankey()
  → sankey_diagram: Mermaid sankey-beta string (Policy → SSID → AP)
  → summary: { total_clients, total_policies, total_ssids, total_aps }
  → policies: [{ name, ssid_count, ssids }]
  → flows: [{ source, target, value }]

IMPORTANT: return sankey_diagram as a plain string in JSON — NOT wrapped in markdown fences.
The dashboard renders it as a mermaid widget automatically when it sees a field named sankey_diagram.`,
  },
  {
    name: 'ap-client-sankey-diagram',
    triggerPatterns: [
      'sankey', 'flow chart', 'client flow', 'client breakdown', 'client distribution',
      'ap ssid maker', 'ap ssid vendor', 'devices ssid maker', 'device breakdown',
      'apple android', 'vendor breakdown', 'maker breakdown', 'device type', 'os breakdown',
      'who is connected', 'what devices', 'client topology',
    ],
    content: `## AP → SSID → Maker → Device Type Sankey Diagram

ALWAYS use the \`xiq_ap_client_sankey\` composite tool for Sankey diagrams showing APs, SSIDs, client makers (Apple/Android/Windows), and device types.

xiq_ap_client_sankey({ apFilter?: string })
  → sankey_diagram: Mermaid sankey-beta string (AP → SSID → Maker → Device Type)
  → flows: [{ source, target, value }]
  → summary: { total_clients, total_aps, total_ssids, maker_breakdown }

The 4-level flow shows:
  1. Access Points (APs)
  2. SSIDs connected to each AP
  3. Client maker/OS (Apple, Android, Windows, Linux, IoT/Embedded, Unknown)
  4. Device type (Phone, Tablet, Laptop, Desktop/Mac, Windows Device, Linux Device, IoT Device)

OUTPUT FORMAT for dashboard:
\`\`\`json
{
  "sankey_diagram": "sankey-beta\\n\\"AP-1\\",\\"Corp-SSID\\",12\\n\\"Corp-SSID\\",\\"Apple\\",8\\n\\"Apple\\",\\"Phone\\",6\\n...",
  "summary": { "total_clients": 38, "maker_breakdown": { "Apple": 22, "Android": 10 } },
  "flows": [...]
}
\`\`\`

IMPORTANT: return sankey_diagram as a plain string in JSON — NOT wrapped in markdown fences.
The dashboard renders it as a mermaid widget automatically when it sees a field named sankey_diagram.`,
  },
  {
    name: 'network-device-client-health',
    triggerPatterns: [
      'network health', 'device health', 'client health score', 'health score', 'network score',
      'scorecard', 'health dashboard', 'show health', 'check health', 'health status',
    ],
    content: `## Network / Device / Client Health Scorecards

ALWAYS use the composite health tools — NEVER call raw scorecard endpoints with guessed IDs.

Tools:
  xiq_network_health({ locationName?: string, locationId?: number })   → overall network health score
  xiq_device_health({ locationName?: string, locationId?: number })    → device health at a location
  xiq_client_health_score({ locationName?: string, locationId?: number }) → client health score

These tools:
1. Use the locationName you provide (or "Beverly" from agent facts if default_xiq_location is set)
2. Auto-resolve the name to a real integer locationId via the XIQ locations API
3. Fall back to the first root location if no name is available

IMPORTANT: If the user has previously said "my default XIQ location is X", that was saved as
the fact default_xiq_location. Pass it as locationName.

Example: xiq_network_health(locationName="Beverly")`,
  },
  {
    name: 'client-radio-quality-named',
    triggerPatterns: [
      'radio quality of', 'radio stats for', 'signal of', 'snr rssi for', 'radio parameters for',
      'radio quality fridge', 'radio quality ipad', 'radio of the', 'signal strength of',
    ],
    content: `## Radio Quality for a Named Client

When the user asks for radio quality of a specific named client device ("fridge", "iPad", "MacBook"):

ALWAYS use: xiq_client_radio_quality({ hostname: "fridge" })

This composite:
1. Searches /clients/active for a client whose hostname matches the name fragment
2. Gets their connected AP name
3. Resolves the AP to its device integer ID via /devices
4. Calls /devices/radio-information for that AP
5. Returns: client signal data (SNR/RSSI from client record) + AP radio stats (channel/power/noise)

Do NOT use xiq_radio_quality_by_ap for named client queries — it searches APs, not clients.`,
  },
  {
    name: 'client-connection-history',
    triggerPatterns: [
      'radio history', 'connection history', 'roaming history', 'connection trail',
      'show history of', 'history of the ipad', 'history of the fridge', 'last connected',
      'where has', 'client trail', 'roaming trail', 'connection log',
    ],
    content: `## Client Connection / Roaming History

When the user asks for connection history or radio history of a named client:

ALWAYS use: xiq_client_connection_history({ hostname: "ipad", hours: 4 })

This composite:
1. Finds the client by hostname fragment (or uses mac if provided from conversation context)
2. Calls connection_trail to get AP-to-AP roaming events with timestamps
3. Calls roaming_trail for detailed per-roam metrics
4. Returns combined history for the requested time window (default: last 4 hours)

If you already know the MAC from a previous turn in the conversation, pass it directly:
  xiq_client_connection_history({ mac: "22D8103E2A2E", hours: 4 })`,
  },
];

// ─── Networking (XCO) ─────────────────────────────────────────────────────────

const NETWORKING_ENTITY_GRAPH = {
  API_BASE: '/v1 (CRITICAL: never /rest/v1 — use /v1 for all XCO endpoints)',
  Fabric: {
    listEndpoint: 'GET /v1/fabric/fabrics',
    detailEndpoint: 'GET /v1/fabric/fabric?name={name}',
    healthEndpoint: 'GET /v1/fabric/fabrics-health',
    errorsEndpoint: 'GET /v1/fabric/fabrics/errors',
  },
  Switch: {
    listEndpoint: 'GET /v1/inventory/switches',
    configEndpoint: 'GET /v1/inventory/switchconfig/setting?ip={ip}',
  },
  Alarm: {
    summaryEndpoint: 'GET /v1/faultmanager/alarm/summary',
    listEndpoint: 'GET /v1/faultmanager/alarm/inventory',
    historyEndpoint: 'GET /v1/faultmanager/alarm/history',
    ackEndpoint: 'PUT /v1/faultmanager/alarm/acknowledge',
  },
  Alert: { listEndpoint: 'GET /v1/faultmanager/alert/inventory' },
};

const NETWORKING_PLAYBOOKS: Playbook[] = [
  {
    name: 'fabric-health-check',
    triggerPatterns: ['fabric health', 'fabric status', 'fabric errors', 'spine leaf', 'clos topology', 'fabric validation'],
    content: `## XCO Fabric Health Check Playbook

Standard sequence:
1. xco_get_inventory           → list switches and their roles (spine/leaf)
2. xco_get_fabrics             → all fabrics with status + device counts
3. xco_get_fabric_health       → health status per fabric
4. xco_get_fabric_errors       → configuration errors (missing links, mismatches)
5. xco_validate_fabric         → CLOS topology validation (use for "drift" queries)

Report format:
- Overall: N fabrics, M healthy / P with issues
- Per-fabric: name, device count, health status, error count
- Top errors: list by severity`,
  },
  {
    name: 'alarm-triage',
    triggerPatterns: ['critical alarm', 'alarm count', 'alarm summary', 'active alarm', 'alarm triage', 'fault management'],
    content: `## XCO Alarm Triage Playbook

Step 1: xco_get_alarm_summary  → counts by severity (Critical/Major/Minor/Warning/Info)
Step 2: xco_get_alarm_inventory → list of currently ACTIVE alarms (uncleared)
Step 3: xco_get_alarm_history   → historical record (use for trend analysis)

Severity thresholds:
- Critical: immediate escalation | Major: auto-remediate or escalate
- Minor: log + next report | Warning: note in summary only

Always report: total active count, critical count, top 3 most recent critical alarms.`,
  },
  {
    name: 'bgp-troubleshooting',
    triggerPatterns: ['bgp session', 'bgp peer', 'routing issue', 'underlay problem', 'bgp down'],
    content: `## BGP Session Troubleshooting

Step 1: xco_get_bgp_sessions   → list all BGP peers and their state (ESTABLISHED/IDLE/ACTIVE)
Step 2: For DOWN peers:
  → xco_get_interface_status   → check port state (UP/DOWN) for the peer interface
  → xco_get_lldp_neighbors     → verify physical connectivity
  → xco_get_alarm_inventory    → check for related alarms

Step 3: Correlate:
  - Interface DOWN + BGP DOWN → physical/optic issue
  - Interface UP + BGP DOWN  → config/auth mismatch or MTU issue
  - BGP IDLE               → local routing config issue

XCO API note: GET /v1/monitor/bgp — returns peer list with state field.`,
  },
  {
    name: 'topology-mermaid-diagram',
    triggerPatterns: ['topology diagram', 'network diagram', 'topology overview', 'fabric topology', 'spine leaf diagram', 'network map', 'fabric map'],
    content: `## XCO Topology Mermaid Diagram

ALWAYS use the \`xco_topology_mermaid\` composite tool for topology diagram requests.

xco_topology_mermaid()
  → topology_diagram: Mermaid "graph LR" string (spines, leaves, LLDP edges, health colour)
  → summary: { total_switches, total_fabrics, lldp_links, spines, leaves }
  → switches: [{ name, ip, fabric, role, state, model }]
  → fabrics: [{ name, status, type, stage }]

Node colours: green = cfg in-sync | amber = cfg drift | red = error/unreachable

OUTPUT FORMAT for dashboard:
\`\`\`json
{
  "topology_diagram": "graph LR\\n  subgraph PROD-DC1[...]...",
  "summary": { "total_switches": 6, "spines": 2, "leaves": 4 },
  "switches": [...],
  "fabrics": [...]
}
\`\`\`

IMPORTANT: return topology_diagram as a plain string in JSON — NOT wrapped in markdown fences.
The dashboard renders it as a mermaid widget automatically.`,
  },
];

// ─── Core seeding function ────────────────────────────────────────────────────

function mergePlaybooks(existing: Playbook[], incoming: Playbook[]): Playbook[] {
  const map = new Map<string, Playbook>(existing.map((p) => [p.name, p]));
  for (const p of incoming) map.set(p.name, p);
  return Array.from(map.values());
}

export async function seedDomainIntelligence(prisma: PrismaClient): Promise<void> {
  const domains = [
    { domain: 'extremecloudiq', entityGraph: EXTREMECLOUDIQ_ENTITY_GRAPH, playbooks: EXTREMECLOUDIQ_PLAYBOOKS },
    { domain: 'networking',     entityGraph: NETWORKING_ENTITY_GRAPH,     playbooks: NETWORKING_PLAYBOOKS },
  ];

  for (const { domain, entityGraph, playbooks } of domains) {
    log(`Processing domain: ${domain}`);

    const existing = await prisma.domainKnowledge.findUnique({ where: { domain } });
    const existingPlaybooks: Playbook[] = existing ? (existing.playbooks as unknown as Playbook[]) : [];
    const mergedPlaybooks = mergePlaybooks(existingPlaybooks, playbooks);
    const newCount = playbooks.filter((p) => !existingPlaybooks.some((e) => e.name === p.name)).length;

    await prisma.domainKnowledge.upsert({
      where: { domain },
      create: { domain, entityGraph, playbooks: mergedPlaybooks as unknown as object[] },
      update: { entityGraph, playbooks: mergedPlaybooks as unknown as object[] },
    });

    existing
      ? info(`Updated — ${newCount} new, ${playbooks.length - newCount} refreshed`)
      : ok(`Created — entity graph + ${playbooks.length} playbook(s)`);
  }

  log('Domain intelligence seeding complete.');
}
