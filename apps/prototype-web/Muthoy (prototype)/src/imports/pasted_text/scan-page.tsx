import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useLanguage } from '../contexts/LanguageContext';
import { X, CheckCircle, Loader, ShoppingCart } from 'lucide-react';
import { mockMedicines } from '../utils/mockData';

type ScanState = 'scanning' | 'detected';

interface CartItem {
  id: string;
  name: string;
  generic?: string;
  price: number;
  quantity: number;
  stock: number;
}

interface ToastData {
  message: string;
  type: 'success' | 'error';
}

export default function Scan() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [isScanning, setIsScanning] = useState(true);

  // Play beep sound
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
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 1500);
  };

  // Auto-scan cycle
  useEffect(() => {
    if (!isScanning) return;

    const timer = setTimeout(() => {
      // Pick a random medicine from inventory
      const randomMedicine = mockMedicines[Math.floor(Math.random() * mockMedicines.length)];
      
      setScanState('detected');
      
      // Check if medicine already in cart
      const existingItem = cart.find(item => item.id === randomMedicine.id);
      
      if (existingItem) {
        // Increment quantity
        setCart(cart.map(item => 
          item.id === randomMedicine.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ));
        showToast(`${randomMedicine.name} qty +1`);
      } else {
        // Add new item to cart
        setCart([...cart, {
          id: randomMedicine.id,
          name: randomMedicine.name,
          generic: randomMedicine.generic,
          price: randomMedicine.price,
          quantity: 1,
          stock: randomMedicine.stock,
        }]);
        showToast(`${randomMedicine.name} added`);
      }
      
      // Play beep + vibrate
      playBeep();
      if ('vibrate' in navigator) {
        navigator.vibrate(100);
      }
      
      // Reset to scanning state after brief highlight
      setTimeout(() => {
        setScanState('scanning');
      }, 400);
    }, 2500);

    return () => clearTimeout(timer);
  }, [isScanning, cart]);

  const handleDone = () => {
    setIsScanning(false);
    // Navigate to checkout with cart items
    navigate('/checkout', { state: { scannedCart: cart } });
  };

  const handleClose = () => {
    navigate(-1);
  };

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Minimal Header - Only Close Button */}
      <div className="absolute top-0 right-0 p-4 z-10">
        <button 
          onClick={handleClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors"
        >
          <X className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className={`px-6 py-3 rounded-full shadow-lg backdrop-blur-sm ${
            toast.type === 'success' 
              ? 'bg-[#10B981]/90 text-white' 
              : 'bg-red-500/90 text-white'
          }`}>
            <p className="text-sm font-medium">{toast.message}</p>
          </div>
        </div>
      )}

      {/* Full-screen Camera Preview Area */}
      <div className="flex-1 relative flex items-center justify-center">
        <div className="w-full h-full flex items-center justify-center px-6">
          {/* Scanner Frame with rounded corners */}
          <div 
            className={`relative w-80 h-80 max-w-[85vw] max-h-[50vh] rounded-3xl transition-all duration-300 ${
              scanState === 'detected' 
                ? 'border-4 border-[#10B981] shadow-[0_0_30px_rgba(16,185,129,0.5)]' 
                : 'border-4 border-white/30'
            }`}
          >
            {/* Corner indicators */}
            <div className={`absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 rounded-tl-3xl transition-colors ${
              scanState === 'detected' ? 'border-[#10B981]' : 'border-white/50'
            }`}></div>
            <div className={`absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 rounded-tr-3xl transition-colors ${
              scanState === 'detected' ? 'border-[#10B981]' : 'border-white/50'
            }`}></div>
            <div className={`absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 rounded-bl-3xl transition-colors ${
              scanState === 'detected' ? 'border-[#10B981]' : 'border-white/50'
            }`}></div>
            <div className={`absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 rounded-br-3xl transition-colors ${
              scanState === 'detected' ? 'border-[#10B981]' : 'border-white/50'
            }`}></div>
            
            {/* Scanning animation */}
            {scanState === 'scanning' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader className="w-12 h-12 text-white/70 animate-spin" />
              </div>
            )}
            
            {/* Detected checkmark animation */}
            {scanState === 'detected' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 bg-[#10B981] rounded-full flex items-center justify-center shadow-lg animate-in zoom-in duration-200">
                  <CheckCircle className="w-12 h-12 text-white" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="px-6 pb-6 space-y-3">
        {/* Cart Counter & Done Button */}
        {cart.length > 0 && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 px-4 py-3 bg-white/10 backdrop-blur-sm rounded-xl text-white">
              <ShoppingCart className="w-5 h-5" />
              <span className="font-semibold">
                {totalItems} {t('lang') === 'bn' ? 'আইটেম' : 'items'}
              </span>
            </div>
            
            <button
              onClick={handleDone}
              className="flex-1 h-12 bg-[#059669] text-white font-semibold rounded-xl hover:bg-[#047857] transition-colors shadow-lg"
            >
              {t('lang') === 'bn' ? 'সম্পন্ন' : 'Done'} →
            </button>
          </div>
        )}
        
        {/* Scanning status */}
        <div className="text-center space-y-2">
          <p className="text-white/90 text-sm">
            {t('lang') === 'bn' ? 'স্ক্যান করুন... পরবর্তী ওষুধ রাখুন' : 'Scanning... Position next medicine'}
          </p>
          
          {/* Manual entry option as text link */}
          <button
            onClick={() => navigate('/sale')}
            className="text-white/60 text-xs hover:text-white/90 transition-colors underline"
          >
            {t('lang') === 'bn' ? 'ম্যানুয়াল সার্চ করুন' : 'Search manually instead'}
          </button>
          
          <p className="text-white/40 text-[10px]">
            {t('lang') === 'bn' ? 'OCR স্ক্যানিং ডেমো • প্রোটোটাইপের জন্য মক ডেটা' : 'OCR scanning demo • Mock data for prototype'}
          </p>
        </div>
      </div>
    </div>
  );
}