import CoreBluetooth
import ExpoModulesCore
import Foundation

/// Apple implementation of the existing scan/print API. No receipt formatting,
/// money calculations or database writes belong in this transport.
public final class MuthoyBlePrinterModule: Module {
  private var transport: AppleBlePrinter?

  private func printer() -> AppleBlePrinter {
    if let transport { return transport }
    let created = AppleBlePrinter()
    transport = created
    return created
  }

  public func definition() -> ModuleDefinition {
    Name("MuthoyBlePrinter")
    AsyncFunction("scanAsync") { (timeoutMs: Double, promise: Promise) in
      self.printer().scan(timeoutMs: timeoutMs, promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("printAsync") { (deviceId: String, payload: String, promise: Promise) in
      self.printer().print(deviceId: deviceId, payload: payload, promise: promise)
    }.runOnQueue(.main)
    OnDestroy {
      let existing = self.transport
      DispatchQueue.main.async { existing?.cancel() }
    }
  }
}

private final class AppleBlePrinter: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private enum Operation {
    case scan
    case print(UUID, Data)
  }
  private var manager: CBCentralManager?
  private var promise: Promise?
  private var operation: Operation?
  private var drain: DispatchWorkItem?
  private var timeout: DispatchWorkItem?
  private var discovered: [String: [String: Any]] = [:]
  private var peripheral: CBPeripheral?
  private var characteristic: CBCharacteristic?
  private var remainingServices = 0
  private var offset = 0
  private var waitingForWrite = false

  func scan(timeoutMs: Double, promise: Promise) {
    guard timeoutMs.isFinite else {
      promise.reject("SCAN_FAILED", "Invalid Bluetooth scan duration")
      return
    }
    begin(.scan, seconds: min(12, max(1.5, timeoutMs / 1000)), promise: promise)
  }

  func print(deviceId: String, payload: String, promise: Promise) {
    guard let id = UUID(uuidString: deviceId), let data = Data(base64Encoded: payload), !data.isEmpty else {
      promise.reject("UNSUPPORTED", "Invalid printer identifier or print payload")
      return
    }
    begin(.print(id, data), seconds: 20, promise: promise)
  }

  func cancel() { fail("CANCELLED", "Bluetooth operation cancelled") }

  private func begin(_ operation: Operation, seconds: Double, promise: Promise) {
    guard self.promise == nil else {
      promise.reject("BUSY", "Another Bluetooth operation is in progress")
      return
    }
    self.promise = promise
    self.operation = operation
    discovered.removeAll()
    offset = 0
    waitingForWrite = false
    let timer = DispatchWorkItem { [weak self] in
      guard let self, self.promise != nil else { return }
      if case .scan? = self.operation, self.manager?.state == .poweredOn {
        self.succeed(Array(self.discovered.values))
      } else {
        self.fail("OUT_OF_RANGE", "Bluetooth operation timed out")
      }
    }
    timeout = timer
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: timer)
    if manager == nil {
      manager = CBCentralManager(delegate: self, queue: .main)
    } else {
      continueWhenPowered()
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central === manager, promise != nil else { return }
    continueWhenPowered()
  }

  private func continueWhenPowered() {
    guard let manager, promise != nil else { return }
    switch manager.state {
    case .unauthorized: fail("PERMISSION_DENIED", "Bluetooth permission was denied")
    case .unsupported: fail("UNSUPPORTED", "Bluetooth is not supported")
    case .poweredOff: fail("DISCONNECTED", "Bluetooth is turned off")
    case .poweredOn:
      guard peripheral == nil, !manager.isScanning else { return }
      if case let .print(id, _)? = operation,
         let known = manager.retrievePeripherals(withIdentifiers: [id]).first {
        connect(known)
      } else {
        manager.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
      }
    case .unknown, .resetting: break // Bounded timer also covers permission/state transitions.
    @unknown default: fail("UNSUPPORTED", "Unknown Bluetooth state")
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover device: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard central === manager, promise != nil else { return }
    if case .scan? = operation {
      discovered[device.identifier.uuidString] = [
        "id": device.identifier.uuidString,
        "name": device.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "BLE Printer",
        "rssi": RSSI.intValue,
      ]
    } else if case let .print(id, _)? = operation, device.identifier == id {
      connect(device)
    }
  }

  private func connect(_ device: CBPeripheral) {
    guard peripheral == nil, let manager else { return }
    manager.stopScan()
    peripheral = device
    device.delegate = self
    manager.connect(device, options: nil)
  }

  func centralManager(_ central: CBCentralManager, didConnect device: CBPeripheral) {
    guard central === manager, device === peripheral, promise != nil else { return }
    device.discoverServices(nil)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect device: CBPeripheral, error: Error?) {
    guard central === manager, device === peripheral else { return }
    fail("CONNECTION_FAILED", "Could not connect to printer")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral device: CBPeripheral, error: Error?) {
    guard central === manager, device === peripheral, promise != nil else { return }
    fail("DISCONNECTED", "Printer disconnected")
  }

  func peripheral(_ device: CBPeripheral, didDiscoverServices error: Error?) {
    guard device === peripheral, promise != nil else { return }
    guard error == nil, let services = device.services, !services.isEmpty else {
      fail("UNSUPPORTED", "Printer services are unavailable")
      return
    }
    remainingServices = services.count
    for service in services { device.discoverCharacteristics(nil, for: service) }
  }

  func peripheral(_ device: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard device === peripheral, promise != nil, characteristic == nil else { return }
    remainingServices -= 1
    if error == nil, let writable = service.characteristics?.first(where: {
      $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse)
    }) {
      characteristic = writable
      sendNext()
    } else if remainingServices == 0 {
      fail("UNSUPPORTED", "Printer has no writable BLE characteristic")
    }
  }

  private func sendNext() {
    guard let device = peripheral, let characteristic,
          case let .print(_, bytes)? = operation, promise != nil, !waitingForWrite else { return }
    let type: CBCharacteristicWriteType = characteristic.properties.contains(.write) ? .withResponse : .withoutResponse
    let maximum = device.maximumWriteValueLength(for: type)
    guard maximum > 0 else { fail("UNSUPPORTED", "Printer has no usable write size"); return }
    while offset < bytes.count {
      if type == .withoutResponse && !device.canSendWriteWithoutResponse { return }
      let end = min(offset + min(180, maximum), bytes.count)
      let chunk = bytes.subdata(in: offset..<end)
      offset = end
      waitingForWrite = type == .withResponse
      device.writeValue(chunk, for: characteristic, type: type)
      if waitingForWrite { return }
    }
    if type == .withoutResponse {
      // CoreBluetooth exposes flow control, not per-write acknowledgments.
      // Keep the connection alive for a bounded drain interval after the final
      // enqueue. A disconnect/error/timeout during it still rejects the print.
      guard device.canSendWriteWithoutResponse, drain == nil else { return }
      let completion = DispatchWorkItem { [weak self, weak device] in
        guard let self, let device, device === self.peripheral,
          self.promise != nil else { return }
        guard device.canSendWriteWithoutResponse else {
          self.drain = nil
          return
        }
        self.succeed(nil)
      }
      drain = completion
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: completion)
      return
    }
    // With-response completion follows the final didWriteValue callback.
    // Transport acceptance never asserts that paper was produced.
    succeed(nil)
  }

