require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'MuthoyDbKey'
  s.version = package['version']
  s.summary = 'Apple implementation of the existing MuthoyDbKey API'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Muthoy'
  s.homepage = 'https://muthoy.com'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Security', 'CryptoKit'
  s.source_files = '**/*.swift'
  s.exclude_files = 'Tests/**/*'
  s.test_spec 'ContractTests' do |test|
    test.source_files = 'Tests/**/*.swift'
    test.frameworks = 'XCTest'
    test.requires_app_host = true
  end
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
