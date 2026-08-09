import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";

interface Batch {
  id: number;
  batchNo: string;
  expiryDate: string;
  stock: number;
  purchasePrice: number;
  salePrice: number;
  isDiscounted?: boolean;
  discountPercentage?: number;
}

interface EditBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateBatch: (updatedBatch: Batch) => void;
  batch: Batch | null;
  medicineName: string;
}

export function EditBatchModal({ isOpen, onClose, onUpdateBatch, batch, medicineName }: EditBatchModalProps) {
  const { t, formatNumber } = useLanguage();
  const [formData, setFormData] = useState({
    batchNo: "",
    expiryDate: "",
    stock: "",
    purchasePrice: "",
    salePrice: "",
  });

  useEffect(() => {
    if (batch) {
      setFormData({
        batchNo: batch.batchNo || "",
        expiryDate: batch.expiryDate || "",
        stock: batch.stock?.toString() || "0",
        purchasePrice: batch.purchasePrice?.toString() || "0",
        salePrice: batch.salePrice?.toString() || "0",
      });
    }
  }, [batch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch) return;

    const updatedBatch: Batch = {
      ...batch,
      batchNo: formData.batchNo,
      expiryDate: formData.expiryDate,
      stock: parseInt(formData.stock) || 0,
      purchasePrice: parseFloat(formData.purchasePrice) || 0,
      salePrice: parseFloat(formData.salePrice) || 0,
    };

    onUpdateBatch(updatedBatch);
    onClose();
  };

  if (!isOpen || !batch) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#e2e2e5] px-6 py-4 flex justify-between items-center rounded-t-2xl">
          <h2 
            className="text-lg font-bold text-[#1a1c1e]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("ব্যাচ এডিট করুন", "Edit Batch")}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#f3f3f6] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[#3e4949]" />
          </button>
        </div>

        {/* Medicine Name */}
        <div className="px-6 pt-4 pb-2">
          <p className="text-sm text-[#3e4949]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("ওষুধ", "Medicine")}: <span className="font-bold text-[#1a1c1e]">{medicineName}</span>
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Batch Number */}
          <div>
            <label className="block text-sm font-medium text-[#3e4949] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("ব্যাচ নম্বর", "Batch Number")}
            </label>
            <input
              type="text"
              value={formData.batchNo}
              onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
              className="w-full px-4 py-3 bg-[#f3f3f6] rounded-xl border-2 border-transparent focus:border-[#059669] focus:bg-white outline-none transition-all"
              style={{ fontFamily: "var(--font-sans)" }}
              required
            />
          </div>

          {/* Expiry Date */}
          <div>
            <label className="block text-sm font-medium text-[#3e4949] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("মেয়াদ উত্তীর্ণের তারিখ", "Expiry Date")}
            </label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
              className="w-full px-4 py-3 bg-[#f3f3f6] rounded-xl border-2 border-transparent focus:border-[#059669] focus:bg-white outline-none transition-all"
              style={{ fontFamily: "var(--font-sans)" }}
              required
            />
          </div>

          {/* Stock */}
          <div>
            <label className="block text-sm font-medium text-[#3e4949] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("স্টক পরিমাণ", "Stock Quantity")}
            </label>
            <input
              type="number"
              min="0"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="w-full px-4 py-3 bg-[#f3f3f6] rounded-xl border-2 border-transparent focus:border-[#059669] focus:bg-white outline-none transition-all"
              style={{ fontFamily: "var(--font-sans)" }}
              required
            />
          </div>

          {/* Purchase Price */}
          <div>
            <label className="block text-sm font-medium text-[#3e4949] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("ক্রয় মূল্য", "Purchase Price")}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#3e4949] font-mono">৳</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.purchasePrice}
                onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                className="w-full pl-8 pr-4 py-3 bg-[#f3f3f6] rounded-xl border-2 border-transparent focus:border-[#059669] focus:bg-white outline-none transition-all"
                style={{ fontFamily: "var(--font-money)" }}
                required
              />
            </div>
          </div>

          {/* Sale Price */}
          <div>
            <label className="block text-sm font-medium text-[#3e4949] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("বিক্রয় মূল্য", "Sale Price")}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#3e4949] font-mono">৳</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.salePrice}
                onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                className="w-full pl-8 pr-4 py-3 bg-[#f3f3f6] rounded-xl border-2 border-transparent focus:border-[#059669] focus:bg-white outline-none transition-all"
                style={{ fontFamily: "var(--font-money)" }}
                required
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-[#e8e8ea] text-[#3e4949] rounded-xl font-bold hover:bg-[#e2e2e5] transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("বাতিল", "Cancel")}
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-gradient-to-r from-[#059669] to-[#10b981] text-white rounded-xl font-bold hover:shadow-lg transition-all"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("সংরক্ষণ করুন", "Save Changes")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
