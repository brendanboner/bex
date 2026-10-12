# XCO / EFA Troubleshooting Reference Guide
> Source: ExtremeCloud Orchestrator v4.0.0 Troubleshooting Reference Guide (9039316-00 Rev AB, December 2025)
> Auto-extracted from official documentation PDF.

---

## Quick Symptom → Action Lookup

| Symptom | Section |
|---------|---------|
| Device shows "cfg refreshed" or "cfg refresh error" | cfg-refresh-error |
| Drift & Reconcile stuck in-progress | drift-reconcile |
| EFA commands fail / 408 / 503 errors | efa-commands-fail |
| Cannot log in to XCO or EFA | login-fail |
| HTTPS issues between XCO and SLX | https-issue |
| Kubernetes pod CrashLoopBackOff | pod-crashloop |
| RabbitMQ pods restarting | rabbitmq |
| HA split brain | split-brain |
| Device addition to fabric fails | device-add |
| Token/certificate renewal failure | token-cert |
| SNMP with special characters ($) | snmp-special |
| Backup/restore fails | backup-restore |
| Recover a deleted leaf node | recover-leaf |
| Supportsave fails | supportsave |

---

## cfg-refresh-error — Device Shows "cfg refreshed" or "cfg refresh error"

EFA or XCO Device Status is "cfg refreshed" or "cfg refresh error"

When running the efa fabric show command, some devices are listed as cfg
refreshed or cfg refresh error. This indicates a discrepancy between the XCO or
EFA configuration and the actual device configuration.

(efa:extreme)extreme@tpvm21:~$ efa fabric show

Fabric Name: extr_pd1, Fabric Description: , Fabric Stage: 3, Fabric Type: clos, Fabric Status: 
configure-success, Fabric Health: Black 
+------------+-----+-----------+------------+------------+--------------+-------------------
+-------------------+---------------------------------+---------+-------+
| IP ADDRESS | POD | HOST NAME |    ASN     |    ROLE    | DEVICE 
STATE |     APP STATE     | CONFIG GEN REASON |         PENDING CONFIGS         | VTLB ID | LB ID |
+------------+-----+-----------+------------+------------+--------------+-------------------
+-------------------+---------------------------------+---------+-------+
| 10.53.2.41 |     | PD1_S1    | 4200002000 | Spine      | provisioned  
| cfg in-sync       | NA                | NA                              | NA      | 1     |
| 10.53.2.42 |     | PD1_S2    | 4200002000 | Spine      | provisioned  
| cfg in-sync       | NA                | NA                              | NA      | 1     |
| 10.53.2.46 |     | PD1_L01   | 4200000000 | Leaf       | provisioned  
| cfg in-sync       | NA                | NA                              | 2       | 1     |



Troubleshooting Fabric Skills

EFA Still Reporting "cfg refreshed" Post Drift Reconcile

| 10.53.2.47 |     | PD1_L02   | 4200000000 | Leaf       | provisioned  
| cfg refreshed     | LA,LD,IU,BGPU     | BGP-D,INTIP-C,INTIP-U,INTIP-D   | NA      | 1     |
| 10.53.2.44 |     | PD1_L03   | 4200003000 | BorderLeaf | provisioned  
| cfg refresh error | LA,ASN,IU,POU     | MCT-C,MCT-PA,INTIP-C,EVPN-C,O-C | 2       | 1     |
| 10.53.2.45 |     | PD1_BL2   | 4200003000 | BorderLeaf | provisioned  
| cfg refresh error | LA,LD,ASN,IU,POU  | MCT-C,MCT-PA,BGP-U,INTIP-U      | 2       | 1     |
+------------+-----+-----------+------------+------------+--------------+-------------------
+-------------------+---------------------------------+---------+-------+

The issue occurred due to the conflicts between EFA or XCO and device configuration,
and due to the various situations, such as networks updates, BGP changes, or system
properties updates.

Resolution

Use either of the following methods to overcome the cfg refreshed or cfg refresh
error:

• Revert SLX configuration to match XCO config.

Update inventory using the efa inventory device update --ip [ip_address]
command. This will confirm whether the SLX config is back in sync.

• Perform Drift Reconcile (DRC).

Run the efa inventory drift-reconcile execute --ip [ip_address] --
reconcile command to overwrite conflicting config.

Optionally, run without the --reconcile flag to display a summary of conflicting
configs.

EFA Still Reporting "cfg refreshed" Post Drift R

---

## drift-reconcile — Drift and Reconcile Issues

Drift and Reconcile Shows 'In-Progress' Status Despite 'Failed' Status for
Several Devices

Drift and Reconcile (DRC) status remains 'in-progress' even after 4 days, despite
showing 'failed' for some devices.

The issue occurs due to device discovery failure during inventory reconcile.

