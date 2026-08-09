import { useCallback, useEffect, useState } from "react";

import { Bell } from "lucide-react";
import { NotificationBadge } from "./NotificationBadge";
import {
  getUnreadCount,
  NOTIFICATIONS_UPDATED_EVENT,
} from "../../services/notifications/notificationService";
import { useNavigate } from "../../utils/navigation";

export function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(() => getUnreadCount());

  const refresh = useCallback(() => setCount(getUnreadCount()), []);

  useEffect(() => {
    refresh();
    const onUpdated = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "notifications") refresh();
    };
    const onFocus = () => refresh();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <button
      onClick={() => navigate("/app/notifications")}
      className="relative w-12 h-12 flex items-center justify-center text-white rounded-full hover:bg-white/10 active:scale-95 transition"
      aria-label="Notifications"
    >
      <Bell className="w-5 h-5" />
      <NotificationBadge count={count} />
    </button>
  );
}
