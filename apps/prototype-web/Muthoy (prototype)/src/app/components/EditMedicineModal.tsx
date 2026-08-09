import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";

interface EditMedicineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateMedicine: (medicine: any) => void;
  medicine: any;
}

export function EditMedicineModal({ isOpen, onClose, onUpdateMedicine, medicine }: EditMedicineModalProps) {
  const { t, formatNumber } = useLanguage();
  
  // Form fields
  const [quantity, setQuantity] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [requiresRx, setRequiresRx] = useState(false);

  useEffect(() => {
    if (!medicine) return;
    // Source values may live either on the medicine record (legacy/flat format)
    // or on a nested batch (new batched format). Prefer the explicit batch
    // identified by __editingBatchNo (set by Inventory), then fall back to the
    // first batch, then to flat fields.
    const batches: any[] = Array.isArray(medicine.batches) ? medicine.batches : [];
    const targetBatch =
      batches.find((b: any) => b.batchNo === medicine.__editingBatchNo) ||
      batches[0] ||
      null;

    const pick = (batchField: string, medField: string = batchField) => {
      if (targetBatch && targetBatch[batchField] !== undefined && targetBatch[batchField] !== null) {
        return targetBatch[batchField];
      }
      return medicine[medField];
    };

    const stockVal = pick("stock");
    const batchNoVal = pick("batchNo");
    const expiryDateVal = pick("expiryDate");
    const purchaseVal = pick("purchasePrice");
    const saleVal = pick("salePrice");

    setQuantity(stockVal !== undefined && stockVal !== null ? String(stockVal) : "0");
    setBatchNo(batchNoVal || "");
    setExpiryDate(expiryDateVal || "");
    setPurchasePrice(purchaseVal !== undefined && purchaseVal !== null ? String(purchaseVal) : "0");
    setSalePrice(saleVal !== undefined && saleVal !== null ? String(saleVal) : "0");
    setRequiresRx(medicine.requiresRx || false);
  }, [medicine]);

  const handleSubmit = () => {
    // Calculate days until expiry
    let daysUntilExpiry = null;
    if (expiryDate) {
      const expiry = new Date(expiryDate);
      const today = new Date();
      const diffTime = expiry.getTime() - today.getTime();
      const calculatedDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      // If expiry date is in the past or today, set to 0
      daysUntilExpiry = calculatedDays < 0 ? 0 : calculatedDays;
    }

    const newStock = parseInt(quantity) || 0;
    const newPurchase = parseFloat(purchasePrice) || 0;
    const newSale = parseFloat(salePrice) || 0;

    // If the medicine uses the batched format, update the matching nested batch
    // instead of (only) the flat fields, so the change actually persists.
    const existingBatches: any[] = Array.isArray(medicine.batches) ? medicine.batches : [];
    let updatedBatches = existingBatches;
    if (existingBatches.length > 0) {
      const targetBatchNo = medicine.__editingBatchNo ?? existingBatches[0]?.batchNo;
      updatedBatches = existingBatches.map((b: any) =>
        b.batchNo === targetBatchNo
          ? {
              ...b,
              stock: newStock,
              batchNo: batchNo,
              expiryDate: expiryDate,
              expiryDays: daysUntilExpiry,
              purchasePrice: newPurchase,
              salePrice: newSale,
            }
          : b
      );
    }

    const updatedMedicine: any = {
      ...medicine,
      stock: newStock,
      batchNo: batchNo,
      expiry: daysUntilExpiry,
      expiryDate: expiryDate,
      purchasePrice: newPurchase,
      salePrice: newSale,
      requiresRx: requiresRx,
      batches: updatedBatches,
    };
    delete updatedMedicine.__editingBatchNo;
    
    onUpdateMedicine(updatedMedicine);
    onClose();
  };

  if (!isOpen || !medicine) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 
            className="text-lg font-bold text-[#059669]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("ঔষধ সম্পাদনা করুন", "Edit Medicine")}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Medicine Info */}
        <div className="p-4 bg-[#ECFDF5] border-b border-gray-200">
          <p 
            className="font-bold text-[#059669] text-lg"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {medicine.name}
          </p>
          <p 
            className="text-sm text-gray-600 mt-0.5"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {medicine.generic}
          </p>
          {medicine.manufacturer && (
            <p 
              className="text-xs text-gray-500 mt-1"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {medicine.manufacturer}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div>
              <label 
                className="block text-sm font-semibold text-gray-700 mb-2"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("স্টক পরিমাণ", "Stock Quantity")} *
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
                style={{ fontFamily: "var(--font-sans)" }}
                placeholder="0"
              />
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
                placeholder="0"
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
                placeholder="0"
              />
            </div>

            

            {/* Threshold Info (Read-only) */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
              <label
                className="block text-sm font-semibold text-gray-700 mb-2"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("থ্রেশহোল্ড লিমিট", "Threshold Limit")}
              </label>
              <p
                className="text-2xl font-bold text-gray-900"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {formatNumber(medicine.threshold)}
              </p>
              <p
                className="text-xs text-gray-500 mt-1"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("কম স্টক", "Low Stock")}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleSubmit}
            disabled={!quantity || !batchNo || !expiryDate || !purchasePrice || !salePrice}
            className="w-full py-3 bg-[#059669] hover:bg-[#047857] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("সংরক্ষণ করুন", "Save Changes")}
          </button>
        </div>
      </div>
    </div>
  );
}