  func peripheral(_ device: CBPeripheral, didWriteValueFor target: CBCharacteristic, error: Error?) {
    guard device === peripheral, target === characteristic, promise != nil, waitingForWrite else { return }
    if error != nil { fail("SEND_FAILED", "Printer rejected data"); return }
    waitingForWrite = false
    sendNext()
  }

  func peripheralIsReady(toSendWriteWithoutResponse device: CBPeripheral) {
    guard device === peripheral, promise != nil else { return }
    sendNext()
  }

  private func succeed(_ value: Any?) {
    let pending = promise
    cleanup()
    pending?.resolve(value)
  }

  private func fail(_ code: String, _ message: String) {
    let pending = promise
    cleanup()
    pending?.reject(code, message)
  }

  private func cleanup() {
    promise = nil
    operation = nil
    drain?.cancel()
    drain = nil
    timeout?.cancel()
    timeout = nil
    manager?.stopScan()
    if let device = peripheral {
      device.delegate = nil
      manager?.cancelPeripheralConnection(device)
    }
    // A new operation gets a new manager. Late disconnect/scan callbacks from
    // this completed manager cannot fail a subsequent bounded JS retry.
    manager?.delegate = nil
    manager = nil
    peripheral = nil
    characteristic = nil
    remainingServices = 0
    offset = 0
    waitingForWrite = false
  }
}
