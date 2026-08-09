import { useCallback, useEffect, useState } from "react";

import { CheckCheck } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { NotificationList } from "../components/notifications/NotificationList";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  removeNotification,
  NOTIFICATIONS_UPDATED_EVENT,
} from "../services/notifications/notificationService";
import type { AppNotification } from "../services/notifications/types";
import { useNavigate } from "../utils/navigation";

export function NotificationCenter() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>(() => getNotifications());

  const refresh = useCallback(() => setItems(getNotifications()), []);

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdate);
    window.addEventListener("focus", onUpdate);
    return () => {
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdate);
      window.removeEventListener("focus", onUpdate);
    };
  }, [refresh]);

  const unread = items.filter((n) => !n.isRead).length;

  const handleTap = (n: AppNotification) => {
    if (!n.isRead) markNotificationRead(n.id);
    if (n.actionRoute) navigate(n.actionRoute);
  };

  const handleDelete = (n: AppNotification) => removeNotification(n.id);

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      <StandardHeader
        title={t("নোটিফিকেশন", "Notifications")}
        right={
          <button
            onClick={markAllNotificationsRead}
            disabled={unread === 0}
            className="h-9 px-3 rounded-full flex items-center gap-1.5 text-[#065F46] text-xs font-bold disabled:opacity-40 active:scale-95 hover:bg-white/70 transition"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <CheckCheck className="w-4 h-4" />
            {t("সব পঠিত", "Mark all read")}
          </button>
        }
      />

      <main className="flex-1 px-4 py-4 pb-24 max-w-[560px] mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
        <NotificationList
          items={items}
          onTap={handleTap}
          onDelete={handleDelete}
        />
      </main>
    </div>
  );
}
