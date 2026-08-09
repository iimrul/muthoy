import { useState, useEffect, useMemo } from "react";

import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { useAuth } from "../contexts/AuthContext";
import { useAuditLog } from "../contexts/AuditLogContext";
import { restoreStock } from "../utils/medicineData";
import {
  Search,
  Calendar, 
  User, 
  Filter,
  Receipt,
  Clock,
  CreditCard,
  Banknote,
  AlertCircle,
  CheckCircle,
  XCircle,
  Printer,
  RotateCcw
} from "lucide-react";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

interface COGSLine {
  batchNo: string;
  qty: number;
  purchasePrice: number;
}

interface Transaction {
  id: number;
  date: string;
  timestamp: string;
  staffName: string;
  staffId?: number;
  items: Array<{
    id: number;
    name: string;
    nameBn: string;
    quantity: number;
    price: number;
    total: number;
    manufacturer?: string;
    manufacturerBn?: string;
    cogsLines?: COGSLine[]; // P2: Captured COGS breakdown
    cogs?: number; // P2: Item-level COGS
  }>;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  tendered?: number;
  creditAmount?: number;
  creditPaid?: number;
  isCreditSale?: boolean;
  isPartialPayment?: boolean;
  partialPaidAmount?: number;
  partialRemainingAmount?: number;
  isRefunded?: boolean;
  isDeleted?: boolean;
  syncStatus?: "synced" | "local";
  status?: "confirmed" | "hold" | "cancelled";
  cogs?: number; // P2: Transaction-level total COGS
}

