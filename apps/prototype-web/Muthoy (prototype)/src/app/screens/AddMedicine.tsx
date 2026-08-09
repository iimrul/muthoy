import { useState, useEffect } from "react";

import { Camera } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { type Supplier } from "../utils/suppliers";
import { getMedicines, saveMedicines } from "../utils/medicineData";
import { createPlaceholderInvoice, type PaymentTerms } from "../utils/supplierInvoices";
import { SupplierPicker } from "../components/SupplierPicker";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

export function AddMedicine() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [isScanning, setIsScanning] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  const [formData, setFormData] = useState({
    medicineName: "",
    genericName: "",
    manufacturer: "",
    batchNumber: "",
    expiryDate: "",
    purchasePrice: "",
    salePrice: "",
    stockQuantity: "",
    minStockLevel: "",
  });
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>("cod");

  // Check for scanned data on mount
  useEffect(() => {
    const scannedData = shopStorage.getItem("scannedMedicineData");
    if (scannedData) {
      const parsedData = JSON.parse(scannedData);
      setFormData((prev) => ({
        ...prev,
        medicineName: parsedData.name || "",
        genericName: parsedData.generic || "",
        manufacturer: parsedData.manufacturer || "",
      }));
      // Clear the scanned data after using it
      shopStorage.removeItem("scannedMedicineData");
    }
  }, []);

  const handleChange = (field: string, value: string) => {
    const updatedFormData = { ...formData, [field]: value };
    setFormData(updatedFormData);

    // Clear validation errors when all required fields are filled
    if (showValidation) {
      const allRequiredFilled = updatedFormData.medicineName &&
        updatedFormData.genericName &&
        updatedFormData.manufacturer &&
        updatedFormData.batchNumber &&
        updatedFormData.expiryDate &&
        updatedFormData.purchasePrice &&
        updatedFormData.salePrice &&
        updatedFormData.stockQuantity;

      if (allRequiredFilled) {
        setShowValidation(false);
      }
    }
  };

  const isFieldInvalid = (fieldValue: string) => {
    return showValidation && !fieldValue;
  };

  const handleQuickScan = () => {
    setIsScanning(true);

    // Simulate camera opening and OCR processing
    setTimeout(() => {
      // Mock OCR extraction - simulating scanned medicine data
      const mockScannedData = {
        medicineName: "Sergel 20mg",
        genericName: "Omeprazole",
        manufacturer: "Square Pharmaceuticals Ltd.",
      };

      // Auto-fill the form fields
      setFormData((prev) => ({
        ...prev,
        medicineName: mockScannedData.medicineName,
        genericName: mockScannedData.genericName,
        manufacturer: mockScannedData.manufacturer,
      }));

      setIsScanning(false);
    }, 2500); // Simulate 2.5 second scan time
  };

  const handleSubmit = () => {
    // Show validation errors
    setShowValidation(true);

    // Validation
    if (!formData.medicineName || !formData.genericName || !formData.manufacturer ||
        !formData.batchNumber || !formData.expiryDate || !formData.purchasePrice ||
        !formData.salePrice || !formData.stockQuantity) {
      alert(t("সব প্রয়োজনীয় ঘর পূরণ করুন", "Please fill all required fields"));
      return;
    }

    // Validate that sale price is greater than purchase price
    if (parseFloat(formData.salePrice) <= parseFloat(formData.purchasePrice)) {
      alert(t("বিক্রয় মূল্য ক্রয় মূল্যের চেয়ে বেশি হতে হবে", "Sale price must be greater than purchase price"));
      return;
    }

    // Calculate days until expiry
    let daysUntilExpiry = null;
    if (formData.expiryDate) {
      const expiry = new Date(formData.expiryDate);
      const today = new Date();
      const diffTime = expiry.getTime() - today.getTime();
      const calculatedDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      daysUntilExpiry = calculatedDays < 0 ? 0 : calculatedDays;
    }

    if (!supplier) {
      alert(t("সরবরাহকারী নির্বাচন করুন", "Select a supplier"));
      return;
    }

    // P1: synthesize a placeholder invoice so the new batch carries invoiceId + supplierId.
    const qty = parseInt(formData.stockQuantity) || 0;
    const purchasePrice = parseFloat(formData.purchasePrice) || 0;
    const newMedicineId = Date.now();
    const placeholder = createPlaceholderInvoice({
      supplierId: supplier.id,
      supplierName: supplier.name,
      paymentTerms,
      line: {
        rawName: formData.medicineName,
        matchedMedicineId: newMedicineId,
        matchedName: formData.medicineName,
        quantity: qty,
        batchNo: formData.batchNumber,
        expiryDate: formData.expiryDate,
        purchasePrice,
      },
    });

    // Create new medicine with a fully traceable batch.
    const newMedicine = {
      id: newMedicineId,
      name: formData.medicineName,
      generic: formData.genericName,
      manufacturer: formData.manufacturer,
      batchNo: formData.batchNumber,
      expiryDate: formData.expiryDate,
      expiry: daysUntilExpiry,
      purchasePrice,
      salePrice: parseFloat(formData.salePrice),
      stock: qty,
      threshold: parseInt(formData.minStockLevel) || 10,
      type: "tablet",
      batches: [
        {
          batchNo: formData.batchNumber,
          expiryDate: formData.expiryDate,
          stock: qty,
          purchasePrice,
          salePrice: parseFloat(formData.salePrice),
          invoiceId: placeholder.id,
          supplierId: supplier.id,
          receivedAt: new Date().toISOString(),
        },
      ],
    };

    // Store via the shared helper so the cache is invalidated and other screens see it
    const existingMedicines = getMedicines();
    existingMedicines.push(newMedicine as any);
    saveMedicines(existingMedicines);

    // Navigate back to inventory
    navigate("/app/inventory");
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader title={t("ওষুধ যোগ করুন", "Add Medicine")} />

      {/* Form */}
      <div className="px-4 py-6 space-y-4">
        {/* Quick Add - Scan Option */}
        <div className={`border p-4 rounded-lg transition-colors ${
          isScanning
            ? "bg-[#059669] border-[#059669]"
            : "bg-[#EFF6FF] border-[#2563EB]"
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p
                className={`text-sm mb-1 ${isScanning ? "text-white" : "text-[#2563EB]"}`}
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
              >
                {isScanning ? t("স্ক্যান করা হচ্ছে...", "Scanning...") : t("দ্রুত যোগ করুন", "Quick Add")}
              </p>
              <p
                className={`text-xs ${isScanning ? "text-white/90" : "text-[#2563EB]"}`}
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {isScanning
                  ? t("ঔষধের প্যাকেজ স্ক্যান করুন...", "Scanning medicine package...")
                  : t("প্যাকেট স্ক্যান করে তথ্য পূরণ করুন", "Scan packet to auto-fill details")
                }
              </p>
            </div>
            <button
              onClick={handleQuickScan}
              disabled={isScanning}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                isScanning
                  ? "bg-white/20"
                  : "bg-[#2563EB] active:scale-95"
              }`}
            >
              {isScanning ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="w-6 h-6 text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Medicine Name */}
        <div>
          <label
            className={`block text-sm mb-2 ${isFieldInvalid(formData.medicineName) ? "text-red-600" : "text-[#111827]"}`}
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("ওষুধের নাম", "Medicine Name")} *
          </label>
          <Input
            type="text"
            value={formData.medicineName}
            onChange={(e) => handleChange("medicineName", e.target.value)}
            placeholder={t("যেমন: Napa 500mg", "e.g., Napa 500mg")}
            className={`h-12 bg-white ${isFieldInvalid(formData.medicineName) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
            style={{ fontFamily: "var(--font-bangla)" }}
          />
        </div>

        {/* Generic Name */}
        <div>
          <label
            className={`block text-sm mb-2 ${isFieldInvalid(formData.genericName) ? "text-red-600" : "text-[#111827]"}`}
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("জেনেরিক নাম", "Generic Name")} *
          </label>
          <Input
            type="text"
            value={formData.genericName}
            onChange={(e) => handleChange("genericName", e.target.value)}
            placeholder={t("যেমন: Paracetamol", "e.g., Paracetamol")}
            className={`h-12 bg-white ${isFieldInvalid(formData.genericName) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
            style={{ fontFamily: "var(--font-bangla)" }}
          />
        </div>

        {/* Manufacturer */}
        <div>
          <label
            className={`block text-sm mb-2 ${isFieldInvalid(formData.manufacturer) ? "text-red-600" : "text-[#111827]"}`}
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("প্রস্তুতকারক", "Manufacturer")} *
          </label>
          <Input
            type="text"
            value={formData.manufacturer}
            onChange={(e) => handleChange("manufacturer", e.target.value)}
            placeholder={t("যেমন: Square Pharma", "e.g., Square Pharma")}
            className={`h-12 bg-white ${isFieldInvalid(formData.manufacturer) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
            style={{ fontFamily: "var(--font-bangla)" }}
          />
        </div>

        {/* Batch Number and Expiry Date in a Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className={`block text-sm mb-2 ${isFieldInvalid(formData.batchNumber) ? "text-red-600" : "text-[#111827]"}`}
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("ব্যাচ নম্বর", "Batch Number")} *
            </label>
            <Input
              type="text"
              value={formData.batchNumber}
              onChange={(e) => handleChange("batchNumber", e.target.value)}
              placeholder="B2401"
              className={`h-12 bg-white ${isFieldInvalid(formData.batchNumber) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </div>
          <div>
            <label
              className={`block text-sm mb-2 ${isFieldInvalid(formData.expiryDate) ? "text-red-600" : "text-[#111827]"}`}
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("মেয়াদ শেষ", "Expiry Date")} *
            </label>
            <Input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => handleChange("expiryDate", e.target.value)}
              className={`h-12 bg-white ${isFieldInvalid(formData.expiryDate) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </div>
        </div>

        {/* Purchase Price and Sale Price in a Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className={`block text-sm mb-2 ${isFieldInvalid(formData.purchasePrice) ? "text-red-600" : "text-[#111827]"}`}
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("ক্রয় মূল্য (৳)", "Purchase Price (৳)")} *
            </label>
            <Input
              type="number"
              value={formData.purchasePrice}
              onChange={(e) => handleChange("purchasePrice", e.target.value)}
              placeholder="0.00"
              className={`h-12 bg-white ${isFieldInvalid(formData.purchasePrice) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
              style={{ fontFamily: "var(--font-money)" }}
              step="0.01"
              min="0"
            />
          </div>
          <div>
            <label
              className={`block text-sm mb-2 ${isFieldInvalid(formData.salePrice) ? "text-red-600" : "text-[#111827]"}`}
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("বিক্রয় মূল্য (৳)", "Sale Price (৳)")} *
            </label>
            <Input
              type="number"
              value={formData.salePrice}
              onChange={(e) => handleChange("salePrice", e.target.value)}
              placeholder="0.00"
              className={`h-12 bg-white ${isFieldInvalid(formData.salePrice) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
              style={{ fontFamily: "var(--font-money)" }}
              step="0.01"
              min="0"
            />
          </div>
        </div>

        {/* Stock Quantity and Minimum Stock Level in a Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className={`block text-sm mb-2 ${isFieldInvalid(formData.stockQuantity) ? "text-red-600" : "text-[#111827]"}`}
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("স্টক পরিমাণ", "Stock Quantity")} *
            </label>
            <Input
              type="number"
              value={formData.stockQuantity}
              onChange={(e) => handleChange("stockQuantity", e.target.value)}
              placeholder="0"
              className={`h-12 bg-white ${isFieldInvalid(formData.stockQuantity) ? "border-red-600 border-2 focus:ring-red-600" : ""}`}
              style={{ fontFamily: "var(--font-sans)" }}
              min="0"
            />
          </div>
          <div>
            <label
              className="block text-sm text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("সর্বনিম্ন স্টক", "Minimum Stock")}
            </label>
            <Input
              type="number"
              value={formData.minStockLevel}
              onChange={(e) => handleChange("minStockLevel", e.target.value)}
              placeholder="10"
              className="h-12 bg-white"
              style={{ fontFamily: "var(--font-sans)" }}
              min="0"
            />
          </div>
        </div>

        {/* Supplier (required) */}
        <SupplierPicker value={supplier} onChange={setSupplier} required label={t("সরবরাহকারী", "Supplier")} />

        {/* Payment terms — defaults to COD since most direct add-stock purchases are paid at delivery. */}
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
                  onClick={() => setPaymentTerms(opt)}
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

        {/* Required Fields Note */}
        <p
          className={`text-xs text-center ${showValidation ? "text-red-600 font-semibold" : "text-[#6B7280]"}`}
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          * {t("চিহ্নিত ঘর অবশ্যই পূরণ করতে হবে", "Marked fields are required")}
        </p>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="flex-1 h-12 border-[#059669] text-[#059669]"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("বাতিল করুন", "Cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            className="flex-1 h-12 bg-[#059669] hover:bg-[#047857] text-white"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("সংরক্ষণ করুন", "Save")}
          </Button>
        </div>
      </div>

      {/* Camera Overlay - Shows when scanning */}
      {isScanning && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center">
          {/* Camera Viewfinder Frame */}
          <div className="relative w-64 h-64 mb-8">
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Top-left corner */}
              <path
                d="M10 10 L10 25 M10 10 L25 10"
                stroke="#059669"
                strokeWidth="3"
                strokeLinecap="round"
              />
              {/* Top-right corner */}
              <path
                d="M90 10 L90 25 M90 10 L75 10"
                stroke="#059669"
                strokeWidth="3"
                strokeLinecap="round"
              />
              {/* Bottom-left corner */}
              <path
                d="M10 90 L10 75 M10 90 L25 90"
                stroke="#059669"
                strokeWidth="3"
                strokeLinecap="round"
              />
              {/* Bottom-right corner */}
              <path
                d="M90 90 L90 75 M90 90 L75 90"
                stroke="#059669"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>

            {/* Scanning Line Animation */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
              <div className="w-full h-1 bg-[#059669] animate-pulse" />
            </div>

            {/* Camera Icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Camera className="w-16 h-16 text-[#059669] opacity-20" />
            </div>
          </div>

          {/* Scanning Text */}
          <div className="text-center px-4">
            <p
              className="text-white text-lg mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("ক্যামেরা খোলা হয়েছে", "Camera Opened")}
            </p>
            <p
              className="text-white/80 text-sm"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ঔষধের প্যাকেজে ক্যামেরা ধরুন", "Hold camera on medicine package")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
