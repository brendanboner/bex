*: No devices detected (CLOS error).
- **fs1**: No devices detected (CLOS error).
- **fabs**: Neighbor configuration errors between devices SLX-160-11 and SLX-38.

#### Tenant Changes
- **Tenant t2**: New VRF (`vrfRed`) targeting devices SLX-160-11 and SLX-38.

---

### Risks
1. **Fabric Degradation**: `fabs` fabric has critical underlay topology issues.
2. **Critical Alarm**: Certificate renewal failure may impact security.
3. **Device Connectivity**: SLX-160-11 has degraded health and unreachable neighbors.

---

### Next Steps
1. Investigate `fabs` fabric underlay topology errors:
   - Neighbor configuration issues between SLX-160-11 and SLX-38.
2. Resolve critical alarm:
   - Renew application certificate to clear `CertificateRenewalFailure`.
3. Check LDAP server connectivity:
   - Verify server reachability and configuration.
4. Validate tenant `t2` VRF configuration:
   - Ensure `vrfRed` is correctly applied to SLX-160-11 and SLX-38.

---

Let me know if you need detailed logs or further diagnostics.

<!-- 2026-05-05T10:21:07.279Z — manual-cmosh9va7000p115taxldwciz -->
### Executive Summary
Issues detected in fabric health and device connectivity. Critical alarms present. Immediate attention required.

---

### Observations

#### Device Health
- **SLX-160-30**: Degraded health.
- **SLX-160-11**: Degraded health; underlay topology errors.
- **SLX-38**: Healthy.

#### Fabric Health
- **fabs**: Fabric health is critical (Black). Device-level underlay topology errors detected:
  - **SLX-160-11**: Neighbor not configured (10.20.20.3).
  - **SLX-38**: Multiple neighbor configuration errors (10.20.20.2, 10.20.20.5).

#### Alarms
- **Critical Alarms**: 1 active.
  - **CertificateRenewalFailure**: Application certificate renewal failed.
- **Major Alarms**: 2 active.
- **Warning Alarms**: 7 active.

#### Topology Changes
- No new devices or tenants added.

---

### Risks
1. **Fabric Health**: Critical state in "fabs" fabric due to underlay topology errors.
2. **Device Health**: SLX-160-11 and SLX-160-30 are degraded.
3. **Certificate Renewal**: Critical alarm for application certificate renewal failure.

---

### Next Steps
1. Investigate and resolve neighbor configuration errors in "fabs" fabric.
2. Address degraded health of SLX-160-11 and SLX-160-30.
3. Renew application certificate to clear critical alarm.

Let me know if you need detailed logs or further diagnostics.

<!-- 2026-05-05T10:25:51.656Z — XCO Watcher — scheduled -->
### Executive Summary
Critical issues detected in fabric health and device connectivity. Immediate attention required.

---

### Observations

#### Device Health
- **SLX-160-30**: Degraded health.
- **SLX-160-11**: Degraded health; underlay topology errors.
- **SLX-38**: Healthy.

#### Fabric Health
- **default**: Healthy (Green).
- **fs1**: Healthy (Green).
- **fabs**: Critical (Black). Underlay topology errors detected:
  - **SLX-160-11**: Neighbor not configured (10.20.20.3).
  - **SLX-38**: Neighbor configuration errors (10.20.20.2, 10.20.20.5).
- **fs**: Healthy (Green).

#### Alarms
- **Critical Alarms**: 1 active.
  - **CertificateRenewalFailure**: Application certificate renewal failed.
- **Major Alarms**: 2 active.
  - **LDAPServerConnectivity**: LDAP server unreachable.
  - **DeviceConnectivity**: Registered device unreachable.

#### Fabric Errors
- **default**: No devices detected (CLOS error).
- **fs1**: No devices detected (CLOS error).
- **fabs**: Neighbor configuration errors between SLX-160-11 and SLX-38.

---

### Risks
1. **Fabric Health**: Critical state in "fabs" fabric due to underlay topology errors.
2. **Device Health**: SLX-160-11 and SLX-160-30 are degraded.
3. **Certificate Renewal**: Critical alarm for application certificate renewal failure.

---

### Next Steps
1. Investigate and resolve neighbor configuration errors in "fabs" fabric.
2. Address degraded health of SLX-160-11 and SLX-160-30.
3. Renew application certificate to clear critical alarm.
4. Verify LDAP server connectivity and configuration.

