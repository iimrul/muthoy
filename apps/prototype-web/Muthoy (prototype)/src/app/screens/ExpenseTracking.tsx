import { useState, useEffect, useMemo, useCallback } from "react";

import { Banknote, Home, Briefcase, Zap, Car, MoreHorizontal, TrendingUp, AlertTriangle, Save, X, Trash2, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { useAuth } from "../contexts/AuthContext";
import { notifyCashUpdated } from "../services/cash/cashCalculation";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";

interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  timestamp: string;
  note?: string;
  supplier?: string;
  loggedBy: string;
}

type ExpenseCategory = "Rent" | "Salary" | "Utilities" | "Conveyance" | "Other";

const CATEGORY_ICONS = {
  Rent: Home,
  Salary: Briefcase,
  Utilities: Zap,
  Conveyance: Car,
  Other: MoreHorizontal,
};

const CATEGORY_LABELS = {
  Rent: { bn: "ভাড়া", en: "Rent" },
  Salary: { bn: "বেতন", en: "Salary" },
  Utilities: { bn: "ইউটিলিটি", en: "Utilities" },
  Conveyance: { bn: "যাতায়াত", en: "Conveyance" },
  Other: { bn: "অন্যান্য", en: "Other" },
};

export function ExpenseTracking() {
  const { t, formatNumber, formatCurrency, language } = useLanguage();
  const navigate = useNavigate();
  const { isOwner, hasPermission } = useAuth();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [duplicateExpense, setDuplicateExpense] = useState<Expense | null>(null);
  const [view, setView] = useState<"quick" | "ledger" | "analytics">("quick");
  const [note, setNote] = useState("");
  const [ledgerMonth, setLedgerMonth] = useState(() => {
    const now = new Date();
    return { month: now.getMonth(), year: now.getFullYear() };
  });
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadExpenses = useCallback(() => {
    // Load current user
    const userStr = localStorage.getItem("currentUser");
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }

    // Load expenses
    const expensesStr = shopStorage.getItem("expenses");
    if (expensesStr) {
      setExpenses(JSON.parse(expensesStr));
    }
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Reload expenses when active shop changes
  useActiveShopReload(loadExpenses);

  const handleNumberPress = (num: string) => {
    if (num === "." && amount.includes(".")) return;
    if (amount === "0" && num !== ".") {
      setAmount(num);
    } else {
      setAmount(amount + num);
    }
  };

  const handleBackspace = () => {
    setAmount(amount.slice(0, -1) || "0");
  };

  const handleClear = () => {
    setAmount("");
    setSelectedCategory(null);
    setNote("");
    setShowDuplicateWarning(false);
  };

  const checkDuplicate = (category: ExpenseCategory, amt: number): Expense | null => {
    const today = new Date().toDateString();
    return expenses.find(
      (exp) =>
        exp.category === category &&
        exp.amount === amt &&
        new Date(exp.timestamp).toDateString() === today
    ) || null;
  };

  const handleLogExpense = () => {
    if (!amount || parseFloat(amount) <= 0) return;

    const category: ExpenseCategory = selectedCategory ?? "Other";
    if (!selectedCategory) setSelectedCategory(category);

    const expenseAmount = parseFloat(amount);
    const duplicate = checkDuplicate(category, expenseAmount);

    if (duplicate) {
      setDuplicateExpense(duplicate);
      setShowDuplicateWarning(true);
      return;
    }

    saveExpense(category);
  };

  const saveExpense = (categoryOverride?: ExpenseCategory) => {
    const category = categoryOverride ?? selectedCategory ?? "Other";
    if (!amount) return;

    const expenseAmount = parseFloat(amount);
    const newExpense: Expense = {
      id: Date.now().toString(),
      category,
      amount: expenseAmount,
      date: new Date().toLocaleDateString(),
      timestamp: new Date().toISOString(),
      note: note || undefined,
      loggedBy: currentUser?.name || "Unknown",
    };

    const updatedExpenses = [newExpense, ...expenses];
    setExpenses(updatedExpenses);
    shopStorage.setItem("expenses", JSON.stringify(updatedExpenses));
    notifyCashUpdated();

    // Reset form and show inline confirmation in Quick Log
    handleClear();
    setShowDuplicateWarning(false);
    setJustLogged(category);
    setTimeout(() => setJustLogged(null), 2000);
  };

  const deleteExpense = (id: string) => {
    const updated = expenses.filter((e) => e.id !== id);
    setExpenses(updated);
    shopStorage.setItem("expenses", JSON.stringify(updated));
    notifyCashUpdated();
    setConfirmDeleteId(null);
  };

  // Analytics calculations
  const thisMonthExpenses = useMemo(() => {
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    return expenses.filter((exp) => {
      const expDate = new Date(exp.timestamp);
      return expDate.getMonth() === thisMonth && expDate.getFullYear() === thisYear;
    });
  }, [expenses]);

  const lastMonthExpenses = useMemo(() => {
    const lastMonth = new Date().getMonth() - 1;
    const lastMonthYear = lastMonth < 0 ? new Date().getFullYear() - 1 : new Date().getFullYear();
    const adjustedMonth = lastMonth < 0 ? 11 : lastMonth;
    return expenses.filter((exp) => {
      const expDate = new Date(exp.timestamp);
      return expDate.getMonth() === adjustedMonth && expDate.getFullYear() === lastMonthYear;
    });
  }, [expenses]);

  const thisMonthTotal = thisMonthExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const lastMonthTotal = lastMonthExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const monthOverMonthChange = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    thisMonthExpenses.forEach((exp) => {
      totals[exp.category] = (totals[exp.category] || 0) + exp.amount;
    });
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [thisMonthExpenses]);

  const todayExpenses = useMemo(() => {
    const today = new Date().toDateString();
    return expenses.filter((e) => new Date(e.timestamp).toDateString() === today);
  }, [expenses]);
  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);

  const ledgerExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const d = new Date(e.timestamp);
      return d.getMonth() === ledgerMonth.month && d.getFullYear() === ledgerMonth.year;
    });
  }, [expenses, ledgerMonth]);
  const selectedMonthTotal = ledgerExpenses.reduce((sum, e) => sum + e.amount, 0);

  const groupedByDate = useMemo(() => {
    const groups: Record<string, Expense[]> = {};
    ledgerExpenses.forEach((e) => {
      const key = new Date(e.timestamp).toDateString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return Object.entries(groups).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [ledgerExpenses]);

  const now = new Date();
  const isCurrentMonth =
    ledgerMonth.month === now.getMonth() && ledgerMonth.year === now.getFullYear();
  const monthLabel = new Date(ledgerMonth.year, ledgerMonth.month, 1).toLocaleDateString(
    language === "bn" ? "bn-BD" : "en-US",
    { month: "long", year: "numeric" }
  );

  const formatDateHeader = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t("আজ", "Today");
    if (d.toDateString() === yesterday.toDateString()) return t("গতকাল", "Yesterday");
    return d.toLocaleDateString(language === "bn" ? "bn-BD" : "en-US", {
      day: "numeric",
      month: "short",
    });
  };

  const stepMonth = (dir: -1 | 1) => {
    setLedgerMonth((prev) => {
      const m = prev.month + dir;
      if (m < 0) return { month: 11, year: prev.year - 1 };
      if (m > 11) return { month: 0, year: prev.year + 1 };
      return { month: m, year: prev.year };
    });
  };

  // Check permissions
  const isStaff = !isOwner;
  const canViewTotals = isOwner || hasPermission("reports");
  const expenseLimit = isStaff ? 500 : Infinity;

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader
        title={t("খরচ", "Expenses")}
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/60 px-2 py-1 rounded text-xs text-[#065F46]">
              <Save className="w-3 h-3" />
              <span style={{ fontFamily: "var(--font-bangla)" }}>{t("লোকাল সেভ", "Local Save")}</span>
            </div>
          </div>
        }
      />

      {/* Persistent Summary Strip */}
      {canViewTotals && (
        <div className="bg-white border-b border-[#E5E7EB] px-4 py-2.5 grid grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("এই মাস", "This Month")}
            </p>
            <p className="text-[18px] font-bold text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
              ৳ {formatCurrency(thisMonthTotal)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("আজ", "Today")}
            </p>
            <p className="text-[16px] font-bold text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
              ৳ {formatCurrency(todayTotal)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("এন্ট্রি", "Entries")}
            </p>
            <p className="text-[16px] font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
              {formatNumber(thisMonthExpenses.length)} {t("টি", "")}
            </p>
          </div>
        </div>
      )}

      {/* View Tabs */}
      <div className="bg-white border-b border-[#059669]/10 sticky top-14 z-20">
        <div className="flex">
          <button
            onClick={() => setView("quick")}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              view === "quick" ? "text-[#059669] border-b-2 border-[#059669]" : "text-[#6B7280]"
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("দ্রুত লগ", "Quick Log")}
          </button>
          <button
            onClick={() => setView("ledger")}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              view === "ledger" ? "text-[#059669] border-b-2 border-[#059669]" : "text-[#6B7280]"
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("লেজার", "Ledger")}
          </button>
          {canViewTotals && (
            <button
              onClick={() => setView("analytics")}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                view === "analytics" ? "text-[#059669] border-b-2 border-[#059669]" : "text-[#6B7280]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("বিশ্লেষণ", "Analytics")}
            </button>
          )}
        </div>
      </div>

      {/* Quick Log View */}
      {view === "quick" && (
        <div className="p-4 space-y-6">
          {justLogged && (
            <div
              className="flex items-center gap-2 rounded-lg border border-[#059669] bg-[#ECFDF5] px-3.5 py-2.5"
              style={{ animation: "expense-banner-fade 2000ms ease-out forwards" }}
            >
              <CheckCircle className="w-[18px] h-[18px] text-[#059669] flex-shrink-0" />
              <span className="text-[13px] font-semibold text-[#047857]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("খরচ সংরক্ষিত হয়েছে", "Expense saved")}
              </span>
            </div>
          )}
          <style>{`
            @keyframes expense-banner-fade {
              0% { opacity: 0; transform: translateY(-4px); }
              10%, 80% { opacity: 1; transform: translateY(0); }
              100% { opacity: 0; transform: translateY(-4px); }
            }
          `}</style>
          {/* Category Buttons */}
          <div>
            <h2 className="text-sm font-semibold text-[#047857] mb-3" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("ক্যাটাগরি নির্বাচন করুন", "Select Category")}
            </h2>
            <div className="grid grid-cols-5 gap-3">
              {(Object.keys(CATEGORY_ICONS) as ExpenseCategory[]).map((category) => {
                const Icon = CATEGORY_ICONS[category];
                const isSelected = selectedCategory === category;
                return (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`flex flex-col items-center justify-center aspect-square rounded-full transition-all active:scale-95 ${
                      isSelected
                        ? "bg-[#059669] text-white shadow-lg scale-110"
                        : "bg-white text-[#059669] shadow-sm hover:shadow-md"
                    }`}
                    style={{ minHeight: "48px", minWidth: "48px" }}
                  >
                    <Icon className="w-6 h-6 mb-1" />
                    <span className="text-[10px] font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
                      {language === "bn" ? CATEGORY_LABELS[category].bn : CATEGORY_LABELS[category].en}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount Display */}
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-xs text-[#6B7280] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("পরিমাণ", "Amount")}
            </p>
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {amount || "0"}
              </p>
              {amount && (
                <button onClick={handleClear} className="text-[#DC2626] active:scale-95">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            {expenseLimit < Infinity && parseFloat(amount || "0") > expenseLimit && (
              <div className="mt-2 flex items-center gap-1 text-xs text-[#DC2626]">
                <AlertTriangle className="w-3 h-3" />
                <span style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("সীমা অতিক্রম করেছে", "Exceeds limit")}
                </span>
              </div>
            )}
          </div>

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((key) => (
              <button
                key={key}
                onClick={() => {
                  if (key === "⌫") handleBackspace();
                  else handleNumberPress(key);
                }}
                className="bg-white rounded-lg h-14 text-xl font-bold text-[#111827] shadow-sm active:scale-95 active:bg-[#ECFDF5] transition-all"
                style={{ minHeight: "48px", fontFamily: key === "⌫" ? "inherit" : "var(--font-sans)" }}
              >
                {key}
              </button>
            ))}
          </div>

          {/* Optional Note */}
          <div>
            <label className="text-xs text-[#6B7280] mb-1 block" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নোট (ঐচ্ছিক)", "Note (Optional)")}
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("বিস্তারিত যোগ করুন", "Add details")}
              className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm"
              style={{ fontFamily: "var(--font-bangla)", minHeight: "48px" }}
            />
          </div>

          {/* Log Button */}
          <button
            onClick={handleLogExpense}
            disabled={
              !amount ||
              parseFloat(amount) <= 0 ||
              (expenseLimit < Infinity && parseFloat(amount || "0") > expenseLimit)
            }
            className="w-full bg-[#059669] text-white py-4 rounded-lg font-bold text-base shadow-lg active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            style={{ fontFamily: "var(--font-bangla)", minHeight: "48px" }}
          >
            {t("খরচ লগ করুন", "Log Expense")}
          </button>
        </div>
      )}

      {/* Ledger View */}
      {view === "ledger" && (
        <div className="p-4">
          {/* Month Navigator */}
          <div className="flex items-center justify-between pb-3">
            <button
              onClick={() => stepMonth(-1)}
              className="w-10 h-10 flex items-center justify-center rounded-full text-[#111827] active:scale-95 hover:bg-[#F3F4F6]"
              aria-label={t("আগের মাস", "Previous month")}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <p className="text-[14px] font-semibold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
              {monthLabel}
            </p>
            <button
              onClick={() => !isCurrentMonth && stepMonth(1)}
              disabled={isCurrentMonth}
              className={`w-10 h-10 flex items-center justify-center rounded-full active:scale-95 ${
                isCurrentMonth ? "text-[#D1D5DB] cursor-not-allowed" : "text-[#111827] hover:bg-[#F3F4F6]"
              }`}
              aria-label={t("পরের মাস", "Next month")}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="text-right pb-2">
            <span className="text-[13px] text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
              {t("মোট: ", "Total: ")}৳ {formatCurrency(selectedMonthTotal)}
            </span>
          </div>

          {ledgerExpenses.length === 0 ? (
            <div className="text-center py-12">
              <Banknote className="w-12 h-12 text-[#6B7280] mx-auto mb-3" />
              <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("কোনো খরচ নেই", "No expenses yet")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByDate.map(([dateKey, items]) => {
                const dailySum = items.reduce((s, e) => s + e.amount, 0);
                return (
                  <div key={dateKey}>
                    <div className="flex items-center justify-between bg-[#F9FAFB] px-3 py-1.5 rounded-t-lg">
                      <span className="text-[12px] font-semibold text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                        {formatDateHeader(dateKey)}
                      </span>
                      <span className="text-[12px] text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
                        ৳ {formatCurrency(dailySum)}
                      </span>
                    </div>
                    <div className="space-y-2 pt-2">
                      {items.map((expense) => {
                        const Icon = CATEGORY_ICONS[expense.category as ExpenseCategory];
                        const isConfirming = confirmDeleteId === expense.id;
                        return (
                          <div key={expense.id} className="bg-white rounded-lg p-4 shadow-sm flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-[#ECFDF5] flex items-center justify-center flex-shrink-0">
                                <Icon className="w-5 h-5 text-[#059669]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                                  {language === "bn"
                                    ? CATEGORY_LABELS[expense.category as ExpenseCategory].bn
                                    : CATEGORY_LABELS[expense.category as ExpenseCategory].en}
                                </p>
                                <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                                  {expense.loggedBy}
                                </p>
                                {expense.note && (
                                  <p className="text-xs text-[#6B7280] mt-1 truncate">{expense.note}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              <p className="text-lg font-bold text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
                                ৳ {formatCurrency(expense.amount)}
                              </p>
                              {isConfirming ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[11px] text-[#6B7280] mr-1" style={{ fontFamily: "var(--font-bangla)" }}>
                                    {t("মুছবেন?", "Delete?")}
                                  </span>
                                  <button
                                    onClick={() => deleteExpense(expense.id)}
                                    className="w-9 h-9 flex items-center justify-center rounded-full bg-[#FEE2E2] text-[#DC2626] active:scale-95"
                                    aria-label={t("নিশ্চিত", "Confirm")}
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="w-9 h-9 flex items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280] active:scale-95"
                                    aria-label={t("বাতিল", "Cancel")}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteId(expense.id)}
                                  className="w-9 h-9 flex items-center justify-center rounded-full text-[#EF4444] hover:bg-[#FEE2E2] active:scale-95"
                                  aria-label={t("মুছুন", "Delete")}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Analytics View */}
      {view === "analytics" && canViewTotals && (
        <div className="p-4 space-y-4">
          {/* Month-over-Month Trend */}
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#047857]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("মাসিক প্রবণতা", "Monthly Trend")}
              </h3>
              <TrendingUp className="w-5 h-5 text-[#059669]" />
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {formatCurrency(thisMonthTotal)}
              </p>
              <p
                className={`text-sm font-semibold ${monthOverMonthChange > 0 ? "text-[#DC2626]" : "text-[#059669]"}`}
                style={{ fontFamily: "var(--font-money)" }}
              >
                {monthOverMonthChange > 0 ? "+" : ""}
                {monthOverMonthChange.toFixed(1)}%
              </p>
            </div>
            <p className="text-xs text-[#6B7280] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("গত মাস: ", "Last month: ")}
              <span style={{ fontFamily: "var(--font-money)" }}>৳ {formatCurrency(lastMonthTotal)}</span>
            </p>
          </div>

          {/* Category Breakdown */}
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#047857] mb-4" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("ক্যাটাগরি অনুযায়ী", "By Category")}
            </h3>
            <div className="space-y-3">
              {categoryTotals.map(([category, total]) => {
                const percentage = thisMonthTotal > 0 ? (total / thisMonthTotal) * 100 : 0;
                const percentageLabel = percentage.toFixed(1) + "%";
                const Icon = CATEGORY_ICONS[category as ExpenseCategory];
                return (
                  <div key={category}>
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Icon className="w-4 h-4 text-[#059669] flex-shrink-0" />
                        <span className="text-xs font-semibold text-[#111827] truncate" style={{ fontFamily: "var(--font-bangla)" }}>
                          {language === "bn"
                            ? CATEGORY_LABELS[category as ExpenseCategory].bn
                            : CATEGORY_LABELS[category as ExpenseCategory].en}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#6B7280] flex-shrink-0" style={{ fontFamily: "var(--font-sans)" }}>
                        {percentageLabel}
                      </span>
                      <span className="text-sm font-bold text-[#111827] flex-shrink-0" style={{ fontFamily: "var(--font-money)" }}>
                        ৳ {formatCurrency(total)}
                      </span>
                    </div>
                    <div className="h-2 bg-[#ECFDF5] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#059669] to-[#047857] rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs text-[#6B7280] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("মোট খরচ", "Total Expenses")}
              </p>
              <p className="text-xl font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {formatCurrency(thisMonthTotal)}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                {formatNumber(thisMonthExpenses.length)} {t("টি এন্ট্রি", "entries")}
              </p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs text-[#6B7280] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("গড় খরচ", "Avg. Expense")}
              </p>
              <p className="text-xl font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {formatCurrency(thisMonthExpenses.length > 0 ? thisMonthTotal / thisMonthExpenses.length : 0)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Warning Modal */}
      {showDuplicateWarning && duplicateExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-[#D97706]" />
              </div>
              <h3 className="font-bold text-base text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("সদৃশ খরচ সনাক্ত", "Duplicate Detected")}
              </h3>
            </div>
            <p className="text-sm text-[#6B7280] mb-4" style={{ fontFamily: "var(--font-bangla)" }}>
              {t(
                "আজ একই ক্যাটাগরি এবং পরিমাণের খরচ ইতিমধ্যে লগ করা হয়েছে।",
                "An expense with the same category and amount was already logged today."
              )}
            </p>
            <div className="bg-[#ECFDF5] rounded p-3 mb-4">
              <p className="text-xs text-[#047857] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("পূর্ববর্তী খরচ", "Previous Expense")}
              </p>
              <p className="text-sm font-semibold text-[#111827]">
                {language === "bn"
                  ? CATEGORY_LABELS[duplicateExpense.category as ExpenseCategory].bn
                  : CATEGORY_LABELS[duplicateExpense.category as ExpenseCategory].en}{" "}
                • <span style={{ fontFamily: "var(--font-money)" }}>৳ {formatCurrency(duplicateExpense.amount)}</span>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDuplicateWarning(false)}
                className="flex-1 py-3 border border-[#D1D5DB] rounded-lg font-semibold text-sm text-[#6B7280] active:scale-98"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("বাতিল", "Cancel")}
              </button>
              <button
                onClick={saveExpense}
                className="flex-1 py-3 bg-[#059669] text-white rounded-lg font-semibold text-sm active:scale-98"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("যেভাবেই হোক লগ করুন", "Log Anyway")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}