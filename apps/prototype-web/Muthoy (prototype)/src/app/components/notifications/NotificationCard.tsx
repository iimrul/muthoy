import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  CATEGORY_STYLES,
  formatRelativeDate,
  formatTime,
} from "../../services/notifications/notificationFormatter";
import type { AppNotification } from "../../services/notifications/types";

interface Props {
  notification: AppNotification;
  onTap: (n: AppNotification) => void;
  onDelete?: (n: AppNotification) => void;
}

export function NotificationCard({ notification, onTap, onDelete }: Props) {
  const { language } = useLanguage();
  const style = CATEGORY_STYLES[notification.type];
  const Icon = style.Icon;
  const [showActions, setShowActions] = useState(false);

  const handleClick = () => onTap(notification);

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowActions((v) => !v);
        }}
        className={`w-full text-left flex items-start gap-3 p-3.5 rounded-2xl border transition-all active:scale-[0.99] ${
          notification.isRead
            ? "bg-white border-[#F3F4F6]"
            : "bg-[#F0FDF4] border-[#A7F3D0] shadow-sm"
        }`}
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {/* Icon chip */}
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-black/5"
          style={{ background: style.bg, color: style.color }}
        >
          <Icon className="w-5 h-5" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="text-sm font-bold text-[#111827] truncate">
              {notification.title}
            </h4>
            {!notification.isRead && (
              <span className="w-2 h-2 rounded-full bg-[#059669] flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-[#4B5563] leading-snug line-clamp-2">
            {notification.message}
          </p>
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#9CA3AF]">
            <span style={{ fontFamily: "var(--font-sans)" }}>
              {formatTime(notification.createdAt, language)}
            </span>
            <span className="w-1 h-1 rounded-full bg-[#D1D5DB]" />
            <span>{formatRelativeDate(notification.createdAt, language)}</span>
          </div>
        </div>
      </button>

      {showActions && onDelete && (
        <button
          onClick={() => {
            setShowActions(false);
            onDelete(notification);
          }}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-[#FEE2E2] text-[#B91C1C] flex items-center justify-center active:scale-90"
          aria-label="Delete notification"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
