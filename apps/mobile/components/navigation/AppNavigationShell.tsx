import { useEffect, useState, type ReactNode } from "react";
import { Alert, BackHandler, Modal, Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { resolvePermission } from "../../domain/permissions";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";
import { authenticatedHome, visibleMoreRoutes } from "../../navigation/routes";

function NavButton({
  label,
  icon,
  active,
  locked,
  onPress,
}: {
  label: string;
  icon: string;
  active?: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center justify-center gap-0.5"
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
    >
      <Text className={`text-lg ${locked ? "opacity-30" : ""}`}>{icon}</Text>
      <Text
        numberOfLines={1}
        className={`font-sans text-[10px] ${locked ? "text-midGray opacity-50" : active ? "font-sans-bold text-brand-green" : "text-midGray"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AppNavigationShell({ children }: { children: ReactNode }) {
  const session = useSessionStore((state) => state.session);
  const pathname = usePathname();
  const { t } = useI18n();
  const [moreContext, setMoreContext] = useState<{
    pathname: string;
    userId: string;
  } | null>(null);
  const moreOpen = Boolean(
    moreContext &&
    moreContext.pathname === pathname &&
    moreContext.userId === session?.userId,
  );

  useEffect(() => {
    if (!moreOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setMoreContext(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [moreOpen]);

  if (
    !session ||
    pathname === "/" ||
    pathname.startsWith("/role-select") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/otp-verify") ||
    pathname.startsWith("/pin-setup") ||
    pathname.startsWith("/pin-login") ||
    pathname.startsWith("/forgot-pin") ||
    pathname.startsWith("/device-login")
  ) {
    return <>{children}</>;
  }

  const moreRoutes = visibleMoreRoutes(session);
  const hasMore = moreRoutes.length > 0;
  const home = authenticatedHome(session);
  const canSale = resolvePermission(
    session.role,
    "sale_entry",
    session.permissions,
  );
  const canInventory = resolvePermission(
    session.role,
    "inventory_view",
    session.permissions,
  );
  const canCredit = resolvePermission(
    session.role,
    "credit_view",
    session.permissions,
  );
  const deny = () => Alert.alert(t("accessDenied"), t("askOwner"));
  const go = (href: Parameters<typeof router.replace>[0], allowed = true) =>
    allowed ? router.replace(href) : deny();

  return (
    <View className="flex-1">
      {children}
      <Modal
        visible={moreOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreContext(null)}
      >
        <Pressable
          onPress={() => setMoreContext(null)}
          className="flex-1 bg-black/25"
        >
          <View className="absolute bottom-20 right-3 w-72 rounded-2xl bg-white p-4">
            <Text className="mb-3 font-sans-semibold text-xs uppercase text-midGray">
              {t("moreOptions")}
            </Text>
            <View className="flex-row flex-wrap">
              {moreRoutes.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    setMoreContext(null);
                    router.push(item.href);
                  }}
                  className="w-1/4 items-center gap-1 p-2"
                >
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-brand-softGreen">
                    <Text>•</Text>
                  </View>
                  <Text
                    numberOfLines={2}
                    className="text-center font-sans text-[10px] text-richBlack"
                  >
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
      <View className="absolute bottom-0 left-0 right-0 h-20 flex-row border-t border-midGray bg-white pt-1">
        <NavButton
          label={t("home")}
          icon="⌂"
          active={pathname === home}
          onPress={() => go(home)}
        />
        <NavButton
          label={t("sale")}
          icon="▣"
          active={pathname.startsWith("/sale")}
          locked={!canSale}
          onPress={() => go("/sale", canSale)}
        />
        <View className="flex-1 items-center">
          <Pressable
            onPress={() => go("/scan" as never, canSale)}
            className="-mt-7 h-20 w-20 items-center justify-center rounded-full bg-brand-green"
            accessibilityLabel={t("scan")}
          >
            <Text className="text-2xl text-white">⌗</Text>
            <Text className="font-sans-bold text-[10px] text-white">
              {t("scan")}
            </Text>
          </Pressable>
        </View>
        <NavButton
          label={t("inventory")}
          icon="▤"
          active={pathname.startsWith("/inventory")}
          locked={!canInventory}
          onPress={() => go("/inventory", canInventory)}
        />
        {hasMore ? (
          <NavButton
            label={t("more")}
            icon="•••"
            active={
              moreOpen ||
              moreRoutes.some((item) => pathname.startsWith(String(item.href)))
            }
            onPress={() =>
              setMoreContext(
                moreOpen ? null : { pathname, userId: session.userId },
              )
            }
          />
        ) : (
          <NavButton
            label={t("credit")}
            icon="▥"
            active={pathname.startsWith("/credit")}
            locked={!canCredit}
            onPress={() => go("/credit/credit-sales", canCredit)}
          />
        )}
      </View>
    </View>
  );
}
