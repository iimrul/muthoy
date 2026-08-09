import { useState, useEffect } from "react";

import { X, CheckCircle, AlertCircle, ShoppingCart, Loader2 } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { useCart } from "../contexts/CartContext";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

interface ScannedItem {
  id: number;
  name: string;
  generic: string;
  price: number;
  quantity: number;
  stock: number;
}

export function OCRScan() {
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  const { addToCart } = useCart();
  const [isScanning, setIsScanning] = useState(true);
  const [scannedCart, setScannedCart] = useState<ScannedItem[]>([]);
  const [status, setStatus] = useState<"scanning" | "found" | "notFound" | "noStock">("scanning");
  const [lastScanned, setLastScanned] = useState<any>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // Play beep sound on successful scan
  const playBeep = () => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.15);
  };

  // Show toast notification
  const displayToast = (message: string, type: "success" | "error" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  // Load medicines from inventory — only user-entered data, no seed fallbacks.
  const getMedicinesFromInventory = () => {
    const storedMedicines = shopStorage.getItem("medicines");
    const parsed: any[] = storedMedicines ? JSON.parse(storedMedicines) : [];
    return parsed.filter((m: any) => {
      const total = Array.isArray(m.batches) && m.batches.length > 0
        ? m.batches.reduce((s: number, b: any) => s + (Number(b.stock) || 0), 0)
        : Number(m.stock) || 0;
      return total > 0;
    });
  };

  // Auto-scan cycle - continuous scanning
  useEffect(() => {
    if (!isScanning) return;

    const timer = setTimeout(() => {
      const availableMedicines = getMedicinesFromInventory();
      
      // Simulate 80% success rate
      const scanSuccess = Math.random() > 0.2;

      if (scanSuccess && availableMedicines.length > 0) {
        // Pick a random medicine from available inventory
        const randomMedicine = availableMedicines[Math.floor(Math.random() * availableMedicines.length)];
        
        setLastScanned(randomMedicine);
        setStatus("found");
        
        // Check if medicine already in scanned cart
        const existingItem = scannedCart.find(item => item.id === randomMedicine.id);
        
        if (existingItem) {
          // Increment quantity
          setScannedCart(scannedCart.map(item => 
            item.id === randomMedicine.id 
              ? { ...item, quantity: item.quantity + 1 }
              : item
          ));
          displayToast(`${randomMedicine.name} +1`, "success");
        } else {
          // Add new item to scanned cart
          setScannedCart([...scannedCart, {
            id: randomMedicine.id,
            name: randomMedicine.name,
            generic: randomMedicine.generic,
            price: randomMedicine.salePrice,
            quantity: 1,
            stock: randomMedicine.stock,
          }]);
          displayToast(t("যুক্ত হয়েছে", "Added") + `: ${randomMedicine.name}`, "success");
        }
        
        // Play beep and vibrate
        playBeep();
        if ('vibrate' in navigator) {
          navigator.vibrate(100);
        }
        
        // Reset to scanning state after brief highlight
        setTimeout(() => {
          setStatus("scanning");
        }, 400);
      } else {
        // Medicine not found - but continue scanning
        setStatus("notFound");
        displayToast(t("পাওয়া যায়নি", "Not Found"), "error");
        
        // Continue scanning without stopping
        setTimeout(() => {
          setStatus("scanning");
        }, 1000);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [isScanning, scannedCart, t]);

  const handleDone = () => {
    setIsScanning(false);
    
    // Add all scanned items to cart context
    scannedCart.forEach(item => {
      for (let i = 0; i < item.quantity; i++) {
        addToCart({
          id: item.id,
          name: item.name,
          generic: item.generic,
          price: item.price,
          salePrice: item.price,
          stock: item.stock,
          type: "tablet",
          unit: "pcs"
        });
      }
    });
    
    // Navigate to checkout
    navigate("/app/checkout");
  };

  const handleClose = () => {
    navigate("/app/sale");
  };

  const handleManualSearch = () => {
    setIsScanning(false);
    
    // Add scanned items to cart before navigating
    scannedCart.forEach(item => {
      for (let i = 0; i < item.quantity; i++) {
        addToCart({
          id: item.id,
          name: item.name,
          generic: item.generic,
          price: item.price,
          salePrice: item.price,
          stock: item.stock,
          type: "tablet",
          unit: "pcs"
        });
      }
    });
    
    navigate("/app/sale");
  };

  const totalItems = scannedCart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Toast Notification */}
      {showToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-top-2 duration-200">
          <div 
            className={`px-6 py-3 rounded-full shadow-lg backdrop-blur-sm ${
              toastType === 'success' 
                ? 'bg-[#059669]/90 text-white' 
                : 'bg-[#DC2626]/90 text-white'
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <p className="text-sm font-semibold">{toastMessage}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10">
        <StandardHeader
          title={t("স্ক্যান", "Scan")}
          right={
            <button
              onClick={() => navigate("/app/sale")}
              className="w-9 h-9 hover:bg-white/70 rounded-full flex items-center justify-center transition-all active:scale-90"
            >
              <X className="w-5 h-5 text-[#065F46]" />
            </button>
          }
        />
      </div>

      {/* Camera Viewfinder */}
      <div className="flex-1 relative">
        {/* Corner Brackets Overlay - Absolutely centered and fixed */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72">
          <svg
            className="absolute inset-0 w-full h-full drop-shadow-2xl"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Top-left corner */}
            <path
              d="M10 10 L10 28 M10 10 L28 10"
              stroke={status === "found" ? "#059669" : status === "noStock" || status === "notFound" ? "#DC2626" : "#059669"}
              strokeWidth="4"
              strokeLinecap="round"
            />
            {/* Top-right corner */}
            <path
              d="M90 10 L90 28 M90 10 L72 10"
              stroke={status === "found" ? "#059669" : status === "noStock" || status === "notFound" ? "#DC2626" : "#059669"}
              strokeWidth="4"
              strokeLinecap="round"
            />
            {/* Bottom-left corner */}
            <path
              d="M10 90 L10 72 M10 90 L28 90"
              stroke={status === "found" ? "#059669" : status === "noStock" || status === "notFound" ? "#DC2626" : "#059669"}
              strokeWidth="4"
              strokeLinecap="round"
            />
            {/* Bottom-right corner */}
            <path
              d="M90 90 L90 72 M90 90 L72 90"
              stroke={status === "found" ? "#059669" : status === "noStock" || status === "notFound" ? "#DC2626" : "#059669"}
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>

          {isScanning && (
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
              <div
                className="w-full h-1.5 bg-gradient-to-r from-transparent via-[#059669] to-transparent shadow-lg shadow-[#059669]/50"
                style={{
                  animation: 'scan 2s ease-in-out infinite'
                }}
              />
            </div>
          )}
        </div>

        {/* Minimal scanning indicator below grid - also absolutely positioned */}
        {status === "scanning" && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[160px] flex gap-2">
            <div className="w-2 h-2 bg-[#059669] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-[#059669] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-[#059669] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes scan {
          0%, 100% { transform: translateY(-100%); }
          50% { transform: translateY(100%); }
        }
      `}</style>

      {/* Bottom Actions */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/60 to-transparent px-6 pb-8 pt-12">
        {/* Cart Counter & Done Button */}
        {scannedCart.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2 px-5 py-3.5 bg-white/20 backdrop-blur-md rounded-2xl text-white border border-white/30 shadow-lg">
              <ShoppingCart className="w-5 h-5" />
              <span className="font-bold text-base" style={{ fontFamily: "var(--font-sans)" }}>
                {formatNumber(totalItems)}
              </span>
              <span className="text-sm opacity-90" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("টি", "items")}
              </span>
            </div>
            
            <button
              onClick={handleDone}
              className="flex-1 h-14 bg-gradient-to-r from-[#059669] to-[#047857] text-white font-bold rounded-2xl hover:from-[#047857] hover:to-[#065f46] transition-all active:scale-95 shadow-xl border-2 border-white/20 backdrop-blur-sm flex items-center justify-center gap-2"
              style={{ fontFamily: "var(--font-bangla)", fontSize: "1rem" }}
            >
              <CheckCircle className="w-5 h-5" />
              {t("সম্পন্ন করুন", "Done")}
            </button>
          </div>
        )}
        
        {/* Scanning status and manual option */}
        <div className="text-center space-y-3">
          {scannedCart.length === 0 && (
            <p className="text-white text-base font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("পরবর্তী ওষুধ স্ক্যান করুন", "Scan next medicine")}
            </p>
          )}
          
          {/* Manual entry option */}
          <button
            onClick={handleManualSearch}
            className="inline-block text-white/80 text-sm hover:text-white transition-colors underline underline-offset-4 decoration-white/50"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("ম্যানুয়াল সার্চ করুন", "Search manually instead")}
          </button>
          
          <p className="text-white/50 text-xs" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("OCR স্ক্যানিং ডেমো • প্রোটোটাইপের জন্য", "OCR scanning demo • Prototype")}
          </p>
        </div>
      </div>
    </div>
  );
}