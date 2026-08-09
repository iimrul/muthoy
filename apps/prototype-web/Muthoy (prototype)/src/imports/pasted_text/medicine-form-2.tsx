<div className="px-4 py-6 space-y-4">
        {/* Medicine Name */}
        <div>
          <label
            className="block text-sm text-[#111827] mb-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("ওষুধের নাম", "Medicine Name")} *
          </label>
          <Input
            type="text"
            value={formData.medicineName}
            onChange={(e) => handleChange("medicineName", e.target.value)}
            placeholder={t("যেমন: Napa 500mg", "e.g., Napa 500mg")}
            className="h-12 bg-white"
            style={{ fontFamily: "var(--font-bangla)" }}
          />
        </div>

        {/* Generic Name */}
        <div>
          <label
            className="block text-sm text-[#111827] mb-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("জেনেরিক নাম", "Generic Name")} *
          </label>
          <Input
            type="text"
            value={formData.genericName}
            onChange={(e) => handleChange("genericName", e.target.value)}
            placeholder={t("যেমন: Paracetamol", "e.g., Paracetamol")}
            className="h-12 bg-white"
            style={{ fontFamily: "var(--font-bangla)" }}
          />
        </div>

        {/* Manufacturer */}
        <div>
          <label
            className="block text-sm text-[#111827] mb-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("প্রস্তুতকারক", "Manufacturer")} *
          </label>
          <Input
            type="text"
            value={formData.manufacturer}
            onChange={(e) => handleChange("manufacturer", e.target.value)}
            placeholder={t("যেমন: Square Pharma", "e.g., Square Pharma")}
            className="h-12 bg-white"
            style={{ fontFamily: "var(--font-bangla)" }}
          />
        </div>

        {/* Batch Number and Expiry Date in a Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className="block text-sm text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("ব্যাচ নম্বর", "Batch Number")} *
            </label>
            <Input
              type="text"
              value={formData.batchNumber}
              onChange={(e) => handleChange("batchNumber", e.target.value)}
              placeholder="B2401"
              className="h-12 bg-white"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
          <div>
            <label
              className="block text-sm text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("মেয়াদ শেষ", "Expiry Date")} *
            </label>
            <Input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => handleChange("expiryDate", e.target.value)}
              className="h-12 bg-white"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
        </div>

        {/* Purchase Price and Sale Price in a Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className="block text-sm text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("ক্রয় মূল্য (৳)", "Purchase Price (৳)")} *
            </label>
            <Input
              type="number"
              value={formData.purchasePrice}
              onChange={(e) => handleChange("purchasePrice", e.target.value)}
              placeholder="0.00"
              className="h-12 bg-white"
              style={{ fontFamily: "var(--font-mono)" }}
              step="0.01"
            />
          </div>
          <div>
            <label
              className="block text-sm text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("বিক্রয় মূল্য (৳)", "Sale Price (৳)")} *
            </label>
            <Input
              type="number"
              value={formData.salePrice}
              onChange={(e) => handleChange("salePrice", e.target.value)}
              placeholder="0.00"
              className="h-12 bg-white"
              style={{ fontFamily: "var(--font-mono)" }}
              step="0.01"
            />
          </div>
        </div>

        {/* Stock Quantity and Minimum Stock Level in a Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className="block text-sm text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("স্টক পরিমাণ", "Stock Quantity")} *
            </label>
            <Input
              type="number"
              value={formData.stockQuantity}
              onChange={(e) => handleChange("stockQuantity", e.target.value)}
              placeholder="0"
              className="h-12 bg-white"
              style={{ fontFamily: "var(--font-mono)" }}
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
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
        </div>

        {/* Scan Option */}
        <div className="bg-[#EFF6FF] border border-[#2563EB] p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p
                className="text-sm text-[#2563EB] mb-1"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
              >
                {t("দ্রুত যোগ করুন", "Quick Add")}
              </p>
              <p
                className="text-xs text-[#2563EB]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("প্যাকেট স্ক্যান করে তথ্য পূরণ করুন", "Scan packet to auto-fill details")}
              </p>
            </div>
            <button
              onClick={() => navigate("/app/scan")}
              className="w-12 h-12 bg-[#2563EB] rounded-full flex items-center justify-center"
            >
              <Camera className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>

        {/* Required Fields Note */}
        <p
          className="text-xs text-[#6B7280] text-center"
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