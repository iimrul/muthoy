import { useState } from "react";

import { X, Search, Plus, Camera, Scan } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { type Supplier } from "../utils/suppliers";
import { createPlaceholderInvoice, type PaymentTerms } from "../utils/supplierInvoices";
import { SupplierPicker } from "./SupplierPicker";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

// Mock database of 21k medicines (simplified sample)
const MEDICINES_DATABASE = [
  { id: 1001, name: "Napa 500mg", generic: "Paracetamol", manufacturer: "Beximco" },
  { id: 1002, name: "Napa Extend 665mg", generic: "Paracetamol", manufacturer: "Beximco" },
  { id: 1003, name: "Ace 5mg", generic: "Amlodipine", manufacturer: "Square" },
  { id: 1004, name: "Ace 10mg", generic: "Amlodipine", manufacturer: "Square" },
  { id: 1005, name: "Filmet 400mg", generic: "Metronidazole", manufacturer: "Opsonin" },
  { id: 1006, name: "Sergel 20mg", generic: "Omeprazole", manufacturer: "Square" },
  { id: 1007, name: "Max-D 400", generic: "Vitamin D3", manufacturer: "Renata" },
  { id: 1008, name: "Omidon 20mg", generic: "Omeprazole", manufacturer: "Healthcare" },
  { id: 1009, name: "Seclo 20mg", generic: "Omeprazole", manufacturer: "Incepta" },
  { id: 1010, name: "Ranitidine 150mg", generic: "Ranitidine", manufacturer: "Square" },
  { id: 1011, name: "Ciprocin 500mg", generic: "Ciprofloxacin", manufacturer: "Square" },
  { id: 1012, name: "Azithromycin 500mg", generic: "Azithromycin", manufacturer: "Beximco" },
  { id: 1013, name: "Amoxi 500mg", generic: "Amoxicillin", manufacturer: "Square" },
  { id: 1014, name: "Montair 10mg", generic: "Montelukast", manufacturer: "Renata" },
  { id: 1015, name: "Flexi 15mg", generic: "Meloxicam", manufacturer: "Square" },
  // ... represents 21k medicines database
];

interface AddMedicineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddMedicine: (medicine: any) => void;
}