(efa:admin)]$ efa inventory drift-reconcile detail --uuid=e7f794a8-c167-4e5a-b4c6-0f89aeaa3233
+--------------------------------+--------------------------------------+
| NAME                           | VALUE                                |
+--------------------------------+--------------------------------------+
| UUID                           | e7f794a8-c167-4e5a-b4c6-0f89aeaa3233 |
+--------------------------------+--------------------------------------+
| Device IP                      | 1.2.3.4                              |
+--------------------------------+--------------------------------------+
| Status                         | in-progress                          |
+--------------------------------+--------------------------------------+
| Failure Reason                 | device discovery failed After        |
|                                | Inventory Reconcile                  |
+--------------------------------+--------------------------------------+
| Execution Reason               | manual                               |
+--------------------------------+--------------------------------------+
| operation                      | drift-and-reconcile                  |
+--------------------------------+--------------------------------------+
| Inventory Status               | inventory-dr-success                 |
+--------------------------------+--------------------------------------+
| Is Inventory config Refreshed  | true                                 |
+--------------------------------+--------------------------------------+
| Inventory Duration             | 25.408171436s                        |
+--------------------------------+--------------------------------------+
| Fabric Status                  | unknown                              |
+--------------------------------+--------------------------------------+
| Is Fabric config Refreshed     | false                                |
+--------------------------------+--------------------------------------+
| Fabric Duration                |                                      |
+--------------------------------+--------------------------------------+
| Policy Status                  | unknown   

---

## device-add — Device Addition to Fabric Fails

Device Addition to Fabric Fails

Use this topic to learn about the troubleshooting scenario when a device addition to
fabric fails.

Switch Addition to Fabric Fails

The following symptoms were observed when switch addition to fabric fails:
• SuperSpine close error
• SuperSpine Device x.x.x.x not connected to Spine Device y.y.y.y

SuperSpine clos error SuperSpine Device x.x.x.x not connected to Spine Device y.y.y.y

The issue occurred because there is a connection issue between the spine and super-
spine device.

Resolution

Resolve the connection issue between the spine and super-spine devices.

Note
This error only occurs when attempting to add the spine device while there is a
connection issue.

Addition of Multiple Devices to Fabric Fails

Adding multiple devices to fabric results in failure due to an OAuth2 PKI certificate
issue.

efa fabric device add-bulk failed because of OAuth2 PKI certificate failed

The log entry indicates issue with incorrect username or password:

%!Error: Importing OAuth2 PKI certificate failed. Please verify certificate location and 
user credentials/parameters.

Resolution

Enter the correct username and password.



Troubleshooting Fabric Skills

EFA Status Shows Nothing and gofaultmanager and
gopolicy POD Services Stuck in init State

EFA Status Shows Nothing and gofaultmanager and gopolicy POD
Services Stuck in init State

In a multi-node deployment, the following symptoms are observed:

1. The efa stauts command does not show any output.

extreme@tin10tpvm01:~$ efa status
+-----------+------+--------+----+
| Node Name | Role | Status | IP |
+-----------+------+--------+----+
--- Time Elapsed: 10.468338371s ---

2. Readiness failed for kube-system (POD calico-kube-controllers-685b65ddf9-

npsxj is Unhealthy).

3. The pods gopolicy-service-v5wfz and gofaultmanager-service-vr7db are stuck

in the initialization phase.
k3s kubectl -n efa get pods -o wide
NAME                           READY   STATUS     RESTARTS   AGE   IP               
NODE   NOMINATED NODE   READINESS GATES
gopolicy-service-v5wfz         0/1     Init:0/3   0          20d   10.42.194.102    
efa    <none>           <none>  
gosystem-service-mkvwm         1/1     Running    0          20d   10.42.194.96     
efa    <none>           <none>
gosnmp-service-blwlx           1/1     Running    0          20d   192.168.246.10   
efa    <none>           <none>
efa-api-docs-65bdp             1/1     Running    0          20d   10.42.194.98     
efa    <none>      

---

## restore-fail — Configuration Restore Not Working as Expected

Configuration Restore Functionality is Not Working as Expected

The automated test failed because the config-replay (efa inventory config-replay
detail --uuid <uuid-number>) command took longer than expected to complete,
resulting in loss of connectivity between EFA or XCO and SLX. It remained in progress
beyond the test's sleep time, which was set for 7 minutes.



Configuration Restore Functionality is Not Working as
Expected

Troubleshooting Device Management

The following steps outline the scripted event sequence:

1. Run the config-replay command on a device.

efa inventory config-replay execute --ip=x.x.x.x --startup-config

2. Run the following command to verify the config-replay status.

efa inventory config-replay detail --uuid <uuid-number>

The following are the log details:

