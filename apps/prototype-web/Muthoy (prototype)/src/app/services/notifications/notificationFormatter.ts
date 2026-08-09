// Presentation helpers: relative date, time, and per-type icon/color mapping.

import {
  Wallet,
  Package as PackageIcon,
  Clock,
  AlertCircle,
  CheckCircle2,
  Cloud,
  RotateCcw,
} from "lucide-react";
import type { NotificationType } from "./types";

export interface CategoryStyle {
  Icon: any;
  /** Solid icon foreground color */
  color: string;
  /** Soft tinted background for the icon chip */
  bg: string;
  /** Default Bangla label for the category */
  labelBn: string;
  labelEn: string;
}

export const CATEGORY_STYLES: Record<NotificationType, CategoryStyle> = {
  cash_summary: {
    Icon: Wallet,
    color: "#059669",
    bg: "#ECFDF5",
    labelBn: "নগদ সারসংক্ষেপ",
    labelEn: "Cash Summary",
  },
  low_stock: {
    Icon: PackageIcon,
    color: "#D97706",
    bg: "#FFFBEB",
    labelBn: "স্টক সতর্কতা",
    labelEn: "Low Stock",
  },
  expiry: {
    Icon: Clock,
    color: "#DC2626",
    bg: "#FEF2F2",
    labelBn: "মেয়াদ সতর্কতা",
    labelEn: "Expiry",
  },
  overdue_credit: {
    Icon: AlertCircle,
    color: "#B91C1C",
    bg: "#FEE2E2",
    labelBn: "বাকি বকেয়া",
    labelEn: "Overdue Credit",
  },
  sync_completed: {
    Icon: CheckCircle2,
    color: "#2563EB",
    bg: "#DBEAFE",
    labelBn: "সিঙ্ক সম্পন্ন",
    labelEn: "Sync Completed",
  },
  backup_reminder: {
    Icon: Cloud,
    color: "#475569",
    bg: "#F1F5F9",
    labelBn: "ব্যাকআপ রিমাইন্ডার",
    labelEn: "Backup Reminder",
  },
  refund: {
    Icon: RotateCcw,
    color: "#EA580C",
    bg: "#FFF7ED",
    labelBn: "রিফান্ড",
    labelEn: "Refund",
  },
};

const BANGLA_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
function toBangla(n: number | string): string {
  return String(n).replace(/\d/g, (d) => BANGLA_DIGITS[+d]);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function formatRelativeDate(iso: string, lang: "bn" | "en" = "bn"): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const days = Math.round((today.getTime() - that.getTime()) / 86400000);

  if (days <= 0) return lang === "bn" ? "আজ" : "Today";
  if (days === 1) return lang === "bn" ? "গতকাল" : "Yesterday";
  if (days < 7) return lang === "bn" ? `${toBangla(days)} দিন আগে` : `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return lang === "bn" ? `${toBangla(w)} সপ্তাহ আগে` : `${w} weeks ago`;
  }
  // Fallback to a localized short date for older items.
  return lang === "bn"
    ? d.toLocaleDateString("bn-BD", { day: "numeric", month: "short" })
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function formatTime(iso: string, lang: "bn" | "en" = "bn"): string {
  const d = new Date(iso);
  let hours = d.getHours();
  const mins = d.getMinutes();
  const isPm = hours >= 12;
  hours = hours % 12 || 12;
  const mm = String(mins).padStart(2, "0");
  const suffix = isPm ? "PM" : "AM";
  const time = `${hours}:${mm} ${suffix}`;
  return lang === "bn" ? toBangla(time) : time;
}

export function formatBadgeCount(n: number, lang: "bn" | "en" = "bn"): string {
  if (n <= 0) return "";
  if (n > 10) return lang === "bn" ? `${toBangla(10)}+` : "10+";
  return lang === "bn" ? toBangla(n) : String(n);
}
