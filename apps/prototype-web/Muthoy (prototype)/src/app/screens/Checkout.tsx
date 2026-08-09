import { useState, useEffect, useRef, useMemo } from "react";

import { X, Plus, Minus, Trash2, CheckCircle, Camera } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { useCart } from "../contexts/CartContext";
import { useAuditLog } from "../contexts/AuditLogContext";
import { useAuth } from "../contexts/AuthContext";
import { reduceStock, calculateItemCOGS, COGSLine, calculatePriceWithBatches } from "../utils/medicineData";
import { assertTxnValid } from "../utils/transactionValidation";
import { getReportSettings } from "../utils/reportEngine";
import { notifyCashUpdated } from "../services/cash/cashCalculation";
import { getCurrentSoldBy } from "../utils/soldBy";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

export function Checkout() {
  const navigate = useNavigate();
  const { t, language, formatNumber } = useLanguage();
  const { cartItems, updateQuantity, removeFromCart, clearCart } = useCart();
  const { addLog } = useAuditLog();
  const { isOwner, hasPermission } = useAuth();
  const [paymentType, setPaymentType] = useState<"cash" | "credit" | "split">("cash");
  const [tendered, setTendered] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [medicines, setMedicines] = useState<any[]>([]);
  
  // Success toast state
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [successAmount, setSuccessAmount] = useState(0);

  // Credit customer modal state
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerMode, setCustomerMode] = useState<"select" | "new">("select");
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // New customer form
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");

  // P0-5: Prescription fields
  const [rxNumber, setRxNumber] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [rxImage, setRxImage] = useState<string | null>(null);
  const [rxImageFile, setRxImageFile] = useState<File | null>(null);
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false);

  const processingRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Calculate subtotal from cart
  const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // Load only customers from localStorage (medicines loaded lazily on confirm)
  useEffect(() => {
    const storedCredit = shopStorage.getItem("creditData");
    if (storedCredit) {
      const creditData = JSON.parse(storedCredit);
      setCustomers(creditData.customers || []);
    } else {
      // Initialize with empty array if no credit data exists
      setCustomers([]);
    }
  }, []);

  // Get stock from cart items (already validated in SaleEntry)
  const getItemStock = (itemId: number) => {
    const item = cartItems.find(i => i.id === itemId);
    return item?.stock ?? 999;
  };

  // Check if any item exceeds stock (redundant since validated in SaleEntry, but kept for safety)
  const hasStockIssue = cartItems.some(item => item.quantity > getItemStock(item.id));

  // P0-5: Check if any item requires prescription
  // Load medicines lazily only when cart has items
  const requiresPrescription = useMemo(() => {
    if (cartItems.length === 0 || medicines.length > 0) {
      return cartItems.some(item => {
        const medicine = medicines.find(m => m.id === item.id);
        return medicine && medicine.requiresRx;
      });
    }
    // Lazy load medicines for prescription check
    const storedMedicines = shopStorage.getItem("medicines");
    if (storedMedicines) {
      const loadedMedicines = JSON.parse(storedMedicines);
      setMedicines(loadedMedicines);
      return cartItems.some(item => {
        const medicine = loadedMedicines.find((m: any) => m.id === item.id);
        return medicine && medicine.requiresRx;
      });
    }
    return false;
  }, [cartItems, medicines]);

  // Calculate discount
  const discount = parseFloat(discountAmount || "0");
  const discountPercent = subtotal > 0 ? (discount / subtotal) * 100 : 0;

  // P0-4: Calculate tax/VAT
  const taxSettings = getReportSettings();
  const subtotalAfterDiscount = subtotal - discount;
  const taxAmount = subtotalAfterDiscount * (taxSettings.taxRate / 100);
  const total = subtotalAfterDiscount + taxAmount;

  useEffect(() => {
    if (total > 0 && tendered === "") setTendered(String(total));
  }, [total]);
  const change = parseFloat(tendered || "0") - total;

  // Handle discount amount change
  const handleDiscountAmountChange = (value: string) => {
    const amount = parseFloat(value || "0");
    if (amount > subtotal) {
      setDiscountAmount(subtotal.toString());
      setDiscountPercentage("100");
    } else {
      setDiscountAmount(value);
      const percent = subtotal > 0 ? (amount / subtotal) * 100 : 0;
      setDiscountPercentage(percent > 0 ? percent.toFixed(1) : "");
    }
  };

  // Handle discount percentage change
  const handleDiscountPercentageChange = (value: string) => {
    const percent = parseFloat(value || "0");
    if (percent > 100) {
      setDiscountPercentage("100");
      setDiscountAmount(subtotal.toString());
    } else {
      setDiscountPercentage(value);
      const amount = (subtotal * percent) / 100;
      setDiscountAmount(amount > 0 ? amount.toFixed(2) : "");
    }
  };

  // Handle direct quantity input
  const handleQuantityInput = (itemId: number, value: string) => {
    const newQuantity = parseInt(value) || 0;
    if (newQuantity > 0) {
      const currentItem = cartItems.find(item => item.id === itemId);
      if (currentItem) {
        const difference = newQuantity - currentItem.quantity;
        updateQuantity(itemId, difference);
      }
    } else if (value === "" || newQuantity === 0) {
      // Allow empty field, will show 0
      const currentItem = cartItems.find(item => item.id === itemId);
      if (currentItem) {
        updateQuantity(itemId, -currentItem.quantity);
      }
    }
  };

  const handleConfirm = () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    try {
    // Validate credit payment
    if (paymentType === "credit" && !selectedCustomerId) {
      alert(t("অনুগ্রহ করে গ্রাহক নির্বাচন করুন", "Please select a customer"));
      return;
    }

    // Validate split payment - customer must be selected
    if (paymentType === "split" && !selectedCustomerId) {
      alert(t("আংশিক পেমেন্টের জন্য গ্রাহক নির্বাচন করুন", "Please select customer for partial payment"));
      return;
    }

    // Check for stock issues
    if (hasStockIssue) {
      alert(t("এক বা একাধিক পণ্যের স্টক পর্যাপ্ত নয়", "One or more items are out of stock"));
      return;
    }


    // Get current user info for tracking
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const currentStaff = JSON.parse(localStorage.getItem("currentStaff") || "null");
    const authType = localStorage.getItem("authType");

    // Get staff name
    const staffName = authType === "staff" && currentStaff
      ? currentStaff.name
      : currentUser?.name || "Owner";

    // For credit sales, get customer info
    let customerName = "";
    let customerPhone = "";
    if ((paymentType === "credit" || paymentType === "split") && selectedCustomerId) {
      const customer = customers.find(c => c.id === selectedCustomerId);
      if (customer) {
        customerName = customer.name;
        customerPhone = customer.phone;
      }
    }

    // P2: Calculate COGS for each item using FIFO before reducing stock
    // CRITICAL: Recalculate price at checkout time from current active batches (FEFO)
    const itemsWithCOGS = cartItems.map(item => {
      const cogsData = calculateItemCOGS(item.id, item.quantity);
      // Re-resolve price from current active batches (may differ from cart price if batches changed)
      const currentTotalPrice = calculatePriceWithBatches(item.id, item.quantity);
      const currentUnitPrice = item.quantity > 0 ? currentTotalPrice / item.quantity : item.price;
      return {
        id: item.id,
        name: item.name,
        nameBn: item.nameBn || item.name,
        quantity: item.quantity,
        price: currentUnitPrice,
        total: currentTotalPrice,
        unit: item.unit || "pcs",
        manufacturer: item.manufacturer,
        manufacturerBn: item.manufacturerBn,
        cogsLines: cogsData.cogsLines,
        cogs: cogsData.totalCost
      };
    });

    const totalCOGS = itemsWithCOGS.reduce((sum, item) => sum + item.cogs, 0);

    // Recalculate subtotal, discount, tax, and total from actual prices
    const actualSubtotal = itemsWithCOGS.reduce((sum, item) => sum + item.total, 0);
    const actualDiscount = parseFloat(discountAmount || "0");
    const actualSubtotalAfterDiscount = actualSubtotal - actualDiscount;
    const actualTaxAmount = actualSubtotalAfterDiscount * (taxSettings.taxRate / 100);
    const actualTotal = actualSubtotalAfterDiscount + actualTaxAmount;

    // Create transaction object first
    const newTransaction = {
      id: Date.now(),
      date: new Date().toISOString().split("T")[0],
      timestamp: new Date().toISOString(),
      staffName: staffName,
      staffId: authType === "staff" ? currentStaff?.id : currentUser?.id,
      subtotal: actualSubtotal,
      discount: actualDiscount,
      tax: actualTaxAmount, // P0-4: Tax/VAT amount
      taxRate: taxSettings.taxRate, // P0-4: Tax rate used
      taxLabel: taxSettings.taxLabel, // P0-4: Tax label (VAT/GST)
      total: actualTotal,
      paymentMethod: paymentType, // cash, credit, or split
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      customerId: selectedCustomerId || undefined, // P2: Add customerId
      isCreditSale: paymentType === "credit",
      isPartialPayment: paymentType === "split",
      partialPaidAmount: paymentType === "split" ? parseFloat(tendered || "0") : undefined,
      partialRemainingAmount: paymentType === "split" ? (actualTotal - parseFloat(tendered || "0")) : undefined,
      originalPaidAmount: paymentType === "split" ? parseFloat(tendered || "0") : (paymentType === "cash" ? actualTotal : 0),
      originalCreditAmount: paymentType === "credit" ? actualTotal : (paymentType === "split" ? (actualTotal - parseFloat(tendered || "0")) : 0),
      creditAmount: paymentType === "credit" ? actualTotal : undefined,
      isRefunded: false,
      isDeleted: false,
      // P2: Removed syncStatus (dead field)
      items: itemsWithCOGS,
      cogs: totalCOGS, // P2: Capture total COGS
      // P0-5: Prescription information
      rxNumber: requiresPrescription ? rxNumber : undefined,
      prescriberName: requiresPrescription ? prescriberName : undefined,
      rxImage: requiresPrescription && rxImage ? rxImage : undefined,
      soldBy: getCurrentSoldBy(),
    };

    // P2: Validate transaction before saving (invariant gate)
    try {
      assertTxnValid(newTransaction as any);
    } catch (error: any) {
      alert(t("লেনদেন যাচাই ব্যর্থ", "Transaction validation failed") + ": " + error.message);
      return;
    }

    // P2: Atomic write - write transaction first, then reduce stock
    // If stock reduction fails, we can rollback the transaction
    const transactionsStr = shopStorage.getItem("transactions");
    let transactions = transactionsStr ? JSON.parse(transactionsStr) : [];
    transactions.push(newTransaction);
    shopStorage.setItem("transactions", JSON.stringify(transactions));
    notifyCashUpdated();

    // Now reduce stock using FIFO batch system
    try {
      cartItems.forEach(cartItem => {
        reduceStock(cartItem.id, cartItem.quantity);
      });
    } catch (error) {
      // Rollback transaction if stock reduction fails
      transactions = transactions.filter(t => t.id !== newTransaction.id);
      shopStorage.setItem("transactions", JSON.stringify(transactions));
      alert(t("স্টক আপডেট ব্যর্থ হয়েছে", "Failed to update stock"));
      return;
    }

    // P2: Removed salesHistory parallel store - dashboard will derive from transactions

    // P0: Add audit log for sale
    addLog({
      action: "sale",
      staffId: String(authType === "staff" ? currentStaff?.id : currentUser?.id),
      staffName: staffName,
      reference: `TXN-${newTransaction.id}`,
      amount: actualTotal,
      notes: paymentType === "credit"
        ? `Credit sale - ${customerName}${requiresPrescription ? ` | Rx: ${rxNumber} by ${prescriberName}` : ""}`
        : paymentType === "split"
        ? `Partial payment - ${customerName} (Paid: ৳${parseFloat(tendered || "0")}, Credit: ৳${actualTotal - parseFloat(tendered || "0")})${requiresPrescription ? ` | Rx: ${rxNumber} by ${prescriberName}` : ""}`
        : `Cash sale${requiresPrescription ? ` | Rx: ${rxNumber} by ${prescriberName}` : ""}`
    });

    // Handle credit sale
    if (paymentType === "credit" && selectedCustomerId) {
      const storedCredit = shopStorage.getItem("creditData");
      let creditData = storedCredit ? JSON.parse(storedCredit) : { customers: [] };

      // Update customer's outstanding balance
      const updatedCustomers = creditData.customers.map((c: any) => {
        if (c.id === selectedCustomerId) {
          return {
            ...c,
            amount: c.amount + actualTotal,
            lastDate: new Date().toISOString().split("T")[0],
            lastTransactionId: newTransaction.id // Link transaction to customer
          };
        }
        return c;
      });

      creditData.customers = updatedCustomers;
      // P2: Removed totalOutstanding denormalized cache - computed on read

      shopStorage.setItem("creditData", JSON.stringify(creditData));
    }

    // Handle split payment - save remaining balance to credit
    if (paymentType === "split" && selectedCustomerId) {
      const paid = parseFloat(tendered || "0");
      const remaining = actualTotal - paid;

      if (remaining > 0) {
        const storedCredit = shopStorage.getItem("creditData");
        let creditData = storedCredit ? JSON.parse(storedCredit) : { customers: [] };

        // Update customer's outstanding balance with remaining amount
        const updatedCustomers = creditData.customers.map((c: any) => {
          if (c.id === selectedCustomerId) {
            return {
              ...c,
              amount: c.amount + remaining,
              lastDate: new Date().toISOString().split("T")[0],
              lastTransactionId: newTransaction.id // Link transaction to customer
            };
          }
          return c;
        });

        creditData.customers = updatedCustomers;
        // P2: Removed totalOutstanding denormalized cache - computed on read

        shopStorage.setItem("creditData", JSON.stringify(creditData));
      }
    }

    // Clear cart after successful checkout
    clearCart();

    // Play confirmation beep sound
    playConfirmationBeep();

    // Show success toast
    setSuccessAmount(actualTotal);
    setShowSuccessToast(true);
    
    // Auto-dismiss after 0.5s and navigate
    setTimeout(() => {
      setShowSuccessToast(false);
      navigate("/app/sale");
    }, 500);
    } finally {
      setTimeout(() => {
        processingRef.current = false;
        setIsProcessing(false);
      }, 1200);
    }
  };

  const handleAddNewCustomer = () => {
    if (!newCustomerName || !newCustomerPhone) {
      alert(t("সব ফিল্ড পূরণ করুন", "Please fill all fields"));
      return;
    }

    const storedCredit = shopStorage.getItem("creditData");
    let creditData = storedCredit ? JSON.parse(storedCredit) : { customers: [] };

    const newCustomer = {
      id: Date.now(),
      name: newCustomerName,
      phone: newCustomerPhone,
      address: newCustomerAddress,
      amount: 0,
      lastDate: new Date().toISOString().split("T")[0],
      overdue: false
    };

    creditData.customers.push(newCustomer);
    shopStorage.setItem("creditData", JSON.stringify(creditData));

    setCustomers([...customers, newCustomer]);
    setSelectedCustomerId(newCustomer.id);
    handleCloseCustomerModal();
  };

  const handleHold = () => {
    if (cartItems.length === 0) {
      alert(t("কার্ট খালি", "Cart is empty"));
      return;
    }

    // Get current user info for tracking
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const currentStaff = JSON.parse(localStorage.getItem("currentStaff") || "null");
    const authType = localStorage.getItem("authType");

    // Get staff name
    const staffName = authType === "staff" && currentStaff
      ? currentStaff.name
      : currentUser?.name || "Owner";

    // For credit/split sales, get customer info
    let customerName = "";
    let customerPhone = "";
    if ((paymentType === "credit" || paymentType === "split") && selectedCustomerId) {
      const customer = customers.find(c => c.id === selectedCustomerId);
      if (customer) {
        customerName = customer.name;
        customerPhone = customer.phone;
      }
    }

    const heldTransaction = {
      id: Date.now(),
      date: new Date().toISOString().split("T")[0],
      timestamp: new Date().toISOString(),
      staffName: staffName,
      staffId: authType === "staff" ? currentStaff?.id : currentUser?.id,
      subtotal: subtotal,
      discount: parseFloat(discountAmount || "0"),
      total: total,
      paymentMethod: paymentType,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      customerId: selectedCustomerId || undefined, // P2: Add customerId
      tendered: paymentType === "cash" || paymentType === "split" ? parseFloat(tendered || "0") : undefined,
      status: "hold",
      soldBy: getCurrentSoldBy(),
      isDeleted: false,
      // P2: Removed syncStatus (dead field)
      items: cartItems.map(item => ({
        id: item.id,
        name: item.name,
        nameBn: item.nameBn || item.name,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
        unit: item.unit || "pcs",
        manufacturer: item.manufacturer,
        manufacturerBn: item.manufacturerBn
      }))
    };

    // Save held transaction
    const transactionsStr = shopStorage.getItem("transactions");
    let transactions = transactionsStr ? JSON.parse(transactionsStr) : [];
    transactions.push(heldTransaction);
    shopStorage.setItem("transactions", JSON.stringify(transactions));

    // P0: Add audit log for hold
    addLog({
      action: "edit",
      staffId: String(authType === "staff" ? currentStaff?.id : currentUser?.id),
      staffName: staffName,
      reference: `TXN-${heldTransaction.id}`,
      amount: total,
      notes: `Sale put on hold${customerName ? ` - ${customerName}` : ""}`
    });

    // Clear cart
    clearCart();

    // Navigate back to sale page
    navigate("/app/sale");
  };

  const handleCancel = () => {
    if (cartItems.length === 0) {
      alert(t("কার্ট খالি", "Cart is empty"));
      return;
    }

    // Get current user info for tracking
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const currentStaff = JSON.parse(localStorage.getItem("currentStaff") || "null");
    const authType = localStorage.getItem("authType");

    // Get staff name
    const staffName = authType === "staff" && currentStaff
      ? currentStaff.name
      : currentUser?.name || "Owner";

    // For credit/split sales, get customer info
    let customerName = "";
    let customerPhone = "";
    if ((paymentType === "credit" || paymentType === "split") && selectedCustomerId) {
      const customer = customers.find(c => c.id === selectedCustomerId);
      if (customer) {
        customerName = customer.name;
        customerPhone = customer.phone;
      }
    }

    const cancelledTransaction = {
      id: Date.now(),
      date: new Date().toISOString().split("T")[0],
      timestamp: new Date().toISOString(),
      staffName: staffName,
      staffId: authType === "staff" ? currentStaff?.id : currentUser?.id,
      subtotal: subtotal,
      discount: parseFloat(discountAmount || "0"),
      total: total,
      paymentMethod: paymentType,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      customerId: selectedCustomerId || undefined, // P2: Add customerId
      tendered: paymentType === "cash" || paymentType === "split" ? parseFloat(tendered || "0") : undefined,
      status: "cancelled",
      soldBy: getCurrentSoldBy(),
      isDeleted: false,
      // P2: Removed syncStatus (dead field)
      items: cartItems.map(item => ({
        id: item.id,
        name: item.name,
        nameBn: item.nameBn || item.name,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
        unit: item.unit || "pcs",
        manufacturer: item.manufacturer,
        manufacturerBn: item.manufacturerBn
      }))
    };

    // Save cancelled transaction
    const transactionsStr = shopStorage.getItem("transactions");
    let transactions = transactionsStr ? JSON.parse(transactionsStr) : [];
    transactions.push(cancelledTransaction);
    shopStorage.setItem("transactions", JSON.stringify(transactions));

    // P0: Add audit log for cancellation
    addLog({
      action: "delete",
      staffId: String(authType === "staff" ? currentStaff?.id : currentUser?.id),
      staffName: staffName,
      reference: `TXN-${cancelledTransaction.id}`,
      amount: total,
      notes: `Sale cancelled${customerName ? ` - ${customerName}` : ""}`
    });

    // Clear cart
    clearCart();

    // Navigate back to sale page
    navigate("/app/sale");
  };

  const handleOpenCustomerModal = () => {
    setIsCustomerModalOpen(true);
    setCustomerMode("select");
  };

  const handleCloseCustomerModal = () => {
    setIsCustomerModalOpen(false);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerAddress("");
    setCustomerMode("select");
  };

  const handleSelectCustomer = (customerId: number) => {
    setSelectedCustomerId(customerId);
    handleCloseCustomerModal();
  };

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Function to play confirmation beep
  const playConfirmationBeep = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Set beep frequency (higher = higher pitch)
      oscillator.frequency.value = 800; // 800 Hz - pleasant confirmation tone
      oscillator.type = 'sine'; // Smooth sine wave

      // Set volume envelope for smooth sound
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01); // Quick fade in
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15); // Fade out

      // Play beep for 150ms
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.15);
    } catch (error) {
      // Silently fail if audio context is not supported
      console.log('Audio not supported');
    }
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      <StandardHeader title={t("চেকআউট", "Checkout")} />

      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Itemized Summary */}
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <h3
            className="text-sm mb-3"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("বিক্রয় সারাংশ", "Sale Summary")}
          </h3>
          <div className="space-y-3 mb-3">
            {cartItems.map((item) => {
              const itemStock = getItemStock(item.id);
              const isOverStock = item.quantity > itemStock;
              
              return (
                <div key={item.id} className="relative group">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-sm mb-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                        {item.name}
                      </p>
                      <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-money)" }}>
                        ৳{formatNumber(item.price.toFixed(2))} × {formatNumber(item.quantity)} = ৳{formatNumber((item.price * item.quantity).toFixed(2))}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-7 h-7 flex items-center justify-center rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] active:bg-[#D1D5DB] transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5 text-[#6B7280]" />
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleQuantityInput(item.id, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className={`w-12 h-7 text-sm font-semibold text-center border rounded ${
                          isOverStock ? 'border-[#DC2626] bg-[#FEF2F2]' : 'border-[#D1D5DB] bg-white'
                        }`}
                        style={{ 
                          fontFamily: "var(--font-sans)",
                          WebkitAppearance: 'none',
                          MozAppearance: 'textfield'
                        }}
                      />
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-full bg-[#ECFDF5] hover:bg-[#D1FAE5] active:bg-[#A7F3D0] transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 text-[#059669]" />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full bg-[#FEF2F2] hover:bg-[#FEE2E2] active:bg-[#FECACA] transition-all duration-200 hover:scale-110"
                        title={t("মুছে ফেলুন", "Remove")}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-[#DC2626]" />
                      </button>
                    </div>
                  </div>
                  {isOverStock && (
                    <div className="mt-1.5 p-2 bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg flex items-start gap-2">
                      <span className="text-[#DC2626] text-xs">⚠</span>
                      <p className="text-xs text-[#DC2626] flex-1" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("স্টক অপর্যাপ্ত! বর্তমান স্টক:", "Insufficient stock! Available:")} {formatNumber(itemStock)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t pt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span style={{ fontFamily: "var(--font-bangla)" }}>{t("সাবটোটাল", "Subtotal")}</span>
              <span style={{ fontFamily: "var(--font-money)" }}>৳ {formatNumber(subtotal.toFixed(2))}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-[#DC2626]">
                <span style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("ছাড়", "Discount")} ({formatNumber(discountPercent.toFixed(1))}%)
                </span>
                <span style={{ fontFamily: "var(--font-money)" }}>-৳ {formatNumber(discount.toFixed(2))}</span>
              </div>
            )}
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm text-[#D97706]">
                <span style={{ fontFamily: "var(--font-bangla)" }}>
                  {taxSettings.taxLabel} ({taxSettings.taxRate}%)
                </span>
                <span style={{ fontFamily: "var(--font-money)" }}>+৳ {formatNumber(taxAmount.toFixed(2))}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-1 border-t">
              <span style={{ fontFamily: "var(--font-bangla)" }}>{t("মোট", "Total")}</span>
              <span style={{ fontFamily: "var(--font-money)" }}>৳ {formatNumber(total.toFixed(2))}</span>
            </div>
          </div>
        </div>

        {/* Discount Section */}
        {(isOwner || hasPermission("sale_discount")) && (
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <h3
              className="text-sm mb-3"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              ছাড় (Discount)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label
                  htmlFor="discountAmount"
                  className="text-xs text-[#6B7280] mb-1.5 block"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  পরিমাণ (৳)
                </Label>
                <Input
                  id="discountAmount"
                  type="number"
                  value={discountAmount}
                  onChange={(e) => handleDiscountAmountChange(e.target.value)}
                  className="h-11 border-2 border-[#D1D5DB] focus:border-[#059669] bg-[#F9FAFB]"
                  style={{ fontFamily: "var(--font-money)" }}
                  placeholder="0.00"
                  min="0"
                  max={subtotal}
                  step="0.01"
                />
              </div>
              <div>
                <Label
                  htmlFor="discountPercentage"
                  className="text-xs text-[#6B7280] mb-1.5 block"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  শতাংশ (%)
                </Label>
                <Input
                  id="discountPercentage"
                  type="number"
                  value={discountPercentage}
                  onChange={(e) => handleDiscountPercentageChange(e.target.value)}
                  className="h-11 border-2 border-[#D1D5DB] focus:border-[#059669] bg-[#F9FAFB]"
                  style={{ fontFamily: "var(--font-sans)" }}
                  placeholder="0.0"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
            </div>
            {discount > 0 && (
              <div className="mt-3 p-2 bg-[#ECFDF5] rounded-lg">
                <p className="text-xs text-[#059669]" style={{ fontFamily: "var(--font-bangla)" }}>
                  ৳{formatNumber(discount.toFixed(2))} ছাড় প্রয়োগ করা হয়েছে ({formatNumber(discountPercent.toFixed(1))}%)
                </p>
              </div>
            )}
          </div>
        )}

        {/* Payment Type Selector */}
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <h3
            className="text-sm mb-3"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("পেমেন্ট পদ্ধতি", "Payment Method")}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentType("cash")}
              className={`flex-1 py-2 px-4 rounded-full ${
                paymentType === "cash"
                  ? "bg-[#059669] text-white"
                  : "bg-[#ECFDF5] text-[#059669]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("নগদ", "Cash")}
            </button>
            <button
              onClick={() => setPaymentType("credit")}
              className={`flex-1 py-2 px-4 rounded-full ${
                paymentType === "credit"
                  ? "bg-[#059669] text-white"
                  : "bg-[#ECFDF5] text-[#059669]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("বাকি", "Credit")}
            </button>
            <button
              onClick={() => setPaymentType("split")}
              className={`flex-1 py-2 px-4 rounded-full ${
                paymentType === "split"
                  ? "bg-[#059669] text-white"
                  : "bg-[#ECFDF5] text-[#059669]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("আংশিক", "Partial")}
            </button>
          </div>
        </div>

        {/* Cash Payment - Paid Amount Input */}
        {paymentType === "cash" && (
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <h3
              className="text-sm mb-3"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("নগদ প্রাপ্ত", "Paid Amount")}
            </h3>
            
            {/* Paid Amount Input */}
            <div className="mb-4">
              <div className="relative">
                <span
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-[#059669]"
                  style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                >
                  ৳
                </span>
                <Input
                  type="number"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  className="h-14 pl-12 text-2xl border-2 border-[#D1D5DB] focus:border-[#059669] bg-[#F9FAFB] rounded-xl"
                  style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                  placeholder="0"
                  min="0"
                  step="1"
                />
              </div>
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[10, 20, 50, 100, 200, 500, 1000, 2000].map((amount) => (
                <button
                  key={amount}
                  onClick={() => setTendered(amount.toString())}
                  className="h-10 bg-[#ECFDF5] hover:bg-[#D1FAE5] active:bg-[#A7F3D0] text-[#059669] rounded-lg transition-colors"
                  style={{ fontFamily: "var(--font-money)", fontWeight: 600, fontSize: "0.813rem" }}
                >
                  ৳{amount}
                </button>
              ))}
            </div>

            {/* Return Amount Display */}
            {tendered && parseFloat(tendered) >= total && (
              <div className="bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] p-4 rounded-xl border-2 border-[#059669]">
                <p
                  className="text-xs text-[#047857] mb-1"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {t("ফেরত", "Return Amount")}
                </p>
                <p
                  className="text-4xl text-[#059669] mb-2"
                  style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                >
                  ৳{formatNumber(change.toFixed(2))}
                </p>
                {change > 0 && (
                  <p
                    className="text-xs text-[#047857] opacity-80"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {t("গ্রাহককে ফেরত দি", "Return to customer")}
                  </p>
                )}
              </div>
            )}

            {/* Warning if insufficient payment */}
            {tendered && parseFloat(tendered) < total && (
              <div className="bg-[#FEF2F2] p-3 rounded-lg border-2 border-[#FCA5A5]">
                <p
                  className="text-xs text-[#DC2626]"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {t("অপর্যাপ্ত পরিমাণ। আরও ৳", "Insufficient amount. Need ৳")}
                  {formatNumber((total - parseFloat(tendered)).toFixed(2))} {t("টাকা বেশি", "more")}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Partial/Split Payment */}
        {paymentType === "split" && (
          <div className="bg-white p-4 rounded-lg shadow-sm space-y-4">
            {/* Customer Selection for Split Payment */}
            <div>
              <Label
                className="text-sm mb-2 block"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
              >
                {t("গ্রাহক নির্বাচন করুন", "Select Customer")}
              </Label>
              {selectedCustomer ? (
                <div className="bg-[#ECFDF5] p-3 rounded-lg border-2 border-[#059669] mb-3">
                  <p
                    className="text-sm text-[#111827] mb-1"
                    style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                  >
                    {selectedCustomer.name}
                  </p>
                  <p className="text-xs text-[#6B7280]">{selectedCustomer.phone}</p>
                  <button
                    onClick={() => setSelectedCustomerId(null)}
                    className="text-xs text-[#DC2626] hover:underline mt-2"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {t("পরিবর্তন করুন", "Change")}
                  </button>
                </div>
              ) : (
                <Button
                  onClick={handleOpenCustomerModal}
                  variant="outline"
                  className="w-full h-12 justify-start text-left border-[#059669] text-[#059669]"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  + {t("গ্রাহক নির্বাচন/যোগ করুন", "Select/Add Customer")}
                </Button>
              )}
            </div>

            {/* Payment Amount */}
            <div>
              <Label
                htmlFor="tendered"
                className="text-sm block mb-1.5"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
              >
                দেওয়া হয়েছে (Amount Paid)
              </Label>
              <Input
                id="tendered"
                type="number"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                className="h-12 mt-1 border-2 border-[#059669] focus:border-[#047857] bg-white shadow-sm"
                style={{ fontFamily: "var(--font-money)", fontSize: "0.9rem" }}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>

            {/* Show remaining balance and change */}
            {tendered && (
              <div className="space-y-2">
                {parseFloat(tendered) < total ? (
                  <div className="bg-[#FEF3C7] p-3 rounded-lg border-2 border-[#F59E0B]">
                    <p
                      className="text-xs text-[#92400E] mb-1"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      বাকি (Remaining Balance)
                    </p>
                    <p
                      className="text-2xl text-[#D97706]"
                      style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                    >
                      ৳ {formatNumber((total - parseFloat(tendered)).toFixed(2))}
                    </p>
                    <p className="text-xs text-[#92400E] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("এই পরিমাণ বকেয়া হিসেবে যোগ হবে", "This amount will be added to credit")}
                    </p>
                  </div>
                ) : (
                  <div className="bg-[#ECFDF5] p-3 rounded-lg border-2 border-[#059669]">
                    <p
                      className="text-xs text-[#047857] mb-1"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      ফেরত (Change)
                    </p>
                    <p
                      className="text-2xl text-[#059669]"
                      style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                    >
                      ৳ {formatNumber(change.toFixed(2))}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Credit Payment */}
        {paymentType === "credit" && (
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <Label
              className="text-sm mb-2 block"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("গ্রাহক নির্বাচন করুন", "Select Customer")}
            </Label>
            {selectedCustomer ? (
              <div className="bg-[#ECFDF5] p-3 rounded-lg border-2 border-[#059669] mb-3">
                <p
                  className="text-sm text-[#111827] mb-1"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                >
                  {selectedCustomer.name}
                </p>
                <p className="text-xs text-[#6B7280]">{selectedCustomer.phone}</p>
                <button
                  onClick={() => setSelectedCustomerId(null)}
                  className="text-xs text-[#DC2626] hover:underline mt-2"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("পরিবর্তন করুন", "Change")}
                </button>
              </div>
            ) : (
              <Button
                onClick={handleOpenCustomerModal}
                variant="outline"
                className="w-full h-12 justify-start text-left border-[#059669] text-[#059669]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                + {t("গ্রাহক নির্বাচন/যোগ করুন", "Select/Add Customer")}
              </Button>
            )}
          </div>
        )}

        {/* P0-5: Prescription Section */}
        {rxNumber || prescriberName || rxImage ? (
          <div className="bg-white p-4 rounded-lg shadow-sm border-2 border-[#059669]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#ECFDF5] rounded-full flex items-center justify-center">
                  <Camera className="w-5 h-5 text-[#059669]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("প্রেসক্রিপশন যোগ করা হয়েছে", "Prescription Added")}
                  </p>
                  {prescriberName && (
                    <p className="text-xs text-gray-600" style={{ fontFamily: "var(--font-bangla)" }}>
                      {prescriberName}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowPrescriptionModal(true)}
                className="text-sm text-[#059669] font-semibold hover:underline"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("সম্পাদনা", "Edit")}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowPrescriptionModal(true)}
            className="w-full p-2.5 rounded-lg border border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4 text-gray-600" />
            <span className="text-sm text-gray-700" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("প্রেসক্রিপশন যোগ করুন", "Add Prescription")}
            </span>
          </button>
        )}
      </div>

      {/* Customer Selection Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3
                className="text-lg text-[#111827]"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
              >
                {customerMode === "select"
                  ? t("গ্রাহক নির্বাচন", "Select Customer")
                  : t("নতুন গ্রাহক", "New Customer")}
              </h3>
              <button
                onClick={handleCloseCustomerModal}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#6B7280]" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {customerMode === "select" ? (
                <div className="space-y-3">
                  {customers.length > 0 ? (
                    <>
                      {customers.map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => handleSelectCustomer(customer.id)}
                          className="w-full text-left p-3 bg-[#F9FAFB] hover:bg-[#ECFDF5] rounded-lg transition-colors border border-gray-200"
                        >
                          <p
                            className="text-sm text-[#111827] mb-1"
                            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                          >
                            {customer.name}
                          </p>
                          <p className="text-xs text-[#6B7280]">{customer.phone}</p>
                          {customer.amount > 0 && (
                            <p
                              className="text-xs text-[#DC2626] mt-1"
                              style={{ fontFamily: "var(--font-bangla)" }}
                            >
                              {t("বেয়া:", "Due:")} ৳{formatNumber(customer.amount.toLocaleString())}
                            </p>
                          )}
                        </button>
                      ))}
                      <Button
                        onClick={() => setCustomerMode("new")}
                        variant="outline"
                        className="w-full h-11 border-[#059669] text-[#059669]"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        + {t("নতুন গ্রাহক যোগ করুন", "Add New Customer")}
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p
                        className="text-sm text-[#6B7280] mb-4"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("কোনো গ্রাহক নেই", "No customers yet")}
                      </p>
                      <Button
                        onClick={() => setCustomerMode("new")}
                        className="bg-[#059669] hover:bg-[#047857] text-white"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        + {t("প্রথম গ্রাহক যোগ করুন", "Add First Customer")}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label
                      htmlFor="newCustomerName"
                      className="text-sm text-[#101E1A]"
                      style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                    >
                      {t("নাম", "Name")}
                    </Label>
                    <Input
                      id="newCustomerName"
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder={t("নাম লিখুন", "Enter name")}
                      className="h-11 border-2 border-[#D1D5DB] focus:border-[#059669]"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="customerPhone"
                      className="text-sm mb-1.5 block"
                      style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                    >
                      {t("ফোন নম্বর", "Phone Number")}
                    </Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      placeholder="+880 1XXXXXXXXX"
                      className="h-11 border-2 border-[#D1D5DB] focus:border-[#059669]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="customerAddress"
                      className="text-sm mb-1.5 block"
                      style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                    >
                      {t("ঠিকানা", "Address")}
                    </Label>
                    <Input
                      id="customerAddress"
                      type="text"
                      value={newCustomerAddress}
                      onChange={(e) => setNewCustomerAddress(e.target.value)}
                      placeholder={t("ঠিকানা লিখুন", "Enter address")}
                      className="h-11 border-2 border-[#D1D5DB] focus:border-[#059669]"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    />
                  </div>
                  <Button
                    onClick={() => setCustomerMode("select")}
                    variant="outline"
                    className="w-full h-11"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {t("← ফিরে যান", "← Back")}
                  </Button>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {customerMode === "new" && (
              <div className="p-4 border-t border-gray-200">
                <Button
                  onClick={handleAddNewCustomer}
                  className="w-full h-11 bg-[#059669] hover:bg-[#047857] text-white"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("গ্রাহক যোগ করুন", "Add Customer")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Prescription Modal */}
      {showPrescriptionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <span className="text-xl">⚕️</span>
                </div>
                <h3
                  className="text-lg font-bold text-amber-900"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("প্রেসক্রিপশন তথ্য", "Prescription Information")}
                </h3>
              </div>
              <button
                onClick={() => setShowPrescriptionModal(false)}
                className="p-1.5 rounded-full hover:bg-white/60 text-amber-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <Label
                  htmlFor="prescriberNameModal"
                  className="text-sm text-gray-700 mb-1.5 block font-semibold"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("রোগীর নাম", "Patient Name")} <span className="text-gray-500 font-normal">({t("ঐচ্ছিক", "Optional")})</span>
                </Label>
                <Input
                  id="prescriberNameModal"
                  type="text"
                  value={prescriberName}
                  onChange={(e) => setPrescriberName(e.target.value)}
                  className="h-11 border-2 border-gray-300 focus:border-[#059669] bg-white"
                  style={{ fontFamily: "var(--font-bangla)" }}
                  placeholder={t("রোগীর নাম লিখুন", "Enter patient name")}
                />
              </div>

              <div>
                <Label
                  className="text-sm text-gray-700 mb-1.5 block font-semibold"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("প্রেসক্রিপশন ছবি", "Prescription Photo")} <span className="text-gray-500 font-normal">({t("ঐচ্ছিক", "Optional")})</span>
                </Label>
                {rxImage ? (
                  <div className="relative">
                    <img
                      src={rxImage}
                      alt="Prescription"
                      className="w-full h-48 object-cover rounded-lg border-2 border-gray-300"
                    />
                    <button
                      onClick={() => {
                        setRxImage(null);
                        setRxImageFile(null);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      id="rxImageModal"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setRxImageFile(file);
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setRxImage(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                    />
                    <label
                      htmlFor="rxImageModal"
                      className="flex items-center justify-center gap-2 w-full h-24 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                    >
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-sm text-gray-700 font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("ছবি তুলুন বা আপলোড করুন", "Take Photo or Upload")}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 space-y-2">
              <Button
                onClick={() => {
                  setShowPrescriptionModal(false);
                }}
                className="w-full h-11 bg-[#059669] hover:bg-[#047857] text-white font-bold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("সংরক্ষণ করুন", "Save")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="bg-gradient-to-t from-white via-white to-[#F9FAFB] border-t border-gray-200 px-4 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] space-y-3">
        {/* Confirm Button */}
        <Button
          onClick={handleConfirm}
          disabled={hasStockIssue || isProcessing}
          className={`w-full h-14 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
            hasStockIssue || isProcessing
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-[#059669] to-[#047857] hover:from-[#047857] hover:to-[#065f46] text-white hover:shadow-xl'
          }`}
          style={{ fontFamily: "var(--font-bangla)", fontWeight: 700, fontSize: "1rem" }}
        >
          {!hasStockIssue && !isProcessing && (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {hasStockIssue
            ? t("স্টক অপর্যাপ্ত", "Insufficient Stock")
            : isProcessing
            ? t("প্রক্রিয়া হচ্ছে...", "Processing...")
            : t("বিল কনফার্মেশন", "Confirm Sale")
          }
        </Button>

        {/* Hold and Cancel Buttons - Modern Design */}
        <div className="grid grid-cols-2 gap-3">
          {/* Hold Button */}
          <Button
            onClick={handleHold}
            variant="outline"
            className="h-13 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-400 text-amber-700 hover:text-amber-700 hover:border-amber-500 hover:bg-gradient-to-br hover:from-amber-100 hover:to-orange-100 rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
            {t("হোল্ড", "Hold")}
          </Button>
          
          {/* Cancel Button */}
          <Button
            onClick={handleCancel}
            variant="outline"
            className="h-13 bg-gradient-to-br from-red-50 to-rose-50 border-2 border-red-400 text-red-700 hover:text-red-700 hover:border-red-500 hover:bg-gradient-to-br hover:from-red-100 hover:to-rose-100 rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {t("বাতিল", "Cancel")}
          </Button>
        </div>
      </div>

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none">
          <div className="bg-gradient-to-r from-[#059669] to-[#047857] text-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center gap-3 animate-fade-in">
            <CheckCircle className="w-12 h-12" strokeWidth={2.5} />
            <div className="text-center">
              <p className="text-lg font-bold mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("বিক্রয় সফল হয়েছে", "Sale Confirmed")}
              </p>
              <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-money)" }}>
                ৳{formatNumber(successAmount.toFixed(2))}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}