import Foundation
import CoreBluetooth

func emit(_ event: [String: Any]) {
    var record = event
    record["captured_at"] = ISO8601DateFormatter().string(from: Date())
    if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
       let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) }
}
func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

final class Scanner: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var target: CBPeripheral?
    let history = CommandLine.arguments.contains("--history")
    var historyCommands: [Data] = []
    var historyEnded = false
    let selectedDevice: String? = {
        guard let i = CommandLine.arguments.firstIndex(of: "--device"), i + 1 < CommandLine.arguments.count else { return nil }
        return CommandLine.arguments[i + 1].uppercased()
    }()
    let inspect = CommandLine.arguments.contains("--gatt") || CommandLine.arguments.contains("--history")
    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        emit(["event": "bluetooth_state", "state": central.state.rawValue,
              "authorization": CBManager.authorization.rawValue])
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        } else if [.unauthorized, .unsupported, .poweredOff].contains(central.state) { exit(2) }
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name ?? ""
        let services = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] ?? [:]
        let isScale = name.uppercased().hasPrefix("MIB") || services.keys.contains { ["181B", "181D"].contains($0.uuidString) }
        guard isScale, selectedDevice == nil || selectedDevice == peripheral.identifier.uuidString.uppercased() else { return }
        var event: [String: Any] = ["event": "advertisement", "device_id": peripheral.identifier.uuidString,
            "name": name, "rssi_dbm": RSSI, "service_data": Dictionary(uniqueKeysWithValues: services.map { ($0.key.uuidString, hex($0.value)) }),
            "services": (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []).map { $0.uuidString },
            "connectable": advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber ?? false]
        if let data = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data { event["manufacturer_data"] = hex(data) }
        emit(event)
        if inspect && target == nil {
            target = peripheral; peripheral.delegate = self
            central.connect(peripheral)
        }
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        emit(["event": "connected", "device_id": peripheral.identifier.uuidString]); peripheral.discoverServices(nil)
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        emit(["event": "connection_error", "error": error?.localizedDescription ?? "unknown"])
        target = nil
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        emit(["event": "disconnected", "device_id": peripheral.identifier.uuidString])
        target = nil
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error = error { emit(["event": "error", "error": error.localizedDescription]); return }
        for service in peripheral.services ?? [] { peripheral.discoverCharacteristics(nil, for: service) }
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error = error { emit(["event": "error", "error": error.localizedDescription]); return }
        for c in service.characteristics ?? [] {
            emit(["event": "characteristic", "service": service.uuid.uuidString, "uuid": c.uuid.uuidString,
                  "properties": c.properties.rawValue])
            if c.properties.contains(.read) { peripheral.readValue(for: c) }
            if c.uuid.uuidString == "2A9C" { peripheral.setNotifyValue(true, for: c) }
            if history && c.uuid.uuidString == "00002A2F-0000-3512-2118-0009AF100700" {
                peripheral.setNotifyValue(true, for: c)
            }
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor c: CBCharacteristic, error: Error?) {
        var event: [String: Any] = ["event": "subscription", "uuid": c.uuid.uuidString, "enabled": c.isNotifying]
        if let error = error { event["error"] = error.localizedDescription }
        emit(event)
        if history && c.isNotifying && c.uuid.uuidString == "00002A2F-0000-3512-2118-0009AF100700" {
            // openScale's ALL request; omit final 04 ACK to avoid committing a sync cursor.
            historyCommands = [Data([1, 0x96, 0x8a, 0xbd, 0x62]), Data([1, 0, 0, 0x43, 0x44]), Data([2])]
            sendNextHistory(peripheral, c)
        }
    }
    func sendNextHistory(_ peripheral: CBPeripheral, _ c: CBCharacteristic) {
        guard !historyCommands.isEmpty else { return }
        let data = historyCommands.removeFirst()
        emit(["event": "history_request", "uuid": c.uuid.uuidString, "hex": hex(data)])
        peripheral.writeValue(data, for: c, type: .withResponse)
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        if let error = error { emit(["event": "write_error", "uuid": c.uuid.uuidString, "error": error.localizedDescription]); historyCommands = []; return }
        emit(["event": "write_ack", "uuid": c.uuid.uuidString])
        sendNextHistory(peripheral, c)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        var event: [String: Any] = ["event": "read", "service": c.service?.uuid.uuidString ?? "", "uuid": c.uuid.uuidString]
        if let error = error { event["error"] = error.localizedDescription }
        if let data = c.value {
            event["hex"] = hex(data)
            if let value = String(data: data, encoding: .utf8), value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) { event["text"] = value }
        }
        emit(event)
        if history && !historyEnded && c.uuid.uuidString == "00002A2F-0000-3512-2118-0009AF100700" && c.value == Data([3]) {
            historyEnded = true
            historyCommands = [Data([3])]
            sendNextHistory(peripheral, c)
            emit(["event": "history_finished", "sync_cursor_ack_sent": false])
        }
    }
}
let seconds = Double(CommandLine.arguments.dropFirst().first ?? "90") ?? 90
let scanner = Scanner()
if seconds > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
    scanner.central.stopScan()
    if let target = scanner.target { scanner.central.cancelPeripheralConnection(target) }
    emit(["event": "finished"]); exit(0)
} }
RunLoop.main.run()
