import { View } from "react-native";
import { router } from "expo-router";
import { LiveStripScanner } from "../components/scanner/LiveStripScanner";
import { useSessionStore } from "../state/sessionStore";

// app/scan.tsx — the dedicated scan-to-sell screen.
//
// Live: strips brought in front of the camera go straight into the cart, one
// unit per appearance (founder decision 2026-11-20, which replaced the W2-01
// confirmation sheet here and on the Sale tab — both now render the SAME
// LiveStripScanner, so the two paths cannot disagree about what a scan means).
//
// Every exit REPLACES this route rather than pushing over it: the scanner is a
// native modal, and a route pushed on top of a still-mounted modal would open
// underneath it.
export default function ScanSaleScreen() {
  const session = useSessionStore((state) => state.session);
  if (!session) return null;

  return (
    <View className="flex-1 bg-richBlack">
      <LiveStripScanner
        visible
        shopId={session.shopId}
        userId={session.userId}
        onClose={() => router.back()}
        onDone={() => router.replace("/sale/cart")}
        onManualSearch={() => router.dismissTo("/sale")}
      />
    </View>
  );
}
