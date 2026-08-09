import { Outlet, useLocation, useNavigation } from "react-router";
import {
  Home, ShoppingBag, Package, CreditCard, FileText, ScanLine,
  Receipt, FileStack, Truck, Users, BarChart2, ClipboardList, Lock, Store,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState, useMemo, useCallback, memo } from "react";
import { StaffActiveCheck } from "./StaffActiveCheck";
import { useNavigate } from "../utils/navigation";
import { prefetchRoute } from "../router";
import { hasMultipleShops } from "../utils/shopManager";

export function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user, staff, isOwner, hasPermission, isAuthenticated } = useAuth();

  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  const showAccessDenied = useCallback(() => {
    toast.error(
      t("আপনার এই ফিচারে অ্যাক্সেস নেই", "You don't have access to this feature"),
      {
        description: t("অনুমতির জন্য মালিকের সাথে যোগাযোগ করুন", "Please contact the owner for access"),
        duration: 3500,
      }
    );
  }, [t]);

  // Determine if current user is staff
  const isStaff = !user && !!staff;

  // Authentication check - redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      // Determine which login page based on auth type
      const authType = localStorage.getItem('authType');
      if (authType === 'staff') {
        navigate("/staff-login", { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [isAuthenticated, navigate]);

  // Route protection logic
  useEffect(() => {
    // Skip if not authenticated (handled by previous useEffect)
    if (!isAuthenticated) return;

    const currentPath = location.pathname;

    // Define route permissions (aligned with 12-key permission schema)
    type PermKey =
      | "sale_entry" | "sale_discount" | "sale_return" | "sale_history"
      | "inventory_view" | "inventory_edit" | "expiry_manage"
      | "credit_view" | "credit_manage" | "cash_drawer"
      | "reports" | "staff_manage";
    const routePermissions: Record<string, { permission?: PermKey, ownerOnly?: boolean, staffOnly?: boolean }> = {
      "/app": { ownerOnly: true },
      "/app/staff-home": { staffOnly: true },
      "/app/sale": { permission: "sale_entry" },
      "/app/cart": { permission: "sale_entry" },
      "/app/checkout": { permission: "sale_entry" },
      "/app/inventory": { permission: "inventory_view" },
      "/app/expiry": { permission: "expiry_manage" },
      "/app/add-medicine": { permission: "inventory_edit" },
      "/app/credit": { permission: "credit_view" },
      "/app/report": { permission: "reports" },
      "/app/end-of-day": { permission: "cash_drawer" },
      "/app/monthly-report": { permission: "reports" },
      "/app/cash-summary": { permission: "cash_drawer" },
      "/app/staff": { permission: "staff_manage" },
      "/app/staff-sales": { ownerOnly: true },
      "/app/sales-history": { permission: "sale_history" },
      "/app/expense": { ownerOnly: true },
      "/app/invoices": { ownerOnly: true },
      "/app/suppliers": { ownerOnly: true },
      "/app/multi-shop": { ownerOnly: true },
    };

    const currentRoute = routePermissions[currentPath];
    
    // Scanner is global, allow it
    if (currentPath === "/app/scan") {
      return;
    }

    // If route requires permissions, check them
    if (currentRoute) {
      // Check staff-only routes
      if (currentRoute.staffOnly && isOwner) {
        navigate("/app", { replace: true });
        return;
      }

      // Check owner-only routes
      if (currentRoute.ownerOnly && !isOwner) {
        // Send staff to their dedicated landing page rather than a raw sale screen
        if (currentPath === "/app") {
          navigate("/app/staff-home", { replace: true });
          return;
        }
        showAccessDenied();
        // Redirect to first available page
        navigate("/app/staff-home", { replace: true });
        return;
      }

      // Check permission-based routes
      if (currentRoute.permission && !hasPermission(currentRoute.permission)) {
        showAccessDenied();
        navigate("/app/staff-home", { replace: true });
        return;
      }
    }
  }, [location.pathname, isOwner, hasPermission, navigate, isAuthenticated, showAccessDenied]);

  const allTabs = [
    {
      path: "/app",
      label: { bn: "ড্যাশবোর্ড", en: "Dashboard" },
      icon: Home,
      permission: null  // Owner only
    },
    {
      path: "/app/staff-home",
      label: { bn: "হোম", en: "Home" },
      icon: Home,
      permission: "staff-home" as const  // Always accessible to staff
    },
    {
      path: "/app/sale",
      label: { bn: "বিক্রয়", en: "Sale" },
      icon: ShoppingBag,
      permission: "sale_entry" as const
    },
    {
      path: "/app/inventory",
      label: { bn: "ইনভেন্টরি", en: "Inventory" },
      icon: Package,
      permission: "inventory_view" as const
    },
    {
      path: "/app/credit",
      label: { bn: "বাকি বিক্রয়", en: "Credit Sales" },
      icon: CreditCard,
      permission: "credit_view" as const
    },
  ];

  // Show all tabs; mark restricted ones as locked for staff
  const tabs = allTabs
    .filter(tab => {
      // Credit Sales stays hidden for owners (owner-side flow is different)
      if (tab.path === "/app/credit" && isOwner) return false;
      // Staff home only for staff, hide from owners
      if (tab.path === "/app/staff-home" && isOwner) return false;
      // Owner dashboard only for owners, hide from staff
      if (tab.path === "/app" && !isOwner) return false;
      return true;
    })
    .map(tab => {
      let locked = false;
      if (!isOwner) {
        if (tab.permission === null) locked = true; // Owner-only tabs
        else if (tab.permission === "staff-home") locked = false; // Staff home always accessible to staff
        else if (!hasPermission(tab.permission)) locked = true;
      }
      return { ...tab, locked };
    });

  const isActive = (path: string) => {
    if (path === "/app") {
      return location.pathname === "/app";
    }
    if (path === "/app/staff-home") {
      return location.pathname === "/app/staff-home";
    }
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  // ---- More group ----
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const groupTiles = useMemo(() => [
    { path: "/app/sales-history", bn: "বিক্রয় ইতিহাস", en: "Sales History", icon: ClipboardList, tint: "#FFF7ED", color: "#C2410C", permission: "sale_history" as const },
    { path: "/app/expiry",        bn: "মেয়াদ",          en: "Expiry",        icon: Package,       tint: "#FEF2F2", color: "#DC2626", permission: "expiry_manage" as const },
    { path: "/app/cash-summary",  bn: "ক্যাশ ড্রয়ার",   en: "Cash Drawer",   icon: Receipt,       tint: "#ECFDF5", color: "#059669", permission: "cash_drawer" as const },
    { path: "/app/end-of-day",    bn: "দৈনিক ক্লোজিং",         en: "End of Day",    icon: BarChart2,     tint: "#F0FDF4", color: "#15803D", permission: "cash_drawer" as const },
    { path: "/app/report",    bn: "রিপোর্ট",         en: "Report",            icon: FileText,      tint: "#ECFDF5", color: "#059669", permission: "reports" as const },
    { path: "/app/expense",   bn: "খরচ",              en: "Expense",           icon: Receipt,       tint: "#FEF3C7", color: "#B45309", ownerOnly: true },
    { path: "/app/invoices",  bn: "সাপ্লাইয়ার ইনভয়েস", en: "Supplier Invoices", icon: FileStack,     tint: "#EFF6FF", color: "#2563EB", ownerOnly: true },
    { path: "/app/suppliers", bn: "সাপ্লাইয়ার লিস্ট", en: "Suppliers",         icon: Truck,         tint: "#F5F3FF", color: "#7C3AED", ownerOnly: true },
    { path: "/app/staff",     bn: "স্টাফ",            en: "Staff",             icon: Users,         tint: "#FFF1F2", color: "#BE123C", permission: "staff_manage" as const },
    { path: "/app/staff-sales", bn: "বিক্রয় রিপোর্ট", en: "Staff Sales",      icon: BarChart2,     tint: "#F0FDF4", color: "#15803D", ownerOnly: true },
    { path: "/app/multi-shop",  bn: "দোকান ব্যবস্থাপনা", en: "Multi-Shop",      icon: Store,         tint: "#EFF6FF", color: "#1D4ED8", ownerOnly: true, multiShopOnly: true },
  ], []);

  const visibleTiles = useMemo(() => {
    // Owner sees every tile; staff sees only tiles whose permission they hold (owner-only tiles hidden).
    const tilesToShow = isOwner
      ? groupTiles
      : groupTiles.filter(tile => {
          if ((tile as any).ownerOnly) return false;
          const perm = (tile as any).permission;
          return perm ? hasPermission(perm) : false;
        });

    // Filter out multi-shop tile if owner only has one shop
    const filtered = tilesToShow.filter(tile => {
      if ((tile as any).multiShopOnly && !hasMultipleShops()) return false;
      return true;
    });

    return filtered.map(tile => ({ ...tile, locked: false }));
  }, [groupTiles, isOwner, hasPermission]);

  // Show More button whenever there are any tiles to surface for this user.
  const showMoreButton = visibleTiles.length > 0;
  const isCashier = (staff?.role || "").toLowerCase() === "cashier";
  void isCashier;
  const isGroupActive = groupTiles.some(t => location.pathname === t.path || location.pathname.startsWith(t.path + "/"));

  const handleTilePress = useCallback((path: string, locked?: boolean) => {
    if (locked) {
      showAccessDenied();
      return;
    }
    setMoreOpen(false);
    navigate(path);
  }, [navigate, showAccessDenied]);

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-[#ECFDF5]">
      {/* Staff Active Status Check - Auto logout if deactivated */}
      <StaffActiveCheck />

      {/* Top progress bar — only visible during rare cold-chunk loads */}
      {isNavigating && (
        <div className="fixed top-0 left-0 right-0 z-[100] h-[3px] overflow-hidden">
          <div
            className="h-full bg-[#059669]"
            style={{ animation: "nav-progress 1.4s ease-in-out infinite" }}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto pb-24">
        <Outlet />
      </div>

      {/* Backdrop for More panel */}
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-40 bg-black/25"
          style={{ animation: "more-backdrop-in 200ms ease-out" }}
        />
      )}

      {/* More group panel */}
      {showMoreButton && (
        <div
          className="fixed left-0 right-0 max-w-md mx-auto z-50 pointer-events-none"
          style={{ bottom: "80px" }}
        >
          <div className="relative px-3 flex justify-end">
            <div
              className={`pointer-events-auto bg-white rounded-2xl p-4 transition-all ${
                moreOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"
              }`}
              style={{
                width: "280px",
                border: "1px solid rgba(0,0,0,0.06)",
                boxShadow: "0 -8px 32px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)",
                transitionDuration: moreOpen ? "280ms" : "200ms",
                transitionTimingFunction: moreOpen ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : "ease-in",
                visibility: moreOpen ? "visible" : "hidden",
              }}
            >
              <p
                className="text-[#9CA3AF] mb-3"
                style={{
                  fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)",
                  fontSize: "12px",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                }}
              >
                {t("আরও বিকল্প", "More Options")}
              </p>
              <div className={`grid gap-2 ${visibleTiles.length <= 2 ? "grid-cols-2" : "grid-cols-4"}`}>
                {visibleTiles.map((tile, i) => {
                  const TileIcon = tile.icon;
                  const active = location.pathname === tile.path || location.pathname.startsWith(tile.path + "/");
                  const spanLarge = visibleTiles.length <= 2;
                  const locked = tile.locked;
                  return (
                    <button
                      key={tile.path}
                      onPointerDown={() => { if (!locked) prefetchRoute(tile.path); }}
                      onClick={() => handleTilePress(tile.path, locked)}
                      className="flex flex-col items-center gap-1 active:scale-[0.92] transition-transform relative"
                      style={{
                        animation: moreOpen ? `more-tile-in 360ms cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 30}ms both` : undefined,
                      }}
                      aria-disabled={locked}
                    >
                      <div
                        className={`flex items-center justify-center relative ${spanLarge ? "w-16 h-16" : "w-12 h-12"}`}
                        style={{
                          borderRadius: "12px",
                          backgroundColor: active ? "#ECFDF5" : "#F9FAFB",
                          border: active ? "1.5px solid #059669" : "1px solid #F3F4F6",
                          opacity: locked ? 0.45 : 1,
                          filter: locked ? "grayscale(0.6)" : undefined,
                        }}
                      >
                        <TileIcon
                          style={{
                            width: spanLarge ? 26 : 22,
                            height: spanLarge ? 26 : 22,
                            color: active ? "#059669" : tile.color,
                          }}
                        />
                        {locked && (
                          <div
                            className="absolute -top-1 -right-1 flex items-center justify-center bg-white rounded-full shadow-sm"
                            style={{ width: 18, height: 18, border: "1px solid #E5E7EB" }}
                          >
                            <Lock style={{ width: 10, height: 10, color: "#9CA3AF" }} strokeWidth={2.5} />
                          </div>
                        )}
                      </div>
                      <span
                        className="text-center leading-tight"
                        style={{
                          fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)",
                          fontSize: "10px",
                          fontWeight: active ? 700 : 600,
                          color: locked ? "#9CA3AF" : (active ? "#059669" : "#6B7280"),
                          maxWidth: spanLarge ? "80px" : "64px",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {t(tile.bn, tile.en)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation with Prominent OCR Button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gradient-to-t from-white via-white to-[#F9FAFB] border-t border-gray-200 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] z-40">
        <div className="relative h-20">
          {/* Navigation Grid - 5 slots: tabs left/right of center Scan, plus More on the right */}
          <div className="grid grid-cols-5 h-full">
            {(() => {
              let navTabs;

              if (isOwner) {
                navTabs = tabs;
              } else {
                // Staff: Home, Sale, Inventory, and Credit (Credit only if permitted; otherwise it falls off the slot list)
                const navbarPaths = ["/app/staff-home", "/app/sale", "/app/inventory", "/app/credit"];
                navTabs = tabs.filter(tab => navbarPaths.includes(tab.path));
              }

              // Reserve col 5 for More (when shown). Distribute navTabs across cols 1,2,4.
              const slots = showMoreButton ? [1, 2, 4] : [1, 2, 4, 5];

              return navTabs.slice(0, slots.length).map((tab, index) => {
                const Icon = tab.icon;
                const active = isActive(tab.path);
                const colStart = slots[index];
                const locked = (tab as any).locked;
                return (
                  <button
                    key={tab.path}
                    onPointerDown={() => { if (!locked) prefetchRoute(tab.path); }}
                    onClick={() => {
                      if (locked) { showAccessDenied(); return; }
                      navigate(tab.path);
                    }}
                    style={{ gridColumnStart: colStart }}
                    aria-disabled={locked}
                    className={`flex flex-col items-center justify-center h-full gap-1 transition-all relative ${
                      active ? "scale-105" : "hover:scale-105"
                    }`}
                  >
                    {active && !locked && (
                      <div className="absolute top-0 w-12 h-1 bg-gradient-to-r from-[#059669] to-[#047857] rounded-b-full" />
                    )}
                    <div className="relative">
                      <Icon
                        className={`w-5 h-5 transition-all ${
                          locked ? "text-[#D1D5DB]" : active ? "text-[#059669] drop-shadow-sm" : "text-[#6B7280]"
                        }`}
                      />
                      {locked && (
                        <Lock
                          className="absolute -top-1 -right-2 w-2.5 h-2.5 text-[#9CA3AF]"
                          strokeWidth={2.5}
                        />
                      )}
                    </div>
                    <span
                      className={`text-xs transition-all truncate px-1 ${
                        locked ? "text-[#D1D5DB]" : active ? "text-[#059669] font-bold" : "text-[#6B7280]"
                      }`}
                      style={{
                        fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)"
                      }}
                    >
                      {t(tab.label.bn, tab.label.en)}
                    </span>
                  </button>
                );
              });
            })()}

            {/* More group button — column 5 */}
            {showMoreButton && (
              <button
                onClick={() => setMoreOpen((v) => !v)}
                style={{ gridColumnStart: 5 }}
                className={`flex flex-col items-center justify-center h-full gap-1 transition-all relative ${
                  isGroupActive || moreOpen ? "scale-105" : "hover:scale-105"
                }`}
                aria-expanded={moreOpen}
                aria-label={t("আরও", "More")}
              >
                {isGroupActive && (
                  <div className="absolute top-0 w-12 h-1 bg-gradient-to-r from-[#059669] to-[#047857] rounded-b-full" />
                )}
                <div
                  className={`w-[40px] h-[40px] rounded-[14px] flex justify-center items-center transition-all duration-300 ease-out ${
                    isGroupActive
                      ? "bg-gradient-to-br from-emerald-50/90 to-emerald-100/60 shadow-[0_2px_12px_-3px_rgba(5,150,105,0.2)]"
                      : "bg-white shadow-[0_2px_8px_-3px_rgba(0,0,0,0.06)] hover:bg-gray-50/50 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08)]"
                  }`}
                  style={{
                    border: `1.5px solid ${isGroupActive ? "rgba(16, 185, 129, 0.3)" : "rgba(229, 231, 235, 0.6)"}`,
                  }}
                >
                  <div className="grid grid-cols-2 grid-rows-2 gap-[2px] w-[28px] h-[28px]">
                    <div className={`flex items-center justify-center rounded-[6px] transition-colors duration-300 ${isGroupActive ? 'bg-white/80' : 'bg-emerald-50/70'}`}>
                      <FileText className="w-[10px] h-[10px]" strokeWidth={2.5} style={{ color: "#059669" }} />
                    </div>
                    <div className={`flex items-center justify-center rounded-[6px] transition-colors duration-300 ${isGroupActive ? 'bg-white/80' : 'bg-amber-50/70'}`}>
                      <Receipt className="w-[10px] h-[10px]" strokeWidth={2.5} style={{ color: "#B45309" }} />
                    </div>
                    <div className={`flex items-center justify-center rounded-[6px] transition-colors duration-300 ${isGroupActive ? 'bg-white/80' : 'bg-gray-50/80'}`}>
                      <Truck className="w-[10px] h-[10px]" strokeWidth={2.5} style={{ color: "#6B7280" }} />
                    </div>
                    <div className={`flex items-center justify-center rounded-[6px] transition-colors duration-300 ${isGroupActive ? 'bg-white/80' : 'bg-slate-50/80'}`}>
                      <div className="flex gap-[1.5px]">
                        <div className="w-[2px] h-[2px] rounded-full" style={{ backgroundColor: "#9CA3AF" }}></div>
                        <div className="w-[2px] h-[2px] rounded-full" style={{ backgroundColor: "#9CA3AF" }}></div>
                        <div className="w-[2px] h-[2px] rounded-full" style={{ backgroundColor: "#9CA3AF" }}></div>
                      </div>
                    </div>
                  </div>
                </div>
                <span
                  className={`text-xs transition-all truncate px-1 ${
                    isGroupActive ? "text-[#059669] font-bold" : "text-[#6B7280]"
                  }`}
                  style={{
                    fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)"
                  }}
                >
                  {t("আরও", "More")}
                </span>
              </button>
            )}
          </div>

          {/* Center SCAN Button - Elevated & Always Visible */}
          <button
            onClick={() => navigate("/app/scan")}
            className="absolute -top-7 left-1/2 -translate-x-1/2 w-20 h-20 bg-gradient-to-br from-[#059669] via-[#047857] to-[#065F46] hover:from-[#047857] hover:to-[#065F46] rounded-full shadow-[0_12px_32px_rgba(5,150,105,0.5)] flex flex-col items-center justify-center transition-all hover:scale-110 hover:shadow-[0_16px_40px_rgba(5,150,105,0.6)] active:scale-95 ring-4 ring-[#059669]/20 z-10"
            style={{
              animation: 'pulse-glow 2s ease-in-out infinite'
            }}
          >
            <ScanLine className="w-10 h-10 text-white drop-shadow-lg" />
            <span
              className="text-[11px] text-white mt-0.5 drop-shadow-md"
              style={{
                fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)",
                fontWeight: 700
              }}
            >
              {t("স্ক্যান", "SCAN")}
            </span>
          </button>

          <style>{`
            @keyframes nav-progress {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(0%); }
              100% { transform: translateX(100%); }
            }
            @keyframes more-backdrop-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes more-tile-in {
              from { opacity: 0; transform: translateY(12px) scale(0.9); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes pulse-glow {
              0%, 100% {
                box-shadow: 0 12px 32px rgba(5, 150, 105, 0.5), 0 0 0 0 rgba(5, 150, 105, 0.4);
              }
              50% {
                box-shadow: 0 16px 40px rgba(5, 150, 105, 0.6), 0 0 0 8px rgba(5, 150, 105, 0);
              }
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}