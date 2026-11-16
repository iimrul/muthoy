const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

// Product sheets use light surfaces even when Android uses dark appearance.
// Keep new native dialog windows readable before runtime route styling applies.
function applyLightSystemBars(styles) {
  return AndroidConfig.Styles.assignStylesValue(styles, {
    add: true,
    parent: AndroidConfig.Styles.getAppThemeGroup(),
    name: 'android:windowLightStatusBar',
    value: 'true',
  });
}

module.exports = (config) => withAndroidStyles(config, (modConfig) => {
  modConfig.modResults = applyLightSystemBars(modConfig.modResults);
  return modConfig;
});
module.exports.applyLightSystemBars = applyLightSystemBars;
