require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'MuthoyBlePrinter'
  s.version = package['version']
  s.summary = 'Native BLE transport for the existing Muthoy ESC/POS printer API'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Muthoy'
  s.homepage = 'https://muthoy.com'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