export function AddMedicineModal({ isOpen, onClose, onAddMedicine }: AddMedicineModalProps) {
  const { t, formatNumber, language } = useLanguage();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMedicine, setSelectedMedicine] = useState<any>(null);
  const [isScanningSearch, setIsScanningSearch] = useState(false);

  // Form fields
  const [quantity, setQuantity] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [threshold, setThreshold] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms | null>(null);
  const [requiresRx, setRequiresRx] = useState(false);

  const filteredMedicines = MEDICINES_DATABASE.filter(med =>
    med.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    med.generic.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectMedicine = (med: any) => {
    setSelectedMedicine(med);
    setSearchQuery("");
  };

  const handleSearchScan = () => {
    setIsScanningSearch(true);

    // Simulate camera opening and OCR processing
    setTimeout(() => {
      // Mock OCR extraction - simulating scanned medicine data
      const mockScannedData = {
        name: "Sergel 20mg",
        generic: "Omeprazole",
        manufacturer: "Square Pharmaceuticals Ltd.",
      };

      // Search for the medicine in database
      const foundMedicine = MEDICINES_DATABASE.find(
        med => med.name.toLowerCase() === mockScannedData.name.toLowerCase()
      );

      if (foundMedicine) {
        // Medicine found - auto-select it
        setSelectedMedicine(foundMedicine);
        setSearchQuery("");
      } else {
        // Medicine not found - redirect to add-medicine page with pre-filled data
        shopStorage.setItem("scannedMedicineData", JSON.stringify(mockScannedData));
        onClose();
        navigate("/app/add-medicine");
      }

      setIsScanningSearch(false);
    }, 2000); // Simulate 2 second scan time
  };

  const handleSubmit = () => {
    // Validate that sale price is greater than purchase price
    if (parseFloat(salePrice) <= parseFloat(purchasePrice)) {
      alert(t("বিক্রয় মূল্য ক্রয় মূল্যের চেয়ে বেশি হতে হবে", "Sale price must be greater than purchase price"));
      return;
    }

    const qty = parseInt(quantity) || 0;
    const purchasePriceNum = parseFloat(purchasePrice) || 0;
    const salePriceNum = parseFloat(salePrice) || 0;
    const newMedicineId = Date.now();

    // Only create a placeholder invoice if a supplier was selected
    const placeholder = supplier
      ? createPlaceholderInvoice({
          supplierId: supplier.id,
          supplierName: supplier.name,
          paymentTerms: paymentTerms ?? "cod",
          line: {
            rawName: selectedMedicine.name,
            matchedMedicineId: newMedicineId,
            matchedName: selectedMedicine.name,
            quantity: qty,
            batchNo,
            expiryDate,
            purchasePrice: purchasePriceNum,
          },
        })
      : null;

    const newMedicine = {
      id: newMedicineId,
      name: selectedMedicine.name,
      generic: selectedMedicine.generic,
      manufacturer: selectedMedicine.manufacturer,
      threshold: parseInt(threshold) || 20,
      type: "tablet",
      requiresRx: requiresRx,
      batches: [
        {
          batchNo,
          expiryDate,
          stock: qty,
          purchasePrice: purchasePriceNum,
          salePrice: salePriceNum,
          ...(placeholder ? { invoiceId: placeholder.id, supplierId: supplier!.id } : {}),
          receivedAt: new Date().toISOString(),
        }
      ]
    };
    
    console.log('Medicine to be added (batch format):', newMedicine);
    
    onAddMedicine(newMedicine);
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setSelectedMedicine(null);
    setSearchQuery("");
    setQuantity("");
    setBatchNo("");
    setExpiryDate("");
    setThreshold("");
    setPurchasePrice("");
    setSalePrice("");
    setSupplier(null);
    setPaymentTerms(null);
    setRequiresRx(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 
            className="text-lg font-bold text-[#059669]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("ঔষধ যোগ করুন", "Add Medicine")}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-2">
            <button
              className="flex-1 py-2 px-4 rounded-xl font-semibold text-sm transition-colors bg-[#059669] text-white"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("মেডিসিন খুঁজুন", "Search Medicine")}
            </button>
            <button
              onClick={() => {
                onClose();
                navigate("/app/add-medicine");
              }}
              className="flex-1 py-2 px-4 rounded-xl font-semibold text-sm transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200 active:scale-95"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ম্যানুয়াল এন্ট্রি", "Manual Entry")}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <>
            {/* Search Section */}
            {!selectedMedicine && (
                <div className="mb-4 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t("ঔষধের নাম বা জেনেরিক লিখুন", "Search medicine name or generic")}
                      className="w-full pl-10 pr-14 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                      style={{ fontFamily: "var(--font-bangla)" }}
                      disabled={isScanningSearch}
                    />
                    <button
                      onClick={handleSearchScan}
                      disabled={isScanningSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg bg-[#059669] hover:bg-[#047857] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                    >
                      {isScanningSearch ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Scan className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Scanning Overlay for Search */}
                  {isScanningSearch && (
                    <div className="p-4 bg-[#059669] rounded-xl">
                      <div className="flex items-center gap-3 text-white">
                        <Camera className="w-6 h-6 animate-pulse" />
                        <div>
                          <p
                            className="font-semibold"
                            style={{ fontFamily: "var(--font-bangla)" }}
                          >
                            {t("ক্যামেরা খোলা হয়েছে", "Camera Opened")}
                          </p>
                          <p
                            className="text-xs opacity-90"
                            style={{ fontFamily: "var(--font-bangla)" }}
                          >
                            {t("ঔষধের প্যাকেজ স্ক্যান করুন...", "Scanning medicine package...")}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Search Results */}
              {searchQuery && !selectedMedicine && (
                <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                  {filteredMedicines.slice(0, 20).map((med) => (
                    <button
                      key={med.id}
                      onClick={() => handleSelectMedicine(med)}
                      className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-left transition-colors"
                    >
                      <p
                        className="font-semibold text-sm text-gray-900"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {med.name}
                      </p>
                      <p
                        className="text-xs text-gray-600 mt-0.5"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {med.generic} • {med.manufacturer}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected Medicine */}
              {selectedMedicine && (
                <div className="mb-4 p-4 bg-[#ECFDF5] rounded-xl border border-[#059669]">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p
                        className="font-bold text-[#059669]"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {selectedMedicine.name}
                      </p>
                      <p
                        className="text-sm text-gray-600"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {selectedMedicine.generic}
                      </p>
                      <p
                        className="text-xs text-gray-500 mt-1"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {selectedMedicine.manufacturer}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedMedicine(null)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Common Fields for Search Mode */}
              {selectedMedicine && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="block text-sm font-semibold text-gray-700 mb-2"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("পরিমাণ", "Quantity")} *
                      </label>
                      <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                        style={{ fontFamily: "var(--font-sans)" }}
                        placeholder="0"
                        min="0"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-sm font-semibold text-gray-700 mb-2"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("থ্রেশহোল্ড", "Threshold")}
                      </label>
                      <input
                        type="number"
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                        style={{ fontFamily: "var(--font-sans)" }}
                        placeholder="20"
                        min="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      className="block text-sm font-semibold text-gray-700 mb-2"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("ব্যাচ নম্বর", "Batch Number")} *
                    </label>
                    <input
                      type="text"
                      value={batchNo}
                      onChange={(e) => setBatchNo(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                      style={{ fontFamily: "var(--font-sans)" }}
                      placeholder="A12345"
                    />
                  </div>

                  <div>
                    <label
                      className="block text-sm font-semibold text-gray-700 mb-2"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("মেয়াদ উত্তীর্ণের তারিখ", "Expiry Date")} *
                    </label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                      style={{ fontFamily: "var(--font-sans)" }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="block text-sm font-semibold text-gray-700 mb-2"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("ক্রয় মূল্য", "Purchase Price")} *
                      </label>
                      <input
                        type="number"
                        value={purchasePrice}
                        onChange={(e) => setPurchasePrice(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                        style={{ fontFamily: "var(--font-money)" }}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-sm font-semibold text-gray-700 mb-2"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("বিক্রয় মূল্য", "Sale Price")} *
                      </label>
                      <input
                        type="number"
                        value={salePrice}
                        onChange={(e) => setSalePrice(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                        style={{ fontFamily: "var(--font-money)" }}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <SupplierPicker
                    value={supplier}
                    onChange={setSupplier}
                    label={t("সরবরাহকারী", "Supplier")}
                  />

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("পরিশোধের ধরন", "Payment method")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["cod", "credit"] as PaymentTerms[]).map((opt) => {
                        const active = paymentTerms === opt;
                        const label = opt === "cod"
                          ? t("নগদ পরিশোধ", "Cash on Delivery")
                          : t("বাকিতে নেওয়া", "On Credit");
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setPaymentTerms(active ? null : opt)}
                            className={`h-11 rounded-xl border-2 transition-colors text-sm ${
                              active
                                ? "border-[#059669] bg-[#ECFDF5] text-[#047857] font-bold"
                                : "border-[#E5E7EB] bg-white text-[#6B7280]"
                            }`}
                            style={{ fontFamily: "var(--font-bangla)" }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  
                </div>
              )}
          </>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleSubmit}
            disabled={!selectedMedicine || !quantity || !batchNo || !expiryDate || !purchasePrice || !salePrice}
            className="w-full py-3 bg-[#059669] hover:bg-[#047857] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("যোগ করুন", "Add to Inventory")}
          </button>
        </div>
      </div>
    </div>
  );
}