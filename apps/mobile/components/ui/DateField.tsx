import Feather from "@expo/vector-icons/Feather";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "@muthoy/constants";
import {
  isDateInRange,
  monthGrid,
  parseIsoDate,
  shiftMonth,
  toIsoDate,
  type CalendarDay,
  type CalendarMonth,
} from "../../domain/calendarMonth";
import { calendarDateFormatter, monthYearFormatter, weekdayFormatter } from "../../i18n/formatters";
import type { CatalogKey } from "../../i18n/catalog";
import { useI18n } from "../../state/localeStore";
import { BaseSheet } from "./BaseModal";

// components/ui/DateField.tsx — every date in the app is picked from a calendar
// drawn in the app's own style (founder 2026-11-21: no typing dates by hand).
// The value stays the "YYYY-MM-DD" string each form already stores, so nothing
// that reads it (FEFO expiry, report ranges) changes. No native dependency: the
// calendar is plain views in a BaseSheet.

export interface DateFieldProps {
  /** "YYYY-MM-DD", or "" for no date yet. */
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  /** Inclusive "YYYY-MM-DD" bounds; days outside them cannot be picked. */
  minDate?: string;
  maxDate?: string;
  /** Shows a Clear button for optional dates. */
  isClearable?: boolean;
  disabled?: boolean;
  /** The field's border, size and background, so each form keeps its look. */
  className?: string;
  textClassName?: string;
}

const DEFAULT_SHELL = "h-12 rounded-xl border border-[#D1D5DB] bg-white px-4";
// A known Sunday, to label the weekday columns in the active locale.
const SUNDAY = Date.UTC(2023, 0, 1);
const DAY_MS = 86_400_000;

const utcDate = ({ year, month }: CalendarMonth, day: number) => new Date(Date.UTC(year, month, day));

function isoToUtcDate(iso: string): Date {
  const parsed = parseIsoDate(iso);
  return parsed ? utcDate(parsed, parsed.day) : new Date(Number.NaN);
}

