import { useState, useMemo } from "react";
import { useParams } from "react-router";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import {
  User,
  Phone, 
  Calendar, 
  CreditCard, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Receipt,
  Filter
} from "lucide-react";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

interface CreditPurchase {
  id: number;
  date: string;
  timestamp: string;
  amount: number;
  amountPaid: number;
  amountDue: number;
  status: "unpaid" | "partial" | "settled";
  items: Array<{
    name: string;
    nameBn: string;
    quantity: number;
    price: number;
  }>;
  transactionId?: number;
  syncStatus?: "synced" | "local";
}

interface SettledRecord {
  id: number;
  purchaseId: number;
  settlementDate: string;
  settlementTimestamp: string;
  amount: number;
  paymentMethod: string;
  referenceId: string;
  staffName?: string;
  syncStatus?: "synced" | "local";
}

interface CustomerData {
  id: number;
  name: string;
  nameEn: string;
  phone: string;
  totalAmount: number;
  purchases: CreditPurchase[];
  settledHistory: SettledRecord[];
}

export function CustomerCreditDetail() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { t, language, formatNumber, formatCurrency } = useLanguage();
  
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "partial">("all");
  const [viewMode, setViewMode] = useState<"purchases" | "settled">("purchases");

  // Mock customer data - in production, this would be fetched from localStorage or API
  const customerData: CustomerData = useMemo(() => {
    // Load from localStorage
    const creditDataStr = shopStorage.getItem("creditData");
    const transactionsStr = shopStorage.getItem("transactions");
    const settledHistoryStr = shopStorage.getItem("settledCreditHistory");
    
    if (creditDataStr) {
      const creditData = JSON.parse(creditDataStr);
      const customer = creditData.customers?.find((c: any) => c.id === parseInt(customerId || "0"));
      
      if (customer) {
        // Get credit purchases from transactions
        const allTransactions = transactionsStr ? JSON.parse(transactionsStr) : [];
        
        const customerPurchases = allTransactions
          .filter((t: any) => {
            // Include ALL credit-related transactions for this customer:
            // 1. Credit sales (isCreditSale = true)
            // 2. Partial payments (isPartialPayment = true)
            // 3. Fully settled credit sales (creditPaid = true)
            const isCreditRelated = t.isCreditSale || t.isPartialPayment || t.creditPaid;
            const isThisCustomer = t.customerPhone === customer.phone;
            
            return isCreditRelated && isThisCustomer;
          })
          .map((t: any) => {
            // Determine status based on payment state
            let status: "unpaid" | "partial" | "settled" = "unpaid";
            let amountPaid = 0;
            let amountDue = t.total;

            if (t.creditPaid) {
              // Fully settled
              status = "settled";
              amountPaid = t.total;
              amountDue = 0;
            } else if (t.isPartialPayment) {
              // Partially paid
              status = "partial";
              amountPaid = t.partialPaidAmount || 0;
              amountDue = t.partialRemainingAmount || (t.total - amountPaid);
              
              // Double check: If remaining amount is 0, it's settled
              if (amountDue === 0 || t.partialRemainingAmount === 0) {
                status = "settled";
                amountPaid = t.total;
                amountDue = 0;
              }
            } else if (t.isCreditSale && !t.creditPaid) {
              // Unpaid credit sale
              status = "unpaid";
              amountPaid = 0;
              amountDue = t.total;
            }

            return {
              id: t.id,
              date: t.date,
              timestamp: t.timestamp || new Date().toISOString(),
              amount: t.total,
              amountPaid: amountPaid,
              amountDue: amountDue,
              status: status,
              items: t.items || [],
              transactionId: t.id,
              syncStatus: t.syncStatus || "local"
            };
          });

        // Get settled history
        const settledHistory = settledHistoryStr ? JSON.parse(settledHistoryStr) : [];
        const customerSettled = settledHistory.filter((s: SettledRecord) => 
          s.customerId === customer.id || s.customerPhone === customer.phone
        );

        return {
          id: customer.id,
          name: customer.name,
          nameEn: customer.nameEn,
          phone: customer.phone,
          totalAmount: customer.amount || 0,
          purchases: customerPurchases,
          settledHistory: customerSettled
        };
      }
    }

    return {
      id: 0,
      name: "Unknown",
      nameEn: "Unknown",
      phone: "N/A",
      totalAmount: 0,
      purchases: [],
      settledHistory: []
    };
  }, [customerId]);

  const filteredPurchases = useMemo(() => {
    // PURCHASE HISTORY (ACTIVE UNSETTLED): Shows ONLY unpaid + partial transactions
    // - Unpaid: No payment made yet
    // - Partial: Some payment made, balance remaining
    // - Settled transactions are EXCLUDED (they appear only in Settled History)
    // - Sorted by date: NEWEST FIRST (Latest transactions at top)
    
    let purchases = customerData.purchases.filter(p => p.status !== "settled");
    
    // Sort by timestamp - NEWEST first (reverse chronological)
    purchases.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Apply status filter
    if (statusFilter === "all") return purchases;
    return purchases.filter(p => p.status === statusFilter);
  }, [customerData.purchases, statusFilter]);

  const settledPurchases = useMemo(() => {
    // SETTLED HISTORY: Only show FULLY paid transactions
    // - Full payment clears all balance (amountDue = 0)
    // - Partial payments DO NOT appear here (they stay in Purchase History only)
    // - Settled transactions appear ONLY here, not in Purchase History
    // - Sorted by settlement date: NEWEST FIRST (Latest settlements at top)
    const settled = customerData.purchases.filter(p => p.status === "settled" && p.amountDue === 0);
    
    // Sort by timestamp - NEWEST first (reverse chronological)
    settled.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return settled;
  }, [customerData.purchases]);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "settled":
        return (
          <span className="px-2 py-0.5 bg-[#ECFDF5] text-[#059669] text-xs rounded-full font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("পরিশোধিত", "Settled")}
          </span>
        );
      case "partial":
        return (
          <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#D97706] text-xs rounded-full font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("আংশিক", "Partial")}
          </span>
        );
      case "unpaid":
        return (
          <span className="px-2 py-0.5 bg-[#FEE2E2] text-[#DC2626] text-xs rounded-full font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("অপরিশোধিত", "Unpaid")}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      <StandardHeader title={language === "bn" ? customerData.name : customerData.nameEn} />

      <div>
        {/* Customer Info Card */}
        <div className="px-4 pt-3 pb-4">
          <div className="bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-xl p-4 border-2 border-[#059669]">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <h2 className="text-lg font-bold text-[#047857] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                  {language === "bn" ? customerData.name : customerData.nameEn}
                </h2>
                <div className="flex items-center gap-2 text-sm text-[#065f46] mb-1">
                  <Phone className="w-3.5 h-3.5" />
                  <span style={{ fontFamily: "var(--font-sans)" }}>{customerData.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#065f46]">
                  <User className="w-3.5 h-3.5" />
                  <span style={{ fontFamily: "var(--font-bangla)" }}>
                    ID: {formatNumber(customerData.id)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#065f46] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("মোট বাকি", "Total Due")}
                </p>
                <p className="text-2xl font-bold text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
                  ৳ {formatCurrency(customerData.totalAmount)}
                </p>
              </div>
            </div>
            <div className="flex gap-2 text-xs">
              <div className="flex-1 bg-white/60 rounded-lg p-2 text-center">
                <p className="text-[#065f46] mb-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("মোট ক্রয়", "Total Purchases")}
                </p>
                <p className="text-base font-bold text-[#047857]" style={{ fontFamily: "var(--font-money)" }}>
                  {formatNumber(customerData.purchases.length)}
                </p>
              </div>
              <div className="flex-1 bg-white/60 rounded-lg p-2 text-center">
                <p className="text-[#065f46] mb-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("পরিশোধিত", "Settled")}
                </p>
                <p className="text-base font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                  {formatNumber(settledPurchases.length)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="px-4 pb-3 flex gap-2">
          <button
            onClick={() => setViewMode("purchases")}
            className={`flex-1 h-10 rounded-lg font-semibold transition-all ${
              viewMode === "purchases"
                ? "bg-[#059669] text-white"
                : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("ক্রয়ের ইতিহাস", "Purchase History")}
          </button>
          <button
            onClick={() => setViewMode("settled")}
            className={`flex-1 h-10 rounded-lg font-semibold transition-all ${
              viewMode === "settled"
                ? "bg-[#059669] text-white"
                : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("পরিশোধের ইতিহাস", "Settled History")}
          </button>
        </div>

        {/* Status Filter (only for purchases view) */}
        {viewMode === "purchases" && (
          <div className="px-4 pb-3 overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-8 px-3 bg-white border border-[#E5E7EB] rounded-full text-xs text-[#374151] focus:border-[#059669] focus:ring-0 outline-none"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                <option value="all">{t("সব দেখুন", "All Status")}</option>
                <option value="unpaid">{t("অপরিশোধিত", "Unpaid")}</option>
                <option value="partial">{t("আংশিক", "Partial")}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {viewMode === "purchases" ? (
          // Purchase History View
          filteredPurchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Receipt className="w-16 h-16 text-[#D1D5DB] mb-3" />
              <p className="text-sm text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("কোনো ক্রয় ইতিহাস পাওয়া যায়নি", "No purchase history found")}
              </p>
            </div>
          ) : (
            filteredPurchases.map((purchase) => (
              <div
                key={purchase.id}
                className="bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-3 hover:border-[#059669] transition-colors"
              >
                {/* Purchase Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-medium text-[#6B7280]" style={{ fontFamily: "var(--font-sans)" }}>
                        #{formatNumber(purchase.id)}
                      </span>
                      {getStatusBadge(purchase.status)}
                      {purchase.syncStatus === "synced" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-[#059669]" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-[#9CA3AF]" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#6B7280]">
                      <Clock className="w-3.5 h-3.5" />
                      <span style={{ fontFamily: "var(--font-bangla)" }}>
                        {formatDate(purchase.timestamp)} • {formatTime(purchase.timestamp)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xl font-bold text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
                      ৳ {formatCurrency(purchase.amount)}
                    </div>
                  </div>
                </div>

                {/* Items Summary */}
                <div className="pt-2 border-t border-[#E5E7EB]">
                  <div className="text-xs text-[#6B7280] space-y-1">
                    {purchase.items.slice(0, 2).map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span style={{ fontFamily: "var(--font-sans)" }}>
                          {language === "bn" ? item.nameBn || item.name : item.name}
                        </span>
                        <span style={{ fontFamily: "var(--font-money)" }}>
                          {formatNumber(item.quantity)}x
                        </span>
                      </div>
                    ))}
                    {purchase.items.length > 2 && (
                      <div className="text-[#059669] text-xs" style={{ fontFamily: "var(--font-bangla)" }}>
                        +{formatNumber(purchase.items.length - 2)} {t("আরও", "more")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Payment Status */}
                {(purchase.status === "partial" || purchase.status === "settled") && (
                  <div className="pt-2 border-t border-[#E5E7EB]">
                    <div className="bg-[#F9FAFB] rounded-lg p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ fontFamily: "var(--font-bangla)" }} className="text-[#6B7280]">
                          {t("পরিশোধিত:", "Paid:")}
                        </span>
                        <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#059669]">
                          ৳ {formatCurrency(purchase.amountPaid)}
                        </span>
                      </div>
                      {purchase.amountDue > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span style={{ fontFamily: "var(--font-bangla)" }} className="text-[#6B7280]">
                            {t("বাকি:", "Due:")}
                          </span>
                          <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#D97706]">
                            ৳ {formatCurrency(purchase.amountDue)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )
        ) : (
          // Settled History View
          settledPurchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <CheckCircle className="w-16 h-16 text-[#D1D5DB] mb-3" />
              <p className="text-sm text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("কোনো পরিশোধের ইতিহাস নেই", "No settled history")}
              </p>
            </div>
          ) : (
            settledPurchases.map((purchase) => (
              <div
                key={purchase.id}
                className="bg-gradient-to-r from-[#ECFDF5] to-[#D1FAE5] border-2 border-[#059669] rounded-xl p-4 space-y-3"
              >
                {/* Settled Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-[#059669]" />
                      <span className="text-sm font-bold text-[#047857]" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("পরিশোধ সম্পন্ন", "Settlement Complete")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#065f46] mb-1">
                      <span className="font-medium text-[#065f46]" style={{ fontFamily: "var(--font-money)" }}>
                        #{formatNumber(purchase.id)}
                      </span>
                      {purchase.syncStatus === "synced" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-[#059669]" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-[#9CA3AF]" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#065f46]">
                      <Clock className="w-3.5 h-3.5" />
                      <span style={{ fontFamily: "var(--font-bangla)" }}>
                        {formatDate(purchase.timestamp)} • {formatTime(purchase.timestamp)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xl font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                      ৳{formatCurrency(purchase.amount)}
                    </div>
                  </div>
                </div>

                {/* Items Summary */}
                <div className="pt-2 border-t border-[#A7F3D0]">
                  <div className="text-xs text-[#065f46] space-y-1">
                    {purchase.items.slice(0, 2).map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span style={{ fontFamily: "var(--font-sans)" }}>
                          {language === "bn" ? item.nameBn || item.name : item.name}
                        </span>
                        <span style={{ fontFamily: "var(--font-money)" }}>
                          {formatNumber(item.quantity)}x
                        </span>
                      </div>
                    ))}
                    {purchase.items.length > 2 && (
                      <div className="text-[#059669] text-xs" style={{ fontFamily: "var(--font-bangla)" }}>
                        +{formatNumber(purchase.items.length - 2)} {t("আরও", "more")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Payment Summary */}
                <div className="pt-2 border-t border-[#A7F3D0]">
                  <div className="bg-white/60 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ fontFamily: "var(--font-bangla)" }} className="text-[#065f46]">
                        {t("মোট পরিমাণ:", "Total Amount:")}
                      </span>
                      <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#047857]">
                        ৳ {formatCurrency(purchase.amount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ fontFamily: "var(--font-bangla)" }} className="text-[#065f46]">
                        {t("পরিশোধিত:", "Paid:")}
                      </span>
                      <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#059669]">
                        ৳ {formatCurrency(purchase.amountPaid)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ fontFamily: "var(--font-bangla)" }} className="text-[#065f46]">
                        {t("বাকি:", "Due:")}
                      </span>
                      <span style={{ fontFamily: "var(--font-money)", fontWeight: 700 }} className="text-[#059669]">
                        ৳ {formatCurrency(purchase.amountDue)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}