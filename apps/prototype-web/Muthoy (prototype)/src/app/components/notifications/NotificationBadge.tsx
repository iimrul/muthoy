import { useLanguage } from "../../contexts/LanguageContext";
import { formatBadgeCount } from "../../services/notifications/notificationFormatter";

export function NotificationBadge({ count }: { count: number }) {
  const { language } = useLanguage();
  if (count <= 0) return null;
  const label = formatBadgeCount(count, language);
  return (
    <span
      className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[#047857] shadow"
      style={{ fontFamily: "var(--font-sans)", lineHeight: 1 }}
      aria-label={`${count} unread`}
    >
      {label}
    </span>
  );
}