function localToday(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export function DateField({
  value,
  onChange,
  accessibilityLabel,
  placeholder,
  minDate,
  maxDate,
  isClearable = false,
  disabled = false,
  className = DEFAULT_SHELL,
  textClassName = "font-sans text-base",
}: DateFieldProps) {
  const { locale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  // A legacy value that is not a real date is shown as typed, never hidden.
  const display = parseIsoDate(value) ? calendarDateFormatter(locale).format(isoToUtcDate(value)) : value;

  const pick = (iso: string) => {
    onChange(iso);
    setIsOpen(false);
  };

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setIsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={display ? `${accessibilityLabel}: ${display}` : accessibilityLabel}
        accessibilityHint={t("chooseDateLabel")}
        accessibilityState={{ disabled }}
        className={`flex-row items-center justify-between gap-2 active:opacity-70 ${className} ${disabled ? "opacity-50" : ""}`}
      >
        <Text numberOfLines={1} className={`flex-1 ${textClassName} ${display ? "text-richBlack" : "text-midGray"}`}>
          {display || placeholder || t("chooseDateLabel")}
        </Text>
        <Feather name="calendar" size={16} color={colors.brandGreen} />
      </Pressable>
      {isOpen ? (
        <CalendarSheet
          title={accessibilityLabel}
          value={value}
          minDate={minDate}
          maxDate={maxDate}
          isClearable={isClearable && value !== ""}
          onPick={pick}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
}

interface CalendarSheetProps {
  title: string;
  value: string;
  minDate?: string;
  maxDate?: string;
  isClearable: boolean;
  onPick: (iso: string) => void;
  onClose: () => void;
}

function CalendarSheet({ title, value, minDate, maxDate, isClearable, onPick, onClose }: CalendarSheetProps) {
  const { locale, t, formatNumber } = useI18n();
  const today = localToday();
  const start = parseIsoDate(value) ?? parseIsoDate(today);
  const [month, setMonth] = useState<CalendarMonth>({ year: start?.year ?? 2026, month: start?.month ?? 0 });
  const weekdays = Array.from({ length: 7 }, (_, index) => weekdayFormatter(locale).format(SUNDAY + index * DAY_MS));
  const canPickToday = isDateInRange(today, minDate, maxDate);

  return (
    <BaseSheet visible onClose={onClose} title={title}>
      <View className="mb-2 flex-row items-center justify-between">
        <View className="flex-row">
          <StepButton icon="chevrons-left" label="previousYear" onPress={() => setMonth(shiftMonth(month, -12))} />
          <StepButton icon="chevron-left" label="previousMonth" onPress={() => setMonth(shiftMonth(month, -1))} />
        </View>
        <Text accessibilityRole="header" className="font-sans-bold text-base text-richBlack">
          {monthYearFormatter(locale).format(utcDate(month, 1))}
        </Text>
        <View className="flex-row">
          <StepButton icon="chevron-right" label="nextMonth" onPress={() => setMonth(shiftMonth(month, 1))} />
          <StepButton icon="chevrons-right" label="nextYear" onPress={() => setMonth(shiftMonth(month, 12))} />
        </View>
      </View>
      <View className="flex-row">
        {weekdays.map((weekday, index) => (
          <Text key={index} className="flex-1 py-1 text-center font-sans-semibold text-xs text-midGray">
            {weekday}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week) => (
        <View key={week[0]?.iso} className="flex-row">
          {week.map((day) => (
            <DayCell
              key={day.iso}
              day={day}
              label={calendarDateFormatter(locale).format(isoToUtcDate(day.iso))}
              dayLabel={formatNumber(day.day)}
              isSelected={day.iso === value}
              isToday={day.iso === today}
              isEnabled={isDateInRange(day.iso, minDate, maxDate)}
              onPick={onPick}
            />
          ))}
        </View>
      ))}
      <View className="mt-3 flex-row gap-3">
        {isClearable ? (
          <Pressable
            onPress={() => onPick("")}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl border border-midGray/40 py-3 active:opacity-70"
          >
            <Text className="font-sans-semibold text-sm text-richBlack">{t("clearLabel")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={!canPickToday}
          onPress={() => onPick(today)}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canPickToday }}
          className="flex-1 items-center rounded-xl bg-brand-softGreen py-3 active:opacity-70 disabled:opacity-40"
        >
          <Text className="font-sans-semibold text-sm text-brand-green">{t("today")}</Text>
        </Pressable>
      </View>
    </BaseSheet>
  );
}

interface StepButtonProps {
  icon: "chevrons-left" | "chevron-left" | "chevron-right" | "chevrons-right";
  label: CatalogKey;
  onPress: () => void;
}

function StepButton({ icon, label, onPress }: StepButtonProps) {
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      hitSlop={4}
      className="h-10 w-10 items-center justify-center rounded-full active:bg-brand-softGreen"
    >
      <Feather name={icon} size={18} color={colors.richBlack} />
    </Pressable>
  );
}

interface DayCellProps {
  day: CalendarDay;
  label: string;
  dayLabel: string;
  isSelected: boolean;
  isToday: boolean;
  isEnabled: boolean;
  onPick: (iso: string) => void;
}

function DayCell({ day, label, dayLabel, isSelected, isToday, isEnabled, onPick }: DayCellProps) {
  const circle = isSelected ? "bg-brand-green" : isToday ? "border border-brand-green" : "";
  const ink = isSelected ? "font-sans-semibold text-white" : day.isInMonth ? "font-sans text-richBlack" : "font-sans text-midGray";
  return (
    <Pressable
      disabled={!isEnabled}
      onPress={() => onPick(day.iso)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected, disabled: !isEnabled }}
      className={`h-11 flex-1 items-center justify-center ${isEnabled ? "" : "opacity-30"}`}
    >
      <View className={`h-9 w-9 items-center justify-center rounded-full ${circle}`}>
        <Text className={`text-sm ${ink} ${day.isInMonth || isSelected ? "" : "opacity-60"}`}>{dayLabel}</Text>
      </View>
    </Pressable>
  );
}
