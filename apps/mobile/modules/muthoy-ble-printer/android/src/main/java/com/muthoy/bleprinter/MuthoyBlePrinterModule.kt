package com.muthoy.bleprinter

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

class MuthoyBlePrinterModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private fun context() = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
  private fun adapter(): BluetoothAdapter = (context().getSystemService(android.content.Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    ?: throw IllegalStateException("Bluetooth is not supported")
  private fun requirePermission() {
    val permission = if (Build.VERSION.SDK_INT >= 31) Manifest.permission.BLUETOOTH_SCAN else Manifest.permission.ACCESS_FINE_LOCATION
    if (ContextCompat.checkSelfPermission(context(), permission) != PackageManager.PERMISSION_GRANTED) throw SecurityException("Bluetooth permission denied")
    if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(context(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) throw SecurityException("Bluetooth connect permission denied")
  }

  override fun definition() = ModuleDefinition {
    Name("MuthoyBlePrinter")
    AsyncFunction("scanAsync") { timeoutMs: Int, promise: Promise ->
      try {
        requirePermission(); val bluetooth = adapter(); if (!bluetooth.isEnabled) throw IllegalStateException("Bluetooth is turned off")
        val found = linkedMapOf<String, Map<String, Any>>(); val completed = AtomicBoolean(false)
        val callback = object : ScanCallback() {
          override fun onScanResult(type: Int, result: ScanResult) {
            try { val id = result.device.address; found[id] = mapOf("id" to id, "name" to (result.device.name ?: result.scanRecord?.deviceName ?: "BLE Printer"), "rssi" to result.rssi) } catch (_: SecurityException) { }
          }
          override fun onScanFailed(code: Int) { if (completed.compareAndSet(false, true)) promise.reject("SCAN_FAILED", "Bluetooth scan failed ($code)", null) }
        }
        bluetooth.bluetoothLeScanner.startScan(callback)
        handler.postDelayed({ if (completed.compareAndSet(false, true)) { try { bluetooth.bluetoothLeScanner.stopScan(callback) } catch (_: Exception) { }; promise.resolve(found.values.toList()) } }, timeoutMs.coerceIn(1500, 12000).toLong())
      } catch (error: Exception) { promise.reject("SCAN_FAILED", error.message ?: "Bluetooth scan failed", error) }
    }
    AsyncFunction("printAsync") { deviceId: String, payload: String, promise: Promise ->
      try {
        requirePermission(); val bluetooth = adapter(); if (!bluetooth.isEnabled) throw IllegalStateException("Bluetooth is turned off")
        val bytes = Base64.decode(payload, Base64.DEFAULT); val device = bluetooth.getRemoteDevice(deviceId)
        val done = AtomicBoolean(false); var gatt: BluetoothGatt? = null; var characteristic: BluetoothGattCharacteristic? = null; var offset = 0
        fun fail(code: String, message: String) { if (done.compareAndSet(false, true)) { try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) { }; promise.reject(code, message, null) } }
        lateinit var sendNext: () -> Unit
        sendNext = {
          val target = characteristic
          if (target == null) fail("UNSUPPORTED", "No writable BLE characteristic")
          else if (offset >= bytes.size) { if (done.compareAndSet(false, true)) { try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) { }; promise.resolve(null) } }
          else {
            val end = minOf(offset + 180, bytes.size); val chunk = bytes.copyOfRange(offset, end); offset = end
            val noResponse = target.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0 && target.properties and BluetoothGattCharacteristic.PROPERTY_WRITE == 0
            val accepted = if (Build.VERSION.SDK_INT >= 33) gatt?.writeCharacteristic(target, chunk, if (noResponse) BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
              else { target.writeType = if (noResponse) BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT; target.value = chunk; gatt?.writeCharacteristic(target) == true }
            if (!accepted) fail("SEND_FAILED", "Printer rejected data") else if (noResponse) handler.postDelayed(sendNext, 25)
          }
        }
        val callback = object : BluetoothGattCallback() {
          override fun onConnectionStateChange(current: BluetoothGatt, status: Int, state: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) fail("OUT_OF_RANGE", "Could not connect to printer")
            else if (state == BluetoothProfile.STATE_CONNECTED) current.discoverServices()
            else if (state == BluetoothProfile.STATE_DISCONNECTED && !done.get()) fail("DISCONNECTED", "Printer disconnected")
          }
          override fun onServicesDiscovered(current: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) { fail("UNSUPPORTED", "Printer services unavailable"); return }
            characteristic = current.services.asSequence().flatMap { it.characteristics.asSequence() }.firstOrNull { it.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0 }
            if (characteristic == null) fail("UNSUPPORTED", "No writable BLE characteristic") else sendNext()
          }
          override fun onCharacteristicWrite(current: BluetoothGatt, target: BluetoothGattCharacteristic, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) sendNext() else fail("SEND_FAILED", "Printer write failed ($status)")
          }
        }
        gatt = if (Build.VERSION.SDK_INT >= 23) device.connectGatt(context(), false, callback, BluetoothDevice.TRANSPORT_LE) else device.connectGatt(context(), false, callback)
        handler.postDelayed({ if (!done.get()) fail("OUT_OF_RANGE", "Printer connection timed out") }, 20_000)
      } catch (error: SecurityException) { promise.reject("PERMISSION_DENIED", error.message ?: "Bluetooth permission denied", error) }
      catch (error: Exception) { promise.reject("CONNECTION_FAILED", error.message ?: "Printer connection failed", error) }
    }
  }
}
