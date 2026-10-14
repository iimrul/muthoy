const { selectEnvironment, POLICY_VERSION } = require('./config/environmentPolicy');
const base = require('./app.json').expo;

module.exports = () => {
  const appVariant = process.env.APP_VARIANT;
  const policy = selectEnvironment(appVariant);
  // Identity-only EAS discovery precedes loading the selected hosted variables.
  // Preserve every static plugin/native/security setting from the merge base.
  return {
    ...base,
    // Side-by-side installs must never look like the production app.
    name: policy.displayName,
    scheme: policy.scheme,
    android: { ...base.android, package: policy.nativeApplicationId },
    ios: { ...base.ios, bundleIdentifier: policy.nativeApplicationId },
    extra: { ...base.extra, appVariant, nativeApplicationId: policy.nativeApplicationId, supabaseProjectRef: policy.supabaseProjectRef, environmentPolicyVersion: POLICY_VERSION },
  };
};
