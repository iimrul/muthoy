import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { router, usePathname } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { resolvePermission } from "../../domain/permissions";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";
import { useMultiShopAccess } from "../../state/useMultiShopAccess";
import { authenticatedHome, visibleMoreRoutes } from "../../navigation/routes";

function NavButton({
  label,
  icon,
  glyph,
  active,
  locked,
  onPress,
}: {
  label: string;
  icon?: ComponentProps<typeof Feather>["name"];
  glyph?: string;
  active?: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="relative flex-1 items-center justify-center gap-1"
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
    >
      {active && !locked ? (
        <View className="absolute top-0 h-1 w-12 rounded-b-full bg-brand-green" />
      ) : null}
      <View className="relative">
        {icon ? (
          <Feather
            name={icon}
            size={20}
            strokeWidth={2}
            color={locked ? "#D1D5DB" : active ? "#059669" : "#6B7280"}
          />
        ) : (
          <Text
            className={`text-lg ${locked ? "text-[#D1D5DB]" : active ? "text-brand-green" : "text-midGray"}`}
          >
            {glyph}
          </Text>
        )}
        {locked ? (
          <Feather
            name="lock"
            size={9}
            strokeWidth={2.5}
            color="#9CA3AF"
            style={{ position: "absolute", right: -8, top: -4 }}
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        className={`px-1 font-sans text-xs ${locked ? "text-[#D1D5DB]" : active ? "font-sans-bold text-brand-green" : "text-midGray"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AnimatedScanButton({
  label,
  locked,
  onPress,
}: {
  label: string;
  locked: boolean;
  onPress: () => void;
}) {
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <View className="flex-1 items-center">
      <Animated.View
        pointerEvents="none"
        className="absolute -top-7 h-20 w-20 rounded-full border-4 border-brand-green"
        style={{
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.35, 0],
          }),
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.2],
              }),
            },
          ],
        }}
      />
      <Animated.View
        className="-mt-7 h-20 w-20 rounded-full"
        style={{
          opacity: locked ? 0.45 : 1,
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.035],
              }),
            },
          ],
          shadowColor: "#059669",
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.5,
          shadowRadius: 16,
          elevation: 12,
        }}
      >
        <Pressable
          onPress={onPress}
          className="h-20 w-20 items-center justify-center rounded-full border-4 border-[#6EE7B7]/30 bg-brand-deepGreen active:scale-95"
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: locked }}
        >
          <MaterialCommunityIcons
            name="line-scan"
            size={37}
            color="#FFFFFF"
          />
          <Text className="-mt-1 font-sans-bold text-[11px] text-white">
            {label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function AppNavigationShell({ children }: { children: ReactNode }) {
  const session = useSessionStore((state) => state.session);
  const multiShop = useMultiShopAccess();
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

  const moreRoutes = visibleMoreRoutes(
    session,
    multiShop.allowed && multiShop.hasMultipleShops,
  );
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
  const openMoreRoute = (href: Parameters<typeof router.push>[0]) => {
    // Dispatch the push FIRST, then close the sheet. Deferring the push behind
    // InteractionManager made it depend on the scan button's infinite
    // Animated.loop draining, and closing the Modal first put a native
    // dismissal between the press and the navigation. Both were ordering
    // workarounds for a bug that was really NavigationBoundary unmounting the
    // Stack; the push itself is synchronous and needs neither.
    router.push(href);
    setMoreContext(null);
  };

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
                  onPress={() => openMoreRoute(item.href)}
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
      <View
        className="absolute bottom-0 left-0 right-0 h-20 flex-row border-t border-[#E5E7EB] bg-white"
        style={{
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 14,
        }}
      >
        <NavButton
          label={t("home")}
          icon="home"
          active={pathname === home}
          onPress={() => go(home)}
        />
        <NavButton
          label={t("sale")}
          icon="shopping-bag"
          active={pathname.startsWith("/sale")}
          locked={!canSale}
          onPress={() => go("/sale", canSale)}
        />
        <AnimatedScanButton
          label={t("scan")}
          locked={!canSale}
          onPress={() => go("/scan" as never, canSale)}
        />
        <NavButton
          label={t("inventory")}
          icon="package"
          active={pathname.startsWith("/inventory")}
          locked={!canInventory}
          onPress={() => go("/inventory", canInventory)}
        />
        {hasMore ? (
          <NavButton
            label={t("more")}
            glyph="•••"
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
            icon="credit-card"
            active={pathname.startsWith("/credit")}
            locked={!canCredit}
            onPress={() => go("/credit/credit-sales", canCredit)}
          />
        )}
      </View>
    </View>
  );
}
