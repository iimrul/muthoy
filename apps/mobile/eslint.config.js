// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const sharedBase = require('@muthoy/config/eslint/base.js');

module.exports = defineConfig([
  expoConfig,
  ...sharedBase.rules,
  {
    ignores: ["dist/*"],
  }
]);
