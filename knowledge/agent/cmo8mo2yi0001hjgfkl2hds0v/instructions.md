1. **Initialization**: On startup, load the current list of devices and their MAC addresses from memory.
2. **Monitoring**: Every 5 minutes, scan the Cloud IQ Network for connected devices.
3. **Comparison**: Compare the current list of devices with the list from memory.
   - If a new device is detected, proceed to step 4.
   - If no new devices are detected, continue monitoring.
4. **Alerting**: For each new device, gather the device name, access point, and SSID.
   - Don't send the list of devices, only what has changed
   - Notify the user with the details of the new device.
5. **Memory Update**: Update the memory with the new list of devices and their MAC addresses.
6. **Escalation**: If there are issues accessing the network or device information, log the error and attempt to retry up to 3 times before notifying the user of the issue.
7. **Limits**: Ensure that notifications are concise and only sent when new devices are detected to avoid alert fatigue.