export function SalesHistory() {
  const navigate = useNavigate();
  const { t, language, formatNumber } = useLanguage();
  const { staff } = useAuth();
  const { addLog } = useAuditLog();
  
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [userFilter, setUserFilter] = useState<"all" | string>("all");
  const [actionFilter, setActionFilter] = useState<"all" | "sales" | "credit" | "partial" | "refunded" | "hold" | "cancelled">("all");
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Load transactions from localStorage
  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = () => {
    const transactionsStr = shopStorage.getItem("transactions");
    if (transactionsStr) {
      const allTransactions = JSON.parse(transactionsStr);
      // Sort by timestamp (most recent first)
      allTransactions.sort((a: Transaction, b: Transaction) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setTransactions(allTransactions);
    }
  };

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(transaction => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        transaction.id.toString().includes(searchLower) ||
        transaction.customerName?.toLowerCase().includes(searchLower) ||
        transaction.customerPhone?.includes(searchQuery) ||
        transaction.staffName.toLowerCase().includes(searchLower);

      // Date filter
      const transactionDate = new Date(transaction.timestamp);
      const today = new Date();
      const matchesDate = 
        dateFilter === "all" ||
        (dateFilter === "today" && 
          transactionDate.toDateString() === today.toDateString()) ||
        (dateFilter === "week" && 
          transactionDate >= new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) ||
        (dateFilter === "month" && 
          transactionDate >= new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));

      // User filter
      const matchesUser = userFilter === "all" || 
        transaction.staffName === userFilter;

      // Action filter
      const matchesAction = 
        actionFilter === "all" ||
        (actionFilter === "sales" && !transaction.isCreditSale && !transaction.isPartialPayment && !transaction.isRefunded) ||
        (actionFilter === "credit" && transaction.isCreditSale && !transaction.isPartialPayment) ||
        (actionFilter === "partial" && transaction.isPartialPayment) ||
        (actionFilter === "refunded" && transaction.isRefunded) ||
        (actionFilter === "hold" && transaction.status === "hold") ||
        (actionFilter === "cancelled" && transaction.status === "cancelled");

      return matchesSearch && matchesDate && matchesUser && matchesAction;
    });
  }, [transactions, searchQuery, dateFilter, userFilter, actionFilter]);

  // Get unique staff names for user filter
  const staffNames = useMemo(() => {
    const names = new Set(transactions.map(t => t.staffName));
    return Array.from(names);
  }, [transactions]);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return t("আজ", "Today");
    } else if (date.toDateString() === yesterday.toDateString()) {
      return t("গতকাল", "Yesterday");
    } else {
      return date.toLocaleDateString(language === "bn" ? "bn-BD" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(language === "bn" ? "bn-BD" : "en-US", {
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const handleRefund = (transaction: Transaction) => {
    // P2: Restore stock using captured cogsLines
    try {
      transaction.items.forEach(item => {
        if (item.cogsLines && item.cogsLines.length > 0) {
          // Restore stock from COGS lines (accurate batch restoration)
          restoreStock(item.id, item.cogsLines);
        } else {
          // Legacy transactions without cogsLines - can't restore accurately
          console.warn(`Transaction ${transaction.id} item ${item.id} has no cogsLines - stock restoration skipped`);
        }
      });

      // Mark transaction as refunded
      const updatedTransactions = transactions.map(t =>
        t.id === transaction.id ? { ...t, isRefunded: true } : t
      );
      setTransactions(updatedTransactions);
      shopStorage.setItem("transactions", JSON.stringify(updatedTransactions));

      // P2: If this was a credit sale, reduce customer's outstanding balance
      if (transaction.customerId && (transaction.isCreditSale || transaction.isPartialPayment)) {
        const storedCredit = shopStorage.getItem("creditData");
        if (storedCredit) {
          let creditData = JSON.parse(storedCredit);
          creditData.customers = creditData.customers.map((c: any) => {
            if (c.id === transaction.customerId) {
              const refundAmount = transaction.partialRemainingAmount || transaction.creditAmount || 0;
              return {
                ...c,
                amount: Math.max(0, c.amount - refundAmount)
              };
            }
            return c;
          });
          shopStorage.setItem("creditData", JSON.stringify(creditData));
        }
      }

      // P0 FIX: Write audit log for refund action
      addLog({
        action: "refund",
        staffId: staff?.id.toString() || "unknown",
        staffName: staff?.name || transaction.staffName,
        reference: `INV-${transaction.id}`,
        amount: transaction.total,
        notes: transaction.customerName ? `Customer: ${transaction.customerName}` : undefined
      });

      setSelectedTransaction(null);

      // Show success message
      alert(t("লেনদেন ফেরত দেওয়া হয়েছে", "Transaction refunded successfully"));
    } catch (error) {
      console.error("Refund failed:", error);
      alert(t("ফেরত প্রক্রিয়া ব্যর্থ হয়েছে", "Refund process failed"));
    }
  };

  const handlePrintReceipt = (transaction: Transaction) => {
    // TODO: Implement Bluetooth print functionality
    alert(t("প্রিন্ট কার্যকারিতা শীঘ্রই আসছে", "Print functionality coming soon"));
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      <StandardHeader title={t("বিক্রয় ইতিহাস", "Sales History")} />

      {/* Search + Filters */}
      <div className="bg-white border-b border-[#E5E7EB]">
        {/* Search Bar */}
        <div className="px-4 pt-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("খুঁজুন (নাম, নম্বর, ID)", "Search (name, phone, ID)")}
              className="w-full h-10 pl-10 pr-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:ring-0 transition-all outline-none"
              style={{ fontFamily: "var(--font-bangla)" }}
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="px-4 pb-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="h-8 px-3 bg-white border border-[#E5E7EB] rounded-full text-xs text-[#374151] focus:border-[#059669] focus:ring-0 outline-none"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <option value="all">{t("সব তারিখ", "All Dates")}</option>
              <option value="today">{t("আজ", "Today")}</option>
              <option value="week">{t("এই সপ্তাহ", "This Week")}</option>
              <option value="month">{t("এই মাস", "This Month")}</option>
            </select>

            {/* User Filter */}
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="h-8 px-3 bg-white border border-[#E5E7EB] rounded-full text-xs text-[#374151] focus:border-[#059669] focus:ring-0 outline-none"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <option value="all">{t("সব ব্যবহারকারী", "All Users")}</option>
              {staffNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {/* Action Filter */}
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as any)}
              className="h-8 px-3 bg-white border border-[#E5E7EB] rounded-full text-xs text-[#374151] focus:border-[#059669] focus:ring-0 outline-none"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <option value="all">{t("সব ধরন", "All Types")}</option>
              <option value="sales">{t("বিক্রয়", "Sales")}</option>
              <option value="credit">{t("ক্রেডিট", "Credit")}</option>
              <option value="partial">{t("অংশান্বিত", "Partial")}</option>
              <option value="refunded">{t("ফেরত", "Refunded")}</option>
              <option value="hold">{t("হোল্ড", "Hold")}</option>
              <option value="cancelled">{t("বাতিল", "Cancelled")}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Receipt className="w-16 h-16 text-[#D1D5DB] mb-3" />
            <p className="text-sm text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কোনো লেনদেন পাওয়া যায়নি", "No transactions found")}
            </p>
          </div>
        ) : (
          filteredTransactions.map(transaction => (
            <div
              key={transaction.id}
              onClick={() => setSelectedTransaction(transaction)}
              className="bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-3 active:scale-98 transition-transform cursor-pointer hover:border-[#059669]"
            >
              {/* Header Row */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span 
                      className="text-xs font-medium text-[#6B7280]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      #{formatNumber(transaction.id)}
                    </span>
                    {transaction.isPartialPayment && (
                      <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#D97706] text-xs rounded-full" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                        {t("আংশিক", "Partial")}
                      </span>
                    )}
                    {transaction.isCreditSale && !transaction.isPartialPayment && (
                      <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#92400E] text-xs rounded-full" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                        {t("ক্রেডিট", "Credit")}
                      </span>
                    )}
                    {transaction.isRefunded && (
                      <span className="px-2 py-0.5 bg-[#FEE2E2] text-[#DC2626] text-xs rounded-full" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                        {t("ফেরত", "Refunded")}
                      </span>
                    )}
                    {transaction.status === "hold" && (
                      <span className="px-2 py-0.5 bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-400 text-amber-700 text-xs rounded-full" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                        {t("হোল্ড", "Hold")}
                      </span>
                    )}
                    {transaction.status === "cancelled" && (
                      <span className="px-2 py-0.5 bg-gradient-to-r from-red-100 to-rose-100 border border-red-400 text-red-700 text-xs rounded-full" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                        {t("বাতিল", "Cancelled")}
                      </span>
                    )}
                    {/* Sync Badge */}
                    {transaction.syncStatus === "synced" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-[#059669]" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full bg-[#9CA3AF]" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#6B7280]">
                    <Clock className="w-3.5 h-3.5" />
                    <span style={{ fontFamily: "var(--font-bangla)" }}>
                      {formatDate(transaction.timestamp)} • {formatTime(transaction.timestamp)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div 
                    className="text-lg font-bold text-[#111827]"
                    style={{ fontFamily: "var(--font-money)" }}
                  >
                    ৳{formatNumber(transaction.total)}
                  </div>
                </div>
              </div>

              {/* Staff & Payment Info */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-[#6B7280]">
                  <User className="w-3.5 h-3.5" />
                  <span style={{ fontFamily: "var(--font-bangla)" }}>
                    {transaction.staffName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[#6B7280]">
                  {transaction.paymentMethod === "cash" ? (
                    <Banknote className="w-3.5 h-3.5" />
                  ) : (
                    <CreditCard className="w-3.5 h-3.5" />
                  )}
                  <span style={{ fontFamily: "var(--font-bangla)" }}>
                    {transaction.paymentMethod === "cash" 
                      ? t("নগদ", "Cash")
                      : transaction.paymentMethod === "card"
                      ? t("কার্ড", "Card")
                      : t("মোবাইল", "Mobile")}
                  </span>
                </div>
              </div>

              {/* Items Summary */}
              <div className="pt-2 border-t border-[#E5E7EB]">
                <div className="text-xs text-[#6B7280] space-y-1">
                  {transaction.items.slice(0, 2).map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span style={{ fontFamily: "var(--font-sans)" }}>
                        {item.name}
                      </span>
                      <span style={{ fontFamily: "var(--font-sans)" }}>
                        {formatNumber(item.quantity)}x
                      </span>
                    </div>
                  ))}
                  {transaction.items.length > 2 && (
                    <div className="text-[#059669] text-xs" style={{ fontFamily: "var(--font-bangla)" }}>
                      +{formatNumber(transaction.items.length - 2)} {t("আরও", "more")}
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Info (for credit sales) */}
              {transaction.customerName && !transaction.isPartialPayment && (
                <div className="pt-2 border-t border-[#E5E7EB]">
                  <div className="text-xs text-[#6B7280]">
                    <span style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("ক্রেতা:", "Customer:")} {transaction.customerName}
                    </span>
                  </div>
                </div>
              )}

              {/* Partial Payment Footer */}
              {transaction.isPartialPayment && transaction.partialPaidAmount !== undefined && transaction.partialRemainingAmount !== undefined && (
                <div className="pt-2 border-t border-[#FCD34D]">
                  <div className="bg-gradient-to-r from-[#FEF3C7] to-[#FDE68A] rounded-lg p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }} className="text-[#92400E]">
                        {t("পরিশোধিত:", "Paid:")}
                      </span>
                      <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#059669]">
                        ৳{formatNumber(transaction.partialPaidAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }} className="text-[#92400E]">
                        {t("বাকি:", "Due:")}
                      </span>
                      <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#D97706]">
                        ৳{formatNumber(transaction.partialRemainingAmount)}
                      </span>
                    </div>
                    {transaction.customerName && (
                      <div className="mt-1.5 pt-1.5 border-t border-[#FCD34D]/30 text-xs text-[#92400E]">
                        <span style={{ fontFamily: "var(--font-bangla)" }}>
                          {t("ক্রেতা:", "Customer:")} {transaction.customerName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-6 py-4 flex justify-between items-center rounded-t-2xl">
              <h2 className="text-lg font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("লেনদেনের বিস্তারিত", "Transaction Details")}
              </h2>
              <button
                onClick={() => setSelectedTransaction(null)}
                className="w-8 h-8 rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] flex items-center justify-center transition-colors"
              >
                <XCircle className="w-5 h-5 text-[#6B7280]" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              {/* Transaction Info */}
              <div className="bg-[#F9FAFB] rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("লেনদেন ID", "Transaction ID")}
                  </span>
                  <span className="text-sm font-medium text-[#111827]" style={{ fontFamily: "var(--font-sans)" }}>
                    #{formatNumber(selectedTransaction.id)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("সময়", "Time")}
                  </span>
                  <span className="text-sm font-medium text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {formatDate(selectedTransaction.timestamp)} • {formatTime(selectedTransaction.timestamp)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("স্টাফ", "Staff")}
                  </span>
                  <span className="text-sm font-medium text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {selectedTransaction.staffName}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("পেমেন্ট মাধ্যম", "Payment Method")}
                  </span>
                  <span className="text-sm font-medium text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {selectedTransaction.paymentMethod === "cash" 
                      ? t("নগদ", "Cash")
                      : selectedTransaction.paymentMethod === "card"
                      ? t("কার্ড", "Card")
                      : t("মোবাইল", "Mobile")}
                  </span>
                </div>
              </div>

              {/* Items List */}
              <div>
                <h3 className="text-sm font-bold text-[#111827] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("পণ্য তালিকা", "Items")}
                </h3>
                <div className="space-y-2">
                  {selectedTransaction.items.map((item, idx) => (
                    <div key={idx} className="bg-[#F9FAFB] rounded-lg p-3">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-sm font-medium text-[#111827]" style={{ fontFamily: "var(--font-sans)" }}>
                          {item.name}
                        </span>
                        <span className="text-sm font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                          ৳{formatNumber(item.total)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-[#6B7280]">
                        <span style={{ fontFamily: "var(--font-money)" }}>
                          ৳{formatNumber(item.price)} × {formatNumber(item.quantity)}
                        </span>
                        {item.manufacturer && (
                          <span style={{ fontFamily: "var(--font-bangla)" }}>
                            {language === "bn" ? item.manufacturerBn || item.manufacturer : item.manufacturer}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total Breakdown */}
              <div className="bg-[#F9FAFB] rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("উপমোট", "Subtotal")}
                  </span>
                  <span className="text-sm font-medium text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                    ৳{formatNumber(selectedTransaction.subtotal)}
                  </span>
                </div>
                {selectedTransaction.discount > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("ছাড়", "Discount")}
                    </span>
                    <span className="text-sm font-medium text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
                      -৳{formatNumber(selectedTransaction.discount)}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-[#E5E7EB] flex justify-between items-center">
                  <span className="text-base font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("মোট", "Total")}
                  </span>
                  <span className="text-xl font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                    ৳{formatNumber(selectedTransaction.total)}
                  </span>
                </div>
              </div>

              {/* Payment Breakdown (for partial payments) */}
              {selectedTransaction.isPartialPayment && (
                <div className="bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A] rounded-lg p-4 border-2 border-[#FCD34D]">
                  <h3 className="text-sm font-bold text-[#92400E] mb-3" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("পেমেন্ট বিবরণ", "Payment Breakdown")}
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("পরিশোধিত পরিমাণ", "Amount Paid")}
                      </span>
                      <span className="text-base font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                        ৳{formatNumber(selectedTransaction.partialPaidAmount || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("বাকি পরিমাণ", "Remaining Due")}
                      </span>
                      <span className="text-base font-bold text-[#D97706]" style={{ fontFamily: "var(--font-money)" }}>
                        ৳{formatNumber(selectedTransaction.partialRemainingAmount || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-[#FCD34D]/40 text-xs text-[#92400E]">
                      <div className="flex items-center justify-between">
                        <span style={{ fontFamily: "var(--font-bangla)" }}>
                          {t("পেমেন্ট পদ্ধতি:", "Payment Method:")}
                        </span>
                        <span style={{ fontFamily: "var(--font-bangla)" }}>
                          {selectedTransaction.paymentMethod === "split" ? t("আংশিক পেমেন্ট", "Partial Payment") : selectedTransaction.paymentMethod}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span style={{ fontFamily: "var(--font-bangla)" }}>
                          {t("তারিখ/সময়:", "Date/Time:")}
                        </span>
                        <span style={{ fontFamily: "var(--font-bangla)" }}>
                          {formatDate(selectedTransaction.timestamp)} • {formatTime(selectedTransaction.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Customer Info (for credit sales) */}
              {selectedTransaction.customerName && (
                <div className="bg-[#FEF3C7] rounded-lg p-4 space-y-2">
                  <h3 className="text-sm font-bold text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("ক্রেতার তথ্য", "Customer Information")}
                  </h3>
                  <div className="space-y-1 text-sm text-[#92400E]">
                    <div style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("নাম:", "Name:")} {selectedTransaction.customerName}
                    </div>
                    {selectedTransaction.customerPhone && (
                      <div style={{ fontFamily: "var(--font-sans)" }}>
                        {t("ফোন:", "Phone:")} {selectedTransaction.customerPhone}
                      </div>
                    )}
                    {selectedTransaction.creditAmount && (
                      <div style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("বাকির পরিমাণ:", "Credit Amount:")} ৳{formatNumber(selectedTransaction.creditAmount)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handlePrintReceipt(selectedTransaction)}
                  className="flex-1 h-12 bg-[#F3F4F6] text-[#374151] rounded-lg font-medium hover:bg-[#E5E7EB] transition-colors flex items-center justify-center gap-2"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  <Printer className="w-4 h-4" />
                  {t("প্রিন্ট", "Print")}
                </button>
                {!selectedTransaction.isRefunded && (
                  <button
                    onClick={() => {
                      if (confirm(t("আপনি কি এই লেনদেন ফেরত দিতে চান?", "Do you want to refund this transaction?"))) {
                        handleRefund(selectedTransaction);
                      }
                    }}
                    className="flex-1 h-12 bg-[#DC2626] text-white rounded-lg font-medium hover:bg-[#B91C1C] transition-colors flex items-center justify-center gap-2"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t("ফেরত", "Refund")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}