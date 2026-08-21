import { Pressable, Text, View } from "react-native";
import {
  PERMISSION_GROUPS,
  type Permission,
  type PermissionOverrides,
} from "../../domain/permissions";
import type { CatalogKey } from "../../i18n/catalog";
import { useI18n } from "../../state/localeStore";

const LABELS: Readonly<Record<Permission, CatalogKey>> = {
  sale_entry: "processSales",
  sale_discount: "applyDiscounts",
  sale_return: "processReturns",
  sale_history: "viewSalesHistory",
  inventory_view: "viewStock",
  inventory_edit: "updateStock",
  expiry_manage: "manageExpiry",
  credit_view: "viewCredit",
  credit_manage: "manageCredit",
  cash_drawer: "cashDrawer",
  reports: "viewReports",
  staff_manage: "manageStaff",
};

const GROUP_LABELS: Readonly<
  Record<(typeof PERMISSION_GROUPS)[number]["key"], CatalogKey>
> = {
  sales: "salesGroup",
  inventory: "inventoryGroup",
  credit_cash: "creditCashGroup",
  management: "managementGroup",
};

export function PermissionMatrix({
  value,
  onChange,
  editable = true,
}: {
  value: PermissionOverrides;
  onChange: (value: PermissionOverrides) => void;
  editable?: boolean;
}) {
  const { t } = useI18n();
  return (
    <View className="gap-3">
      {PERMISSION_GROUPS.map((group) => {
        const allEnabled = group.permissions.every((key) =>
          Boolean(value[key]),
        );
        return (
          <View
            key={group.key}
            className="gap-2 rounded-xl bg-brand-softGreen p-3"
          >
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-sm">
                {t(GROUP_LABELS[group.key])}
              </Text>
              {editable ? (
                <Pressable
                  onPress={() =>
                    onChange({
                      ...value,
                      ...Object.fromEntries(
                        group.permissions.map((key) => [key, !allEnabled]),
                      ),
                    })
                  }
                >
                  <Text className="font-sans-semibold text-xs text-brand-green">
                    {t(allEnabled ? "disableAll" : "enableAll")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {group.permissions.map((key) => (
              <Pressable
                key={key}
                disabled={!editable}
                onPress={() => onChange({ ...value, [key]: !value[key] })}
                className="flex-row items-center justify-between py-1"
              >
                <Text className="font-sans text-sm text-richBlack">
                  {t(LABELS[key])}
                </Text>
                <View
                  className={`h-6 w-11 rounded-full p-0.5 ${value[key] ? "bg-brand-green" : "bg-midGray"}`}
                >
                  <View
                    className={`h-5 w-5 rounded-full bg-white ${value[key] ? "self-end" : "self-start"}`}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}
