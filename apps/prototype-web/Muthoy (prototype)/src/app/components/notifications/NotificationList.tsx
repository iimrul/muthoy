import { useMemo } from "react";
import { BellOff } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import { NotificationCard } from "./NotificationCard";
import { formatRelativeDate } from "../../services/notifications/notificationFormatter";
import type { AppNotification } from "../../services/notifications/types";

interface Props {
  items: AppNotification[];
  onTap: (n: AppNotification) => void;
  onDelete?: (n: AppNotification) => void;
}

export function NotificationList({ items, onTap, onDelete }: Props) {
  const { t, language } = useLanguage();

  const grouped = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    for (const n of items) {
      const key = formatRelativeDate(n.createdAt, language);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return Array.from(map.entries());
  }, [items, language]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-[#ECFDF5] flex items-center justify-center mb-4">
          <BellOff className="w-9 h-9 text-[#059669]" />
        </div>
        <h3
          className="text-base font-bold text-[#111827] mb-1"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {t("এখনও কোনো নতুন নোটিফিকেশন নেই", "No new notifications yet")}
        </h3>
        <p
          className="text-sm text-[#6B7280] leading-relaxed max-w-[280px]"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {t(
            "নতুন আপডেট এলে এখানে দেখাবে।",
            "We'll show updates here when they arrive."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(([label, list]) => (
        <section key={label}>
          <h3
            className="text-[11px] uppercase tracking-wide text-[#6B7280] font-semibold mb-2 px-1"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {label}
          </h3>
          <div className="space-y-2">
            {list.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onTap={onTap}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
