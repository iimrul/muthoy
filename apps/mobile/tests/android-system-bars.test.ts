import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Styles {
  resources: { style: { $: { name: string; parent?: string }; item: { $: { name: string }; _: string }[] }[] };
}
const require = createRequire(import.meta.url);
const { applyLightSystemBars } = require("../plugins/withAndroidLightSystemBars.js") as {
  applyLightSystemBars: (styles: Styles) => Styles;
};
describe("Android light-surface dialog defaults", () => {
  it("adds the native status icon default without losing existing theme settings and is idempotent", () => {
    const styles: Styles = { resources: { style: [
      { $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" }, item: [
        { $: { name: "android:statusBarColor" }, _: "@android:color/transparent" },
      ] },
      { $: { name: "OtherTheme" }, item: [{ $: { name: "unrelated" }, _: "retain" }] },
    ] } };
    const result = applyLightSystemBars(structuredClone(styles));
    const theme = result.resources.style.find(style => style.$.name === "AppTheme")!;
    expect(theme.$.parent).toBe("Theme.AppCompat.DayNight.NoActionBar");
    expect(theme.item).toContainEqual({ $: { name: "android:windowLightStatusBar" }, _: "true" });
    expect(theme.item).toContainEqual(styles.resources.style[0]!.item[0]);
    expect(result.resources.style[1]).toEqual(styles.resources.style[1]);
    expect(applyLightSystemBars(structuredClone(result))).toEqual(result);
  });
  it("is wired into the shipping Expo config alongside unchanged SQLCipher and backup protection", () => {
    const config = JSON.parse(readFileSync("apps/mobile/app.json", "utf8")) as {
      expo: { plugins: (string | [string, unknown])[] };
    };
    expect(config.expo.plugins).toContain("./plugins/withAndroidLightSystemBars");
    expect(config.expo.plugins).toContain("./plugins/withAndroidBackupProtection");
    expect(config.expo.plugins).toContainEqual(["expo-sqlite", { android: { useSQLCipher: true }, ios: { useSQLCipher: true } }]);
  });
});