24-03-05 14:53:19.160 Test Step 20: Restore configuration on <host> now hosting standby 
EFA - 0:7:17.021
24-03-05 14:53:19.161 Sub Test Step 20_1: Execute config-replay and check details - 
0:7:17.008
24-03-05 14:53:23.651 Executed command: 'efa inventory config-replay execute --ip 
21.151.151.102 --uuid 5b9f6d7c-d841-4669-be35-782c331e18c5 --startup-config'
24-03-05 14:53:25.097 Sleeping for 120 seconds...
24-03-05 14:55:25.102 Executed command: 'efa inventory config-replay detail --uuid 
4dbe6a6b-aff9-43ea-9e59-9b01643c6964'
...
24-03-05 15:00:36.173 Assertion Failed: Config-replay was not successful

Despite the failure during the automated test, a manual check later showed that the
command completed successfully in about five minutes.

(efa:extreme)extreme@host-name:~$ efa inventory config-replay detail --uuid 4dbe6a6b-
aff9-43ea-9e59-9b01643c6964
---------------------{}-------------------------------------+
| NAME               | VALUE                                |
---------------------{}-------------------------------------+
| UUID               | 4dbe6a6b-aff9-43ea-9e59-9b01643c6964 |
---------------------{}-------------------------------------+
| Device IP          | x.

---

## https-issue — HTTPS Connection Issues Between XCO and SLX

HTTPS Connection Issues Between XCO and SLX

Use this topic to learn about troubleshooting HTTPS connection issues between XCO
and SLX.

HTTP/HTTPS Process Error and Multiple Defunct Process

The following symptoms are observed when an HTTPS connection from XCO to SLX
fails:
• Pings between EFA or XCO and SLX are successful.
• EFA or XCO sends HTTP TCP SYN packets to SLX on port 443.
• SLX does not respond to EFA or XCO. It is found that the HTTP or HTTPS process on

SLX has entered a "defunct state."

There are two reasons for HTTPS connection failure from SLX:
• The issue on the SLX device is caused by the HTTP/HTTPS process not responding to

the EFA or XCO after receiving a TCP SYN packet on port 443

• Multiple defunct (zombie) processes are present on SLX, indicating that the parent
process is unaware of the child process's termination. You cannot kill a zonbie
process using the SIGKILL signal command. Although these zombie processes are
usually inactive and harmless, a large accumulation can cause unexpected behavior.

Resolution

To recover HTTPS connection between EFA or XCO and SlX, complete the following
steps:

1. Clear existing HTTPS and OAuth certificates on SLX.

• List the existing certificates.
show crypto ca certificates



HTTP/HTTPS Process Error and Multiple Defunct
Process

Troubleshooting Device Management

• Remove OAuth and HTTPS certificates.

no crypto import oauth2pkicert
no crypto ca import-pkcs type pkcs12 cert-type https

• Verify the removal.

show crypto ca certificates

2. Restart HTTP service for the Management VRF.

http server use-vrf mgmt-vrf shutdownno
http server use-vrf mgmt-vrf shutdown

• Ensure that HTTPS is disabled and HTTP is enabled by running the following

command:
show http server status

3. Ensure that there are no certificates and HTTPS is disabled on SLX, but HTTP is

enabled by running the following command:
show http server status

EFA or XCO starts communicating with SLX using HTTP.

4. Configure HTTPS certificates on SLX via EFA or XCO.

efa certificate device install --ip10.x.x.46--cert-type token
efa certificate device install --ip10.x.x.46--cert-type http

5.

If you have removed the syslog CA certificate, reconfigure it.
efa inventory device update--ip 10.x.x.46

6. Verify Certificates on SLX.

• Check the certificates in the SLX-OS CLI to ensure they are correctly installed.

show crypto ca certificates

7. Restart HTTP/HTTPS Services.

http server use-vrf mgmt-vrf shutdownno
http server use-v

---

## efa-commands-fail — EFA Commands Fail to Execute

EFA Commands Fail to Execute

Running EFA commands fails with the following symptoms:
• EFA commands consistently fail to execute, resulting in errors.
• Switches become stuck in a locked state within EFA
• Multiple PODs enter Error and CrashLoopBackOff states

The issue occurred because the K3s CoreDNS POD experienced a critical error,
disrupting communication between RabbitMQ and other PODs, leading to widespread
restarts of PODs and system instability.

Resolution

To restore the system functionality, perform a failover from the active to the standby
node.

Note
• Regular system monitoring is crucial for prompt issue detection and

resolution.

• Engaging Global Technical Assistance Center (GTAC) support in a timely
manner is essential for effective Root Cause Analysis (RCA) and issue
resolution.



Troubleshooting Fabric Skills

EFA Commands Fails with "Error 408"

EFA Commands Fails with "Error 408"

The efa inventory device setting update command fails with a "408 Error"
response.

The command cannot be completed at this time. Please check the node
status using 'efa status' and retry the command later.

The issue is caused by an intermittent timeout of the efa-client connection request to
the EFA or XCO node VIP on HTTP port 80.

