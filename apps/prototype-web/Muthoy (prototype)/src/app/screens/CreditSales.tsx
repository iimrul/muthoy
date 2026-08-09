import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";

import { useEffect, useState, useMemo, useCallback } from "react";
import { RefreshCw, X, Search, ChevronRight, CheckCircle } from "lucide-react";
import { notifyCashUpdated } from "../services/cash/cashCalculation";
import { useNavigate } from "../utils/navigation";
import { useAuth } from "../contexts/AuthContext";
import { shopStorage } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";

export function CreditSales() {
  const { t, language, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const { isOwner, hasPermission, isAuthenticated } = useAuth();
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const totalOutstanding = customers.reduce((sum, c) => sum + c.amount, 0);

  const loadCreditData = useCallback(() => {
    const storedCredit = shopStorage.getItem("creditData");
    if (storedCredit) {
      const creditData = JSON.parse(storedCredit);
      // Ensure all customers have required fields
      const validCustomers = (creditData.customers || []).map((c: any) => ({
        ...c,
        name: c.name || "Unknown",
        nameEn: c.nameEn || "Unknown",
        phone: c.phone || "N/A"
      }));
      setCustomers(validCustomers);
    } else {
      // Fresh shop — no seed customers. Persist an empty list so subsequent
      // writes have somewhere to attach.
      shopStorage.setItem("creditData", JSON.stringify({ customers: [] }));
      setCustomers([]);
    }
  }, []);

  const handleSync = () => {
    setIsSyncing(true);
    // Simulate sync operation
    setTimeout(() => {
      loadCreditData();
      setIsSyncing(false);
      setLastSynced(new Date());
    }, 1500);
  };

  // Load credit data from localStorage
  useEffect(() => {
    loadCreditData();
  }, [loadCreditData]);

  // Reload credit data when active shop changes
  useActiveShopReload(loadCreditData);

  // Save to localStorage whenever customers change
  useEffect(() => {
    // P2: Removed totalOutstanding denormalized cache - computed on read
    const creditData = {
      customers: customers
    };
    shopStorage.setItem("creditData", JSON.stringify(creditData));
  }, [customers]);

  const handleOpenModal = (customer: any) => {
    setSelectedCustomer(customer);
    setReceivedAmount("");
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCustomer(null);
    setReceivedAmount("");
  };

  const handlePayment = () => {
    const payment = parseFloat(receivedAmount);
    if (isNaN(payment) || payment <= 0 || payment > selectedCustomer.amount) {
      alert(t("সঠিক পরিমাণ লিখুন", "Please enter a valid amount"));
      return;
    }

    const newBalance = selectedCustomer.amount - payment;

    // FIFO Payment Allocation Logic
    // Get all unpaid/partial transactions for this customer, sorted by date (oldest first)
    const transactionsStr = shopStorage.getItem("transactions");
    const allTransactions = transactionsStr ? JSON.parse(transactionsStr) : [];
    
    const customerTransactions = allTransactions
      .filter((t: any) => {
        const isCreditRelated = (t.isCreditSale || t.isPartialPayment) && 
                               t.customerPhone === selectedCustomer.phone &&
                               (!t.creditPaid || (t.isPartialPayment && (t.partialRemainingAmount || 0) > 0));
        return isCreditRelated;
      })
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // FIFO: Oldest first

    // Allocate payment using FIFO
    let remainingPayment = payment;
    const paymentAllocations: Array<{transactionId: number, amount: number, status: string}> = [];
    
    const updatedTransactions = allTransactions.map((t: any) => {
      // Find if this transaction needs payment allocation
      const transactionIndex = customerTransactions.findIndex((ct: any) => ct.id === t.id);
      if (transactionIndex === -1 || remainingPayment <= 0) return t;

      // Calculate how much is due on this transaction
      const alreadyPaid = t.partialPaidAmount || 0;
      const transactionDue = t.total - alreadyPaid;
      
      // Allocate payment to this transaction
      const amountToAllocate = Math.min(remainingPayment, transactionDue);
      remainingPayment -= amountToAllocate;
      
      const newTotalPaid = alreadyPaid + amountToAllocate;
      const newRemaining = t.total - newTotalPaid;
      
      // Track allocation for record keeping
      const allocationStatus = newRemaining === 0 ? "settled" : "partial";
      paymentAllocations.push({
        transactionId: t.id,
        amount: amountToAllocate,
        status: allocationStatus
      });

      // Update transaction status
      if (newRemaining === 0) {
        // Fully settled
        return {
          ...t,
          creditPaid: true,
          partialPaidAmount: t.total,
          partialRemainingAmount: 0,
          isPartialPayment: false,
          isCreditSale: true,
          paymentDate: new Date().toISOString(),
          lastPaymentAllocation: amountToAllocate
        };
      } else {
        // Partial payment
        return {
          ...t,
          isPartialPayment: true,
          isCreditSale: true,
          partialPaidAmount: newTotalPaid,
          partialRemainingAmount: newRemaining,
          lastPaymentDate: new Date().toISOString(),
          lastPaymentAllocation: amountToAllocate
        };
      }
    });

    shopStorage.setItem("transactions", JSON.stringify(updatedTransactions));

    // Store payment allocation details for record keeping
    shopStorage.setItem("lastPaymentAllocation", JSON.stringify({
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      totalPaid: payment,
      allocations: paymentAllocations,
      timestamp: new Date().toISOString()
    }));

    // Create settled history record
    const settledRecord = {
      id: Date.now(),
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      customerNameEn: selectedCustomer.nameEn,
      customerPhone: selectedCustomer.phone,
      purchaseId: customerTransactions.length > 0 ? customerTransactions[0].id : selectedCustomer.id,
      settlementDate: new Date().toISOString().split("T")[0],
      settlementTimestamp: new Date().toISOString(),
      amount: payment,
      paymentMethod: "cash",
      referenceId: `REF-${Date.now()}`,
      staffName: localStorage.getItem("currentUser") 
        ? JSON.parse(localStorage.getItem("currentUser") || "{}").name 
        : "Admin",
      syncStatus: "local",
      allocations: paymentAllocations // Store FIFO allocation details
    };

    // Save to settled history
    const existingSettledHistory = shopStorage.getItem("settledCreditHistory");
    const settledHistory = existingSettledHistory ? JSON.parse(existingSettledHistory) : [];
    settledHistory.push(settledRecord);
    shopStorage.setItem("settledCreditHistory", JSON.stringify(settledHistory));
    notifyCashUpdated();

    // Update customer amount - KEEP customer in list even if balance is zero
    const updatedCustomers = customers.map(c => {
      if (c.id === selectedCustomer.id) {
        return {
          ...c,
          amount: newBalance,
          lastDate: new Date().toISOString().split("T")[0],
          lastPaymentDate: new Date().toISOString(),
          hasSettledHistory: true
        };
      }
      return c;
    });

    setCustomers(updatedCustomers);
    
    // Also update creditData in localStorage
    shopStorage.setItem("creditData", JSON.stringify({ customers: updatedCustomers }));
    
    handleCloseModal();
  };

  // Permission check - deferred to avoid suspension conflicts
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("credit_view")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  // Filtered customers based on search query
  const staffByCustomerId = useMemo(() => {
    const txStr = shopStorage.getItem("transactions");
    const txs = txStr ? JSON.parse(txStr) : [];
    const byId: Record<number, any> = {};
    for (const tx of txs) byId[tx.id] = tx;
    const map: Record<number, string> = {};
    for (const c of customers) {
      if (c.lastTransactionId && byId[c.lastTransactionId]?.staffName) {
        map[c.id] = byId[c.lastTransactionId].staffName;
      }
    }
    return map;
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery) return customers;
    
    const searchLower = searchQuery.toLowerCase();
    return customers.filter(customer => 
      customer.name.toLowerCase().includes(searchLower) ||
      customer.nameEn.toLowerCase().includes(searchLower) ||
      customer.phone.includes(searchQuery) ||
      customer.id.toString().includes(searchQuery)
    );
  }, [customers, searchQuery]);

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader
        title={t("বাকি বিক্রয়", "Credit Sales")}
        right={
          <button
            onClick={handleSync}
            className={`relative p-2 rounded-full hover:bg-[#ECFDF5] transition-all ${
              isSyncing ? 'animate-spin' : ''
            }`}
            aria-label="Sync"
            title={lastSynced ? `Last synced: ${lastSynced.toLocaleTimeString()}` : 'Sync now'}
          >
            <RefreshCw className="w-5 h-5 text-[#059669]" />
            {lastSynced && (
              <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#A6F2D1] rounded-full"></span>
            )}
          </button>
        }
      />

      {/* Summary */}
      <div className="px-4 py-4">
        <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
          <p
            className="text-xs text-[#6B7280] mb-1"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("মোট বকেয়া", "Total Outstanding")}
          </p>
          <p
            className="text-3xl mb-1"
            style={{ fontFamily: "var(--font-money)", color: "#111827" }}
          >
            ৳ {formatNumber(totalOutstanding.toLocaleString())}
          </p>
          <p
            className="text-sm text-[#6B7280]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {formatNumber(customers.length)} {t("জন গ্রাহক", "customers")}
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("খুঁজুন (নাম, ফোন, ID)", "Search (name, phone, ID)")}
              className="w-full h-10 pl-10 pr-4 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:ring-0 transition-all outline-none"
              style={{ fontFamily: "var(--font-bangla)" }}
            />
          </div>
        </div>

        {/* Customer List */}
        <div className="space-y-3">
          {filteredCustomers.length === 0 ? (
            <div className="bg-white p-6 rounded-lg shadow-sm text-center">
              <p className="text-sm text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("কো বাকি গ্রাহক নেই", "No credit customers yet")}
              </p>
              <p className="text-xs text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("চেকআউট থেকে বাকিতে বিক্রয় করুন", "Make credit sales from checkout")}
              </p>
            </div>
          ) : (
            <>
              {filteredCustomers.map((customer) => (
                <div key={customer.id} className="bg-white p-4 rounded-lg shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4
                        className="text-base text-[#111827] mb-1.5"
                        style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
                      >
                        {language === "bn" ? customer.name : customer.nameEn}
                      </h4>
                      <p 
                        className="text-sm text-[#059669] mb-1.5"
                        style={{ fontFamily: "var(--font-money)", fontWeight: 500 }}
                      >
                        {customer.phone}
                      </p>
                      <p
                        className="text-xs text-[#6B7280]"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("শেষ লেনদেন:", "Last Transaction:")} {customer.lastDate}
                      </p>
                      {staffByCustomerId[customer.id] && (
                        <p
                          className="text-xs text-[#6B7280] mt-1"
                          style={{ fontFamily: "var(--font-bangla)" }}
                        >
                          {t("বিক্রেতা:", "Sold by:")} <span className="text-[#059669] font-semibold">{staffByCustomerId[customer.id]}</span>
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p
                        className="text-xl mb-1"
                        style={{ fontFamily: "var(--font-money)", color: customer.amount === 0 ? "#059669" : "#111827" }}
                      >
                        ৳ {formatNumber(customer.amount.toLocaleString())}
                      </p>
                      {customer.amount === 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#ECFDF5] text-[#059669] text-xs rounded-full font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
                          <CheckCircle className="w-3 h-3" />
                          {t("পরিশোধিত", "Settled")}
                        </span>
                      ) : customer.overdue ? (
                        <Badge
                          className="bg-[#DC2626] text-white text-xs"
                          style={{ fontFamily: "var(--font-bangla)" }}
                        >
                          {t("মেয়াদোত্তীর্ণ", "Overdue")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {customer.amount > 0 && (
                    <button
                      onClick={() => handleOpenModal(customer)}
                      className="w-full py-2 text-sm text-[#059669] hover:bg-[#ECFDF5] rounded-lg transition-colors"
                      style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                    >
                      {t("পেমেন্ট করুন", "Make Payment")}
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/app/credit/${customer.id}`)}
                    className={`w-full py-2 ${customer.amount > 0 ? 'mt-2' : ''} text-sm bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] rounded-lg transition-colors flex items-center justify-center gap-2`}
                    style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                  >
                    {t("বিস্তারিত দেখুন", "View Details")}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      {isModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3
                className="text-lg text-[#111827]"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
              >
                {t("পেমেন্ট করুন", "Make Payment")}
              </h3>
              <button
                onClick={handleCloseModal}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#6B7280]" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Customer Info */}
              <div className="bg-[#F9FAFB] rounded-lg p-3">
                <p
                  className="text-sm text-[#111827] mb-1"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {language === "bn" ? selectedCustomer.name : selectedCustomer.nameEn}
                </p>
                <p className="text-xs text-[#6B7280] mb-2">{selectedCustomer.phone}</p>
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs text-[#6B7280]"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {t("মোট বকেয়া", "Total Outstanding")}
                  </span>
                  <span
                    className="text-lg text-[#DC2626]"
                    style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                  >
                    ৳ {formatNumber(selectedCustomer.amount.toLocaleString())}
                  </span>
                </div>
              </div>

              {/* Payment Input */}
              <div>
                <label
                  className="block text-sm text-[#111827] mb-2"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {t("পেমেন্ট পরিমাণ", "Payment Amount")}
                </label>
                <Input
                  type="number"
                  value={receivedAmount}
                  onChange={(e) => setReceivedAmount(e.target.value)}
                  placeholder={t("পরিমণ লিখুন", "Enter amount")}
                  className="h-12 text-lg"
                  style={{ fontFamily: "var(--font-money)" }}
                  max={selectedCustomer.amount}
                  min={0}
                />
              </div>

              {/* Quick Amount Buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setReceivedAmount((selectedCustomer.amount / 2).toString())}
                  className="py-2 px-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-lg text-sm transition-colors"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {t("অর্ধেক", "Half")}
                </button>
                <button
                  onClick={() => setReceivedAmount(selectedCustomer.amount.toString())}
                  className="py-2 px-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-lg text-sm transition-colors"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {t("সম্পূর্ণ", "Full")}
                </button>
                <button
                  onClick={() => setReceivedAmount("")}
                  className="py-2 px-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-lg text-sm transition-colors"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {t("মুছুন", "Clear")}
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 p-4 border-t border-gray-200">
              <Button
                onClick={handleCloseModal}
                variant="outline"
                className="flex-1 h-11"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("বাতিল", "Cancel")}
              </Button>
              <Button
                onClick={handlePayment}
                className="flex-1 h-11 bg-[#059669] hover:bg-[#047857] text-white"
                style={{ fontFamily: "var(--font-bangla)" }}
                disabled={!receivedAmount || parseFloat(receivedAmount) <= 0}
              >
                {t("পেমেন্ট করুন", "Confirm Payment")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