Let me know if you need detailed logs or further diagnostics.

<!-- 2026-05-05T10:30:51.358Z — XCO Watcher — scheduled -->
### Executive Summary
Critical issues detected in fabric health and device connectivity. Immediate attention required.

---

### Observations

#### Device Health
- **SLX-160-30**: Degraded health.
- **SLX-160-11**: Degraded health; underlay topology errors.
- **SLX-38**: Healthy.

#### Fabric Health
- **default**: Healthy (Green).
- **fs1**: Healthy (Green).
- **fabs**: Critical (Black). Underlay topology errors detected:
  - **SLX-160-11**: Neighbor not configured (10.20.20.3).
  - **SLX-38**: Neighbor configuration errors (10.20.20.2, 10.20.20.5).
- **fs**: Healthy (Green).

#### Alarms
- **Critical Alarms**: 1 active.
  - **CertificateRenewalFailure**: Application certificate renewal failed.
- **Major Alarms**: 2 active.
  - **LDAPServerConnectivity**: LDAP server unreachable.
  - **DeviceConnectivity**: Registered device unreachable.

#### Fabric Errors
- **default**: No devices detected (CLOS error).
- **fs1**: No devices detected (CLOS error).
- **fabs**: Neighbor configuration errors between SLX-160-11 and SLX-38.

#### Tenant Changes
- **Tenant t2**: New VRF (`vrfRed`) targeting devices SLX-160-11 and SLX-38.

---

### Risks
1. **Fabric Health**: Critical state in "fabs" fabric due to underlay topology errors.
2. **Device Health**: SLX-160-11 and SLX-160-30 are degraded.
3. **Certificate Renewal**: Critical alarm for application certificate renewal failure.

---

### Next Steps
1. Investigate and resolve neighbor configuration errors in "fabs" fabric.
2. Address degraded health of SLX-160-11 and SLX-160-30.
3. Renew application certificate to clear critical alarm.
4. Verify LDAP server connectivity and configuration.

Let me know if you need detailed logs or further diagnostics.

<!-- 2026-05-05T10:34:34.717Z -->
## Learned API Notes for networking.extreme-xco.monitor
xco_get_lldp_neighbors endpoint may not exist on certain XCO versions or return HTML instead of JSON. Verify endpoint availability before use.

<!-- 2026-05-05T10:34:39.927Z -->
## Learned API Notes for networking.extreme-xco.monitor
xco_validate_fabric endpoint may not exist or return 404 errors on certain XCO versions. Verify endpoint availability before use.

<!-- 2026-05-05T10:35:51.187Z — XCO Watcher — scheduled -->
### Executive Summary
Critical issues detected in fabric health and device connectivity. Immediate attention required.

---

### Observations

#### Device Health
- **SLX-160-30**: Degraded health.
- **SLX-160-11**: Degraded health; underlay topology errors.
- **SLX-38**: Healthy.

#### Fabric Health
- **default**: Healthy (Green).
- **fs1**: Healthy (Green).
- **fabs**: Critical (Black). Underlay topology errors detected:
  - **SLX-160-11**: Neighbor not configured (10.20.20.3).
  - **SLX-38**: Neighbor configuration errors (10.20.20.2, 10.20.20.5).
- **fs**: Healthy (Green).

#### Alarms
- **Critical Alarms**: 1 active.
  - **CertificateRenewalFailure**: Application certificate renewal failed.
- **Major Alarms**: 2 active.
  - **LDAPServerConnectivity**: LDAP server unreachable.
  - **DeviceConnectivity**: Registered device unreachable.

#### Fabric Errors
- **default**: No devices detected (CLOS error).
- **fs1**: No devices detected (CLOS error).
- **fabs**: Neighbor configuration errors between SLX-160-11 and SLX-38.

---

### Risks
1. **Fabric Health**: Critical state in "fabs" fabric due to underlay topology errors.
2. **Device Health**: SLX-160-11 and SLX-160-30 are degraded.
3. **Certificate Renewal**: Critical alarm for application certificate renewal failure.

---

### Next Steps
1. Investigate and resolve neighbor configuration errors in "fabs" fabric.
2. Address degraded health of SLX-160-11 and SLX-160-30.
3. Renew application certificate to clear critical alarm.
4. Verify LDAP server connectivity and configuration.

Let me know if you need detailed logs or further diagnostics.