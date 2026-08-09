
import { Trash2, Minus, Plus, ShoppingBag } from "lucide-react";
import { Button } from "../components/ui/button";
import { useCart } from "../contexts/CartContext";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { useEffect } from "react";
import { useNavigate } from "../utils/navigation";

export function Cart() {
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  const { cartItems, updateQuantity, setQuantity, removeFromCart, getCartTotal, updateCartPrices } = useCart();

  // Update prices when cart loads or items change
  useEffect(() => {
    if (cartItems.length > 0) {
      updateCartPrices();
    }
  }, [cartItems.length, updateCartPrices]);

  const total = getCartTotal();

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      <StandardHeader title={t("কার্ট", "Cart")} />
      <div className="px-4 pt-2 pb-1">
        <p
          className="text-sm text-[#059669]/70"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {t(
            `${cartItems.length} টি আইটেম`,
            `${cartItems.length} item${cartItems.length !== 1 ? "s" : ""}`
          )}
        </p>
      </div>

      {/* Cart Items */}
      {cartItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-24 h-24 bg-[#ECFDF5] rounded-full flex items-center justify-center mb-4">
            <ShoppingBag className="w-12 h-12 text-[#059669]" />
          </div>
          <h3
            className="text-lg text-[#111827] mb-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
          >
            {t("আপনার কার্ট খালি", "Your cart is empty")}
          </h3>
          <p
            className="text-sm text-[#6B7280] text-center mb-6"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t(
              "বিক্রয় শুরু করতে ওষুধ যোগ করুন",
              "Add medicines to start a sale"
            )}
          </p>
          <Button
            onClick={() => navigate("/app/sale")}
            className="bg-[#059669] hover:bg-[#047857] text-white h-12 px-8"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("বিক্রয় শুরু করুন", "Start Sale")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
            {cartItems.map((item) => (
              <div
                key={item.id}
                className="bg-white p-4 rounded-lg shadow-sm border border-gray-100"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-1">
                    <h4 className="font-bold text-sm text-[#111827] mb-1">
                      {item.name}
                    </h4>
                    <p className="text-xs text-[#6B7280] mb-1">
                      {item.generic} · {item.manufacturer}
                    </p>
                    <p
                      className="text-sm text-[#059669]"
                      style={{ fontFamily: "var(--font-money)", fontWeight: 600 }}
                    >
                      ৳ {formatNumber(item.price.toFixed(2))} {t("প্রতি পিস", "each")}
                    </p>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5 text-[#DC2626]" />
                  </button>
                </div>

                {/* Quantity Controls & Subtotal */}
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  {/* Quick Quantity Buttons */}
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setQuantity(item.id, 1)}
                      className={`flex-1 h-8 rounded-lg text-xs font-bold transition-all ${
                        item.quantity === 1
                          ? "bg-[#059669] text-white"
                          : "bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5]"
                      }`}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {formatNumber(1)}
                    </button>
                    <button
                      onClick={() => setQuantity(item.id, Math.min(5, item.stock || 0))}
                      disabled={(item.stock || 0) < 5}
                      className={`flex-1 h-8 rounded-lg text-xs font-bold transition-all ${
                        item.quantity === 5
                          ? "bg-[#059669] text-white"
                          : "bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5]"
                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {formatNumber(5)}
                    </button>
                    <button
                      onClick={() => setQuantity(item.id, Math.min(10, item.stock || 0))}
                      disabled={(item.stock || 0) < 10}
                      className={`flex-1 h-8 rounded-lg text-xs font-bold transition-all ${
                        item.quantity === 10
                          ? "bg-[#059669] text-white"
                          : "bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5]"
                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {formatNumber(10)}
                    </button>
                    <button
                      onClick={() => setQuantity(item.id, Math.min(20, item.stock || 0))}
                      disabled={(item.stock || 0) < 20}
                      className={`flex-1 h-8 rounded-lg text-xs font-bold transition-all ${
                        item.quantity === 20
                          ? "bg-[#059669] text-white"
                          : "bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5]"
                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {formatNumber(20)}
                    </button>
                  </div>

                  {/* Fine Control Stepper & Subtotal */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-9 h-9 rounded-lg bg-[#ECFDF5] flex items-center justify-center text-[#059669] hover:bg-[#D1FAE5] active:scale-95 transition-all"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        max={item.stock || 0}
                        value={item.quantity || 1}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Allow empty input temporarily
                          if (value === "" || value === "0") {
                            return; // Don't update, keep current quantity
                          }
                          const numValue = parseInt(value);
                          if (!isNaN(numValue) && numValue > 0) {
                            const clampedValue = Math.min(numValue, item.stock || 0);
                            setQuantity(item.id, clampedValue);
                          }
                        }}
                        onBlur={(e) => {
                          // On blur, ensure we have a valid value
                          const value = e.target.value;
                          if (value === "" || parseInt(value) <= 0 || isNaN(parseInt(value))) {
                            setQuantity(item.id, 1);
                          }
                        }}
                        onFocus={(e) => e.target.select()}
                        className="w-14 h-9 text-center font-bold text-[#111827] border-2 border-[#059669] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#047857]"
                        style={{ fontFamily: "var(--font-sans)" }}
                      />
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        disabled={item.quantity >= item.stock}
                        className="w-9 h-9 rounded-lg bg-[#ECFDF5] flex items-center justify-center text-[#059669] hover:bg-[#D1FAE5] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Item Subtotal */}
                    <div className="text-right">
                      <p
                        className="text-xs text-[#6B7280] mb-0.5"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("সাবটোটাল", "Subtotal")}
                      </p>
                      <p
                        className="text-xl font-bold text-[#059669]"
                        style={{ fontFamily: "var(--font-money)" }}
                      >
                        ৳{formatNumber(((Number(item.price) || 0) * (Number(item.quantity) || 0)).toFixed(2))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom Section */}
          <div className="bg-gradient-to-t from-white via-white to-[#F9FAFB] border-t border-gray-200 px-4 py-4 space-y-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
            {/* Total */}
            <div className="flex items-center justify-between py-2 px-4 bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-2xl border-2 border-[#059669]/20">
              <span
                className="text-lg"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
              >
                {t("মোট", "Total")}
              </span>
              <span
                className="text-3xl font-bold"
                style={{ fontFamily: "var(--font-money)", color: "#059669" }}
              >
                ৳{formatNumber(total.toFixed(2))}
              </span>
            </div>

            {/* Checkout Button */}
            <Button
              onClick={() => navigate("/app/checkout")}
              className="w-full h-14 bg-gradient-to-r from-[#059669] via-[#047857] to-[#059669] hover:from-[#047857] hover:to-[#065F46] text-white rounded-full shadow-lg hover:shadow-xl transition-all active:scale-95"
              disabled={cartItems.length === 0}
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 700, fontSize: "1rem" }}
            >
              {t("চেকআউট করুন", "Proceed to Checkout")} →
            </Button>

            {/* Continue Shopping */}
            <button
              onClick={() => navigate("/app/sale")}
              className="w-full h-10 text-[#059669] hover:text-[#047857] font-bold transition-colors"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("+ আরও পণ্য যোগ করুন", "+ Add More Items")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}