Resolution

Upgrade to XCO 3.5.0 and later.

EFA Command Fails with "Dial TCP xx.xx.xx.xx:80: Connect: Connection
Refused" Message

The different EFA commands fail with the following message:

'efa tenant create --name vpod01 --port 10.10.10.10[0/1:3,0/1:1] --vlan-range 200 --
enable-bd=true'
Command Response:
Error: Post "http://10.10.10.10/v1/tenant/tenant": dial tcp : connect: connection refused

This can also be preceded by the response Error: Bad Gateway.

The error occurs because the EFA CLI sends a REST POST message to the tenant (for
efa tenant create), and the tenant is not responding, possibly because it is not
running.

Resolution

Ensure that the tenant is running and responding to the POST messages.

EFA Error When Registering a RELP Handler on Endpoint Using FQDN

Adding subscriber for RELP with FQDN fails resulting in The host from the endpoint
URL is not reachable error.

(efa:extreme)extreme@tpvm93:~$ efa notification subscribers add-syslog-relp --address 
win01.etsuklab.com --insecure
Error: Error on registration for a 'relp' handler on endpoint 'win01.etsuklab.com:514'. 
ERROR: The host from the endpoint URL is not reachable.

The issue occurred because gonotification pod is unable to resolve the FQDN to 

---

## login-fail — Log in to EFA or XCO Fails

Log in to EFA or XCO Fails

