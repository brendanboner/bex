import { PrismaClient } from '@prisma/client';

// Shared Prisma seed for development / CI
const prisma = new PrismaClient();

async function main(): Promise<void> {
  // System user
  const systemUser = await prisma.user.upsert({
    where: { externalId: 'system' },
    update: {},
    create: {
      externalId: 'system',
      displayName: 'System',
      email: 'system@bex.internal',
      isSystemUser: true,
    },
  });

  console.info('Seeded system user:', systemUser.id);

  // Default "Forge Assistant" agent — handles general requests, uses all published skills
  const defaultAgent = await prisma.agent.upsert({
    where: { id: 'default-agent' },
    update: {
      name: 'Forge Assistant',
      description: 'The system default agent. Handles general requests and automatically uses all available published skills.',
      status: 'ACTIVE',
      isDefault: true,
    },
    create: {
      id: 'default-agent',
      name: 'Forge Assistant',
      description: 'The system default agent. Handles general requests and automatically uses all available published skills.',
      status: 'ACTIVE',
      isDefault: true,
      llmProvider: process.env['LLM_PROVIDER'] ?? 'openai',
      llmModel: process.env['LLM_MODEL'] ?? 'gpt-4o',
      ownerId: systemUser.id,
      persona: {
        name: 'Forge Assistant',
        tone: 'helpful and concise',
        role: 'General-purpose AI assistant with access to all skills on this Forge instance.',
      },
      permissions: ['read:all', 'schedule:jobs'],
    },
  });

  console.info('Seeded default agent:', defaultAgent.id);

  // Example endpoint (Extreme Networks XCO)
  const xcoEndpoint = await prisma.endpoint.upsert({
    where: { name: 'extreme-xco-primary' },
    update: {},
    create: {
      name: 'extreme-xco-primary',
      description: 'Extreme Networks XCO Controller (primary)',
      baseUrl: 'https://xco.example.com',
      tags: ['networking', 'extreme-xco', 'primary'],
      notes: '## Extreme XCO\nSee docs/extreme-xco.md for API details.',
    },
  });

  console.info('Seeded endpoint:', xcoEndpoint.id);

  // ── Domain Intelligence Layer: XIQ + XCO domain knowledge ───────────────────

  const xiqEntityGraph = {
    entities: {
      Client: {
        idField: 'mac_address',
        links: { AP: 'ap_id', Location: 'location_id' },
        notes: 'Use list_active_clients to get currently connected clients',
      },
      AP: {
        idField: 'id',
        links: { Location: 'location_id' },
        notes: 'APs are infrastructure devices retrieved via list_devices',
      },
      Location: {
        idField: 'id',
        links: { parent: 'parent_location_id' },
        notes: 'Resolve location name to id via list_locations (case-insensitive match)',
      },
      VLAN: {
        idField: 'id',
        links: { Policy: 'policy_id' },
        notes: 'VLAN membership is inferred from client SSID → network policy → VLAN assignment',
      },
    },
    computations: {
      inferSubnet:
        'Group client IPs by first 3 octets. If all match → /24. Otherwise compute min and max IP as integers, find the smallest power-of-2 range covering both, express as CIDR.',
      resolveLocation:
        'Call list_locations, compare query location name (lowercase, strip whitespace) against each result name. Return first match id.',
      latestTelemetry:
        'Call get_client_chart_data per client, sort records by timestamp descending, return first record for RSSI and SNR values.',
    },
  };

  const xiqPlaybooks = [
    {
      name: 'radio-quality-by-location',
      description: 'Get current RSSI/SNR quality for all wireless clients in a named location',
      triggerPatterns: ['radio quality', 'rssi', 'snr', 'signal strength', 'wireless quality', 'in location'],
      steps: [
        { step: 1, tool: 'list_locations', purpose: 'Resolve location name to id', extractField: 'results[].id (match name case-insensitively)' },
        { step: 2, tool: 'list_devices', params: { location_id: '{step1.id}' }, purpose: 'Get all APs in location', extractField: 'results[].id, results[].device_name' },
        { step: 3, tool: 'list_active_clients', purpose: 'Get connected clients (filter by AP if possible)', extractField: 'results[].mac_address, results[].ip_address, results[].connected_ap_name' },
        { step: 4, tool: 'get_client_chart_data', params: { client_mac: '{step3[].mac_address}' }, foreach: true, purpose: 'Get telemetry per client', extractField: 'Sort by timestamp desc, take first record' },
        { step: 5, compute: 'Sort by timestamp desc, select most recent RSSI/SNR per client', output: 'Flat table: client_mac | ip_address | ap_name | rssi | snr | timestamp' },
      ],
    },
    {
      name: 'vlan-ip-range-mapping',
      description: 'Infer VLAN → subnet mapping from currently connected wireless clients',
      triggerPatterns: ['vlan', 'ip range', 'subnet', 'address range', 'wireless network', 'ip address range'],
      steps: [
        { step: 1, tool: 'list_active_clients', purpose: 'Get all clients with IP, SSID, MAC', extractField: 'results[].mac_address, results[].ip_address, results[].ssid, results[].user_profile_name' },
        { step: 2, tool: 'list_network_policies', purpose: 'Get policies to map SSID → VLAN', extractField: 'results[].name, results[].vlan_id' },
        { step: 3, compute: 'Join clients to policies via SSID name match. Group clients by VLAN. For each group: if all IPs share first 3 octets → /24; else compute min/max IP as integers, find smallest /N covering range.', output: 'Table: vlan_id | inferred_subnet | client_count | sample_ips' },
      ],
    },
    {
      name: 'client-health-overview',
      description: 'Summary of connected client count, usage, and anomaly status',
      triggerPatterns: ['client health', 'client count', 'connected clients', 'network usage', 'client summary'],
      steps: [
        { step: 1, tool: 'get_client_summary', purpose: 'Get total counts and session stats' },
        { step: 2, tool: 'list_active_clients', purpose: 'Get breakdown of connected clients', extractField: 'total count, group by ssid' },
        { step: 3, compute: 'Group by SSID, count per group, show top 5 SSIDs by client count.', output: 'Summary: total_clients | top_ssids with counts | usage_stats' },
      ],
    },
    {
      name: 'new-device-detection',
      description: 'Compare current connected clients against a known baseline and report new arrivals',
      triggerPatterns: ['new device', 'new client', 'unknown device', 'device appeared', 'device joined'],
      steps: [
        { step: 1, tool: 'list_active_clients', purpose: 'Get current client list', extractField: 'results[].mac_address, results[].hostname, results[].ip_address, results[].connected_ap_name' },
        { step: 2, compute: 'Compare against ## Known Clients section in memory. Identify MAC addresses not previously seen.', output: 'List of new clients: mac | hostname | ip | ap_name. Output [NO_CHANGE] if none new.' },
      ],
    },
  ];

  const xiqKnowledge = await prisma.domainKnowledge.upsert({
    where: { domain: 'extremecloudiq' },
    update: {
      entityGraph: xiqEntityGraph,
      playbooks: xiqPlaybooks,
    },
    create: {
      domain: 'extremecloudiq',
      docIndex: [
        { url: 'https://api.extremecloudiq.com/swagger-ui/index.html', title: 'ExtremeCloud IQ API Reference', type: 'api_guide', description: 'Swagger UI for XIQ REST API', discoveredAt: new Date().toISOString() },
        { url: 'https://supportdocs.extremenetworks.com/support/documentation/extremecloudiq/', title: 'ExtremeCloud IQ Documentation Hub', type: 'user_guide', description: 'Product documentation index', discoveredAt: new Date().toISOString() },
      ],
      entityGraph: xiqEntityGraph,
      playbooks: xiqPlaybooks,
    },
  });

  console.info('Seeded XIQ domain knowledge:', xiqKnowledge.domain);

  const xcoEntityGraph = {
    entities: {
      Device: {
        idField: 'id',
        links: { Site: 'site_id', Fabric: 'fabric_id' },
        notes: 'Network devices managed by XCO',
      },
      Fabric: {
        idField: 'id',
        links: { Site: 'site_id' },
        notes: 'Fabric represents an EVPN/VXLAN network fabric',
      },
      Site: {
        idField: 'id',
        links: {},
        notes: 'Physical or logical grouping of devices',
      },
      Port: {
        idField: 'id',
        links: { Device: 'device_id' },
        notes: 'Physical or logical port on a device',
      },
    },
    computations: {
      fabricHealthScore: 'Check each device status in fabric. Score = (healthy_count / total) * 100. Flag any device with status != CONNECTED or alarm_count > 0.',
      reachabilityCheck: 'Ping device management IP via XCO proxy. Compare response time against baseline. Flag if timeout or RTT > 2x baseline.',
    },
  };

  const xcoPlaybooks = [
    {
      name: 'fabric-health-check',
      description: 'Check overall fabric health — devices, connectivity, and alarms',
      triggerPatterns: ['fabric health', 'fabric status', 'network health', 'fabric check', 'fabric alarm'],
      steps: [
        { step: 1, tool: 'list_fabrics', purpose: 'Get all fabrics', extractField: 'results[].id, results[].name' },
        { step: 2, tool: 'list_fabric_devices', params: { fabric_id: '{step1[].id}' }, foreach: true, purpose: 'Get devices per fabric' },
        { step: 3, compute: 'Count total devices, count CONNECTED vs not-CONNECTED. Sum alarms. Compute health score.', output: 'Table: fabric_name | device_count | healthy | unhealthy | alarm_count | health_score%' },
      ],
    },
    {
      name: 'device-reachability-check',
      description: 'Verify XCO can reach all managed devices in a site',
      triggerPatterns: ['reachability', 'device unreachable', 'ping', 'connectivity check', 'device down'],
      steps: [
        { step: 1, tool: 'list_devices', purpose: 'Get all devices (or by site)', extractField: 'results[].id, results[].hostname, results[].management_ip' },
        { step: 2, tool: 'get_device_status', params: { device_id: '{step1[].id}' }, foreach: true, purpose: 'Get reachability status per device' },
        { step: 3, compute: 'Filter devices where status != CONNECTED. Flag any with last_seen > 5 minutes.', output: 'List of unreachable devices: hostname | management_ip | last_seen | status' },
      ],
    },
  ];

  const xcoKnowledge = await prisma.domainKnowledge.upsert({
    where: { domain: 'networking' },
    update: {
      entityGraph: xcoEntityGraph,
      playbooks: xcoPlaybooks,
    },
    create: {
      domain: 'networking',
      docIndex: [
        { url: 'https://supportdocs.extremenetworks.com/support/documentation/extremecloud-orchestrator-4-0-0/', title: 'ExtremeCloud Orchestrator 4.0 Docs', type: 'user_guide', description: 'XCO product documentation index', discoveredAt: new Date().toISOString() },
      ],
      entityGraph: xcoEntityGraph,
      playbooks: xcoPlaybooks,
    },
  });

  console.info('Seeded XCO domain knowledge:', xcoKnowledge.domain);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