The login to EFA or XCO fails. The supportsave data revealed the following entries in the
database/*_error.log file:

2022-04-22 14:15:51 0 [Note] InnoDB: Buffer pool(s) load completed at 220422 14:15:51
2022-04-22 14:17:25 1 [ERROR] Slave SQL: Error 'Duplicate key name 'kine_name_index'' 
on query. Default database: 'k3s'. Query: 'create index kine_name_index on kine (name)', 
Internal MariaDB error code: 1061
2022-04-22 14:17:25 1 [Warning] WSREP: Ignoring error 'Duplicate key name 



LDAP Authentication Configuration Using FQDN Fails

Troubleshooting Fabric Skills

'kine_name_index'' on query. Default database: 'k3s'. Query: 'create index 
kine_name_index on kine (name)', Error_code: 1061

The log file indicates a duplicate key name kine_name_index in the k3s database. This
error suggests that the Kubernetes state stored in MariaDB is incorrect.

It is found that the Kubernetes state is stored in MariaDB and synchronized across
both nodes of a high-availability (HA) cluster using Galera. The error indicates an
inconsistency in the database state.

Resolution

Completely reset Kubernetes and then rebuild the Kubernetes configuration based on
the rules used by the EFA or XCO installer.

Note
The business data, such as switch configurations and fabrics, are stored in
separate database tables and are not modified by this procedure. However,
consider taking an EFA or XCO backup as a precaution, if possible.

For further assistance with the recovery process, contact Extreme GTAC.

LDAP Authentication Configuration Using FQDN Fails

An attempt to log in to LDAP after configuring authentication with FQDN fails.
Initially, configuration failed due to an outdated /etc/resolv.conf file. However, after
running the sudo <location of the script>/update-dns.sh --dns-action allow
command, LDAP authentication configuration using FQDN was successful. Now, login
attempts fail with the following error log:

==> /apps/efa_logs/auth/auth-server_err.log <== 
{"@time":"2023-09-15T13:14:38.029361 GMT","level":"error","msg":"Could not authenticate 
against LDAP unable to read LDAP response packet: read tcp x.x.x.x:55630-
\u003ey.y.y.y.y:636: read: connection reset by peer"}

The issue occurred because of the port mismatch, as XCO uses port 389 for LDAP,
whereas the configuration was set to port 636.

Resolution

Use the --port 389 when logging in with the efa login --username <> command. A
network connectivity test (nc -zv y.y.y.y 389) confirms that

---

## token-cert — Fabric Skill Down After Token Certificate Renewal Failure

Fabric Skill is Down After a Failed Token Certificate Renewal

Versions prior to EFA or XCO 3.x.x did not include the "kustomization.yaml" file.

After upgrading a system from EFA 2.x.x to EFA or XCO 3.x.x, attempts to update or
refresh the token certificate fails due to the missing "kustomization.yaml" file in the
directories:
• Server

/opt/efa/certs/cert

/opt/efa/certs/key

• TPVM

/apps/efa/certs/cert

/apps/efa/certs/key



Fabric Skill is Down After a Failed Token Certificate
Renewal

Troubleshooting Fabric Skills

This results in EFA or XCO entering a down state.

Note
This issue does not occur in XCO 3.5.0 or above.

The "kustomization.yaml" file is incorrectly created in a nested folder:
• /[opt|apps]/efa/certs/certs/cert/
• /[opt|apps]/efa/certs/certs/key/

This issue does not affect the EFA upgrade process or existing certificates but is only
encountered when attempting to renew the Token Certificate.

When attempting to refresh the certificate type "token" in XCO, the renewal fails and
commands will no longer process:

(efa:administrator)administrator@GTAC-SP-EFA-1:~$ efa certificate server renew --cert-
type token
Error: Certificate renewal has failed.

Renew certificates for EFA

Usage:
  efa certificate server renew [flags]

Flags:
      --cert-type string   Type of certificate to renew, valid values (server | token | 
root-ca | intermediate-ca | k3s-ca | k3s-server ) (default "server")
--- Time Elapsed: 2m47.386569066s ---

GoAuth Pod error messages:

efa     25m     Warning   FailedMount    pod/goauth-service-bs7j2    MountVolume.SetUp 
failed for volume "verifier" : configmap "jwt-verifier" not found
efa     25m     Warning   FailedMount    pod/goauth-service-bs7j2    MountVolume.SetUp 
failed for volume "signer" : secret "jwt-signer" not found
efa     25m     Warning   FailedMount    pod/goauth-service-bs7j2    Unable to attach 
or mount volumes: unmounted volumes=[verifier signer], unattached volumes=[], failed to 
process volumes=[]: timed out waiting for the condition

Installer logs:

+(2024-02-15T21:32:36.304475 UTC GTAC-SP-EFA-1 common.sh:3130): 
token_keypair_regenerate(): echo 'Generating yaml files for certificates.'
Generating yaml files for certificates.
+(2024-02-15T21:32:36.305336 UTC GTAC-SP-EFA-1 common.sh:3131): 
token_keypair_regenerate(): reliable_k3s kubectl kustomize /opt/efa/certs/cert
+(2024-02-15T21:32:36.306194 UTC GTAC-SP-EFA-1 common.sh:20845): reliable_k3s(): 
without_debug reliable_k3s_impl kubectl kustomize

---

## pod-crashloop — Pod in CrashLoopBackOff State

Pod is in a Crashloopback State

To know if a POD is in a crashloopback state, run the k3s kubectl get pods -n efa
command.

To view the logs, run the k3s kubectl -n efa logs pod/<pod-name-here>
command.

Also see Avoiding CrashLoopBackOff State for CoreDNS

Post-Uninstallation of EFA or XCO, Existing Fabric Configuration Persists
on SLX

When you uninstall EFA or XCO, the fabric configuration remains on SLX devices. This is
an expected behavior.

Uninstalling only stops services and removes databases, but doesn't delete tenant,
fabric, and inventory devices.

Resolution



RabbitMQ Pods Continuously being Deleted and
Redeployed or in CrashLoopBackOff

Troubleshooting Installation and Deployment

To completely uninstall EFA or XCO and remove fabric configuration from SLX devices,
complete the following steps:

1. Delete all tenant services.

efa tenant delete --name [tenant_name] --force

The --force option automatically removes any underlying tenant objects such as
EPG, VRF, and PO.

2. Delete fabric from EFA or XCO.

efa fabric delete --name [fabric_name] --force

The --force option automatically removes all devices from the fabric along with the
EFA managed fabric configuration.

3. Delete devices from EFA or XCO inventory.

efa inventory device delete --ip [ip_address|range]

This will remove any inventory settings such as SNMP server configurations.

4. Uninstall EFA or XCO.

• For TPVM based deployments, run the following command from the SLX:

no efa deploy

For more information, see Uninstall XCO on TPVM in a Single-Node and Multi-
Node Deployment.

• For Server based deployments, run the following command:

source ./deployment.sh -o undeploy

For more information, see Uninstall XCO in a Single-Node or Multi-Node
Deployment.

RabbitMQ Pods Continuously being Deleted and Redeployed or in
CrashLoopBackOff

The persistent volumes for RabbitMQ pods reduces message loss during double faults
or system failures. These persistent volumes are tightly linked to the k

---

## rabbitmq — RabbitMQ Pods Continuously Restarting

RabbitMQ Pods Continuously being Deleted and Redeployed or in
CrashLoopBackOff

The persistent volumes for RabbitMQ pods reduces message loss during double faults
or system failures. These persistent volumes are tightly linked to the k3s host and
the specific RabbitMQ pod deployed on that host. Pre-existing files on these volumes
containing configuration data for an existing RabbitMQ cluster can affect the formation
of new clusters.

During installation, upgrade, restore, or double faults (or system failures), RabbitMQ
pods might be assigned to different k3s hosts. If old configuration data is present on
these persistent volumes, and if it is not updated, it can lead to issues with new cluster
formation. If this occurs, the RabbitMQ pods fail to form a cluster.

The monitoring service in XCO detects and remediates this condition. The remediation
script tries several simple fixes to minimize message loss before resetting the cluster.
These fixes may result in multiple deletions and redeployments of RabbitMQ pods.



Troubleshooting Installation and Deployment

Split Brain Issue in EFA or XCO HA Deployment

You can monitor the progress of these remediation processes by reviewing the logs
located at the following locations:
• For TPVM: /apps/efa_logs/efa-monitor/rabbitmq*.log
• For Server: /var/log/efa/efa-monitor/rabbitmq*.log

Generally, XCO services remain functional during remediation as the remediation script
attempts to sync with the RabbitMQ pod on the standby node. In some cases, XCO
might take longer to come online. No additional actions are required from users.

Split Brain Issue in EFA or XCO HA Deployment

When upgrading EFA or XCO in an HA setup, the following issues are observed:
• Slow response from EFA
• VIP bouncing between both TPVMs
• Attempts to change the TPVM hostname timeout after 30 minutes

This is often caused by using capital letters in the TPVM hostname, which Kubernetes
doesn't support.

Resolution

Complete the following steps:

1. Record

---

## split-brain — Split Brain Issue in EFA/XCO HA Deployment

Split Brain Issue in EFA or XCO HA Deployment

When upgrading EFA or XCO in an HA setup, the following issues are observed:
• Slow response from EFA
• VIP bouncing between both TPVMs
• Attempts to change the TPVM hostname timeout after 30 minutes

This is often caused by using capital letters in the TPVM hostname, which Kubernetes
doesn't support.

Resolution

Complete the following steps:

1. Record the old and new hostname values and identify the standby TPVM.

EFA# efa status

2. Stop the EFA monitor service on the standby TPVM via SSH.

TPVM# sudo systemctl stop efamonitor
TPVM# exit

3. Change the TPVM hostname to lowercase via SLX CLI via SSH.

SLX-SWITCHX# tpvm config hostname <new hostname following the recommendation>

4. Run the hostname change script on the standby TPVM.

TPVM# sudo /apps/bin/efa-change-hostname <OLD TPVM HOST NAME>

The standby TPVM will go down during this process. The script will report
restartmariadb, k3s, and so on, and finally, Successfully updated hostname in
EFA.

Wait for EFA HA stability (the efa status must show both active and standby as
“up” with the new hostname visible on the updated TPVM).

5. Restart the EFA monitor service and log out of TPVM.

TPVM# sudo systemctl start efamonitor
TPVM# exit

6. Validate the hostname in the mgmt_networks.txt file.

TPVM# cat /apps/efadata/misc/multiaccess/mgmt_networks.txt

If the hostname is still in uppercase, correct it manually.

7. Ensure keepalived configurations match on both devices.

TPVM# cat /etc/keepalived/keepalived.conf



TPVM Deployment Fails

Troubleshooting Installation and Deployment

Ensure that both files show the same VIP and that the number of configured
networks matches.

8. Trigger an EFA or XCO HA failover and repeat steps 2-6 for the remaining TPVM.

SLX-SWITCHX# tpvm stop
SLX-SWITCHX# tpvm start

9. Wait for EFA HA stability (both active and standby must be up), then repeat steps 2

to 6 for the (previously active, now standby) TPVM.

TPVM Deployment Fails



---

## recover-leaf — Recover a Leaf Node After Deletion

Recover a Leaf Node after Deletion

Deleting a leaf node using the efa inventory device delete command will remove
the leaf node configuration.

Running the efa inventory device delete --ip [leaf-node] command removes
the configuration applied by EFA or XCO on the leaf node. Exercise caution when
using this delete option and know how to recover the unit if this action is performed
accidentally. This procedure can also be useful in case of an RMA or if any configuration
is lost upon an SLX reload.

Note
The efa fabric show and efa inventory device list commands will not
display the leaf node after it has been removed with the delete command.

Resolution

1. Take a backup before deletion.

Before running the efa inventory device delete --ip <ip address>
command, back up the current "good" state with the efa system backup
command. If a manual backup is not done, use the most current automated system
backup where the device was in a working state.

2. Restore EFA or XCO system from a backup.



SLX, EFA, or XCO Config Missing After SLX Reload

Troubleshooting Fabric Skills

Run the efa system restore command and select the desired backup.

3. Verify device status.

After the restore, the efa device inventory list and efa fabric show
commands will report the device as added back to the inventory and fabric, but
it will be in a cfg-refresh-err state.

4. Reconcile configuration.

a. Run the efa inventory drift-reconcile execute –ip <ip address> --

reconcile command for the device.

b. Run the efa inventory drift-reconcile history command to see if the

reconcile is completed.

c. Run the show running-config command on the SLX-OS CLI to confirm that the

configuration is applied on the leaf node.

5. Resolve cfg-refresh-err.

•

If cfg-refresh-err is still shown for the spine devices and any MCT peer
associated with the leaf device, perform the following:
◦ Run the efa inventory device update --fabric [fabric_name]

command.

◦ If the cfg-refresh-err message persists, pe

---

## backup-restore — EFA/XCO Backup Authentication Fails

EFA or XCO Backup Authentication Fails

An authentication failure occurred during the EFA or XCO backup process, causing the
backup to fail.

(efa:efabackup)efabackup@KVDCxxxx-cTPVM02:~$ efa system backup --fabric-name XXXYYY-
Fabric --remote

Generating backup of EFA...
Backup Errors:
ssh: handshake failed: ssh: unable to authenticate, attempted methods [none 
password], no supported methods remain Backup Location: /apps/efa_logs/backup/
EFA-2023-07-27T15-59-04.706.tar

{"@time":"2023-07-26T16:01:12.091424 
+08","App":"efa","level":"error","msg":"Failed","reason":"invalid credentials","request":
{"cmd":"auth:create-client-access-token","params":{"ClientID":"3377a122-37ad-45ac-9e73-
a84f9553402b","UserName":"efabackup"}},"rqId":"cca0219d-7e79-45b1-8407-a258f800233e"}

The issue occurred because an authentication token has expired.

Resolution

Log out and log back into EFA or XCO.

Note
You can set the token duration to a minimum of 1 hour and a maximum of 8
hours, with the default setting of 1 hour.

Interface Config Missing After Restore from EFA or XCO Backup

After restore from a previous backup to resolve an issue, the interface (for example, 0/12)
config was missing on the switch (for example, switch2).



Interface Config Missing After Restore from EFA or XCO
Backup

Troubleshooting Backup and Restore

The following configurations found on Switch1:
interface Ethernet 0/12:1
 no shutdown
!
interface Ethernet 0/12:2
 no shutdown
!
interface Ethernet 0/12:3
 no shutdown
!
interface Ethernet 0/12:4
 no shutdown

The following configurations found on Switch2:
interface Ethernet 0/12
 no shutdown

The following are the configurations on EFA or XCO:
efa tenant create --name "cnis_upf_tenant" --description "cnis_upf_tenant" --type private 
--vlan-range 801,805,3220,3608,3609,201-210,251-260,820-860,220-250,270-300,811-819 --vrf-
count 12 --port 
192.168.246.22[0/1-4,0/6-7,0/10:1-4,0/11:1-4,0/13:1-4,0/5:1-4,0/8:1-4,0/9:1-4],192.168.246
.21[0/1-4,0/6-7,0/10:1-4,0/11:1

---

## supportsave — Supportsave Fails to Collect Data

Supportsave Fails to Collect Data

When you run the efa system supportsave command, supportsave fails to collect
data:

efa system supportsave --fabric-name B151-FABRIC

Timestamp: 2023-12-21 11:17:52,975
INFO Command Response:
Device supportsave location: operator@21.151.151.254:/var/log/slx

+----------------+--------+--------------------------------------------------------------+
| IP Address     | Status | Reason                                                       |
+----------------+--------+--------------------------------------------------------------+
| 21.151.151.102 | Failed | Supportsave process didnt start on the device 21.151.151.102 |
+----------------+--------+--------------------------------------------------------------+
| 21.151.151.101 | Failed | Supportsave process didnt start on the device 21.151.151.101 |
+----------------+--------+--------------------------------------------------------------+

The issue is caused by the permission settings on the external server.
Warning: SLX9250-32C, Copy support upload operation failed. Reason: Please check the 
username, password, or directory/file permission.

Resolution

Correct the permission settings on the external server.

Unable to Run EFA or XCO System Backup

The attempt to run the efa system backup command returns the following error
message:

Failed to execute service lock API due to error: Service Approval Failed
for Process BACKUP.

As the message queue for the fabric service continues to grow, issues

---

## snmp-special — SNMPv3 Credentials Issue with Special Characters

SNMPv3 User Credentials Issue with Special Character
($) in Password

view   |       | proto |                              | proto  |
+--------------+----------+--------+-------+-------+--------+-------+-------
+------------------------------+--------+------------------------------+---------
+--------------------------------+
| 10.53.17.201 | XCO-USER | GROUPX | view2 | 
view2 | view2  | view2 | sha   | Bd6Gfj1uZcVbdtSEeV5tWy1qtPg= 
| AES128 | Bd6Gfj1uZcVbdtSEeV5tWy1qtPg= | Success | Configured view contains out   |
|              |          |        |       |       |        
|       |       |                              |        |                              
|         | of band configuration. Out of  |
|              |          |        |       |       |        
|       |       |                              |        |                              
|         | band views are not recommended.|
+--------------+----------+--------+-------+-------+--------+-------+-------
+------------------------------+--------+------------------------------+---------
+--------------------------------+
Snmp user details
--- Time Elapsed: 7.239535431s ---

Resolution
• This is a known behavior in the Linux bash prompt. The dollar symbol ($) is

interpreted as a UNIX operator.

• To include a dollar symbol in beginning or middle of the passphrase, use a backslash
(\) before the dollar symbol (for example, ab\$defg123). This suppresses the UNIX
operator and treats $ as a special character in the string. Therefore, enter the
resulting passphrase as ('ab$defg123').

Note
• The issue occurs when the 3rd character in the password is a $ symbol (for

example, ab$defg123).

• This issue is only present when configured via EFA-CLI, not when configured

via SLX-CLI.

• The following is an example of failing Configuration via SLX-CLI & EFA-CLI with

differences in encrypted passwords:
SLXB(config)# snmp-server user SLX-USER groupname GROUPX auth sha auth-password 
ab$defg123 priv AES128 priv-

---

## fabric-config-fail — Fabric Configuration Fails with EFA/XCO

Fabric Configuration Fails with EFA or XCO

SLX fabric fails to form when created through EFA or XCO using the following
commands for a two-switch small data center fabric:

efa fabric create --name FabricName --type non-clos --description Row_A
efa fabric device add --ip 10.254.3.20 --hostname SLX_1 --rack A1 --username admin --
password password --name FabricName
efa fabric device add --ip 10.254.3.30 --hostname SLX_2 --rack A2 --username admin --
password password --name FabricName

The efa fabric show command output shows the following error:

$ efa fabric show --name FabricName

Fabric Name: FabricName, Fabric Description: Row_A, Fabric Type: non-clos 
+-------------+------+-----------+------------+------+-----------------+-----------
+-------------------+---------------------------------+---------+-------+
| IP ADDRESS  | RACK | HOST NAME |    ASN     | ROLE |  DEVICE STATE   
| APP STATE | CONFIG GEN REASON |         PENDING CONFIGS         | VTLB ID | LB ID |
+-------------+------+-----------+------------+------+-----------------+-----------
+-------------------+---------------------------------+---------+-------+
| 10.254.3.30 | A2   | SLX_2     | 4200000001 | leaf | not provisioned 
| cfg ready | DA                | SYSP-C,BGP-C,INTIP-C,EVPN-C,O-C | 2       | 1     |
| 10.254.3.20 | A1   | SLX_1     | 4200000000 | leaf | not provisioned 
| cfg ready | DD,DA             | SYSP-C,BGP-C,INTIP-C,EVPN-C,O-C | 2       | 1     |
+-------------+------+-----------+------------+------+-----------------+-----------
+-------------------+---------------------------------+---------+-------+

efa fabric configure --name FabricName
Validate Fabric [Failed]
     Missing Links
     Rack A1, should have 2 number of devices
     Rack A2, should have 2 number of devices
Configure Fabric [Failed]
Error: fabric validation failed

The described topology functions as a single ToR with redundancy, even though the
devices are in different physical racks. As a best practice, ensure t

---

## Diagnostic Commands Reference

| Task | Command |
|------|---------|
| Show fabric status | `efa fabric show` |
| Show device app-state | `efa fabric device show --name <fabric>` |
| Check EFA pod health | `kubectl get pods -n efa` |
| View pod logs | `kubectl logs -n efa <pod-name> --tail=100` |
| Trigger drift reconcile | `efa fabric drift-reconcile --name <fabric>` |
| Config replay | `efa inventory config-replay execute --ip=<ip> --startup-config` |
| Show inventory | `efa inventory device show` |
| EFA system status | `efa status` |
| Collect supportsave | `efa system supportsave` |
| Show authentication | `efa auth show` |
| Show certificate status | `efa certificate show` |
| Check K3s services | `sudo systemctl status k3s` |
| K3s logs | `journalctl -u k3s -n 100` |
| Check RabbitMQ | `kubectl get pods -n efa | grep rabbit` |
| Fabric health | `efa fabric health show --name <fabric>` |
| Token status | `efa fabric token show` |

---

## Common EFA/XCO Error Messages

| Error | Meaning | Action |
|-------|---------|--------|
| `cfg refreshed` | Device config diverged from XCO | Run drift-reconcile |
| `cfg refresh error` | Drift-reconcile failed to sync | Check device reachability, then reconcile again |
| `provisioning-failed` | Initial fabric provisioning failed | Check connectivity, credentials, re-run provisioning |
| `Error 408` | Request timeout from EFA service | Check pod health, restart if needed |
| `Error 503` | EFA service unavailable | Check K3s and EFA pod status |
| `dial tcp ...connection refused` | Pod not listening / service down | Restart affected pod |
| `CrashLoopBackOff` | Pod repeatedly crashing | Check pod logs for root cause |
| `init:0/1` | Pod init container stuck | Check storage and dependency services |
| `Split brain detected` | HA nodes diverged | See split-brain procedure |
| `Token expired` | fabric skill token/cert expired | Renew token, restart fabric skill |
