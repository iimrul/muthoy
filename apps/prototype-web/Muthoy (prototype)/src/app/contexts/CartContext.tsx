import { createContext, useContext, useState, ReactNode, useMemo, useCallback } from "react";
import { 
  calculatePriceWithBatches, 
  calculateBatchDistribution 
} from "../utils/medicineData";

// Cart item interface
export interface CartItem {
  id: number;
  name: string;
  nameBn?: string;
  generic: string;
  manufacturer: string;
  manufacturerBn?: string;
  price: number; // This is the sale price (will be calculated dynamically)
  purchasePrice?: number;
  salePrice?: number;
  quantity: number;
  stock: number;
  unit?: string;
  batchDistribution?: any[]; // Track which batches this item uses
}

interface CartContextType {
  cartItems: CartItem[];
  addToCart: (medicine: Omit<CartItem, "quantity">) => void;
  updateQuantity: (id: number, delta: number) => void;
  setQuantity: (id: number, quantity: number) => void;
  removeFromCart: (id: number) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  getCartCount: () => number;
  updateCartPrices: () => void; // Update prices from current batches
  getItemTotal: (id: number) => number; // Get total for a specific item with batch pricing
}

const CartContext = createContext<CartContextType | undefined>(undefined);

// Helper function to calculate batch-aware pricing
const calculateBatchPricingHelper = (item: CartItem) => {
  try {
    const totalPrice = calculatePriceWithBatches(item.id, item.quantity);
    const avgPrice = item.quantity > 0 ? totalPrice / item.quantity : item.price;
    const distribution = calculateBatchDistribution(item.id, item.quantity);
    const safeAvg = Number(avgPrice) > 0 ? avgPrice : item.price;
    return {
      price: safeAvg,
      salePrice: safeAvg,
      batchDistribution: distribution,
    };
  } catch (error) {
    console.warn("Batch pricing calculation failed, using default price:", error);
    // Fallback to existing price
    return {
      price: item.price,
      salePrice: item.salePrice || item.price,
      batchDistribution: [],
    };
  }
};

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Get total for a specific item using batch-aware pricing
  const getItemTotal = useCallback((id: number): number => {
    const item = cartItems.find(i => i.id === id);
    if (!item) return 0;
    
    try {
      return calculatePriceWithBatches(item.id, item.quantity);
    } catch (error) {
      console.warn("Failed to calculate item total:", error);
      return item.price * item.quantity;
    }
  }, [cartItems]);

  // Update cart prices from current batches
  const updateCartPrices = useCallback(() => {
    setCartItems((items) => 
      items.map((item) => {
        const pricing = calculateBatchPricingHelper(item);
        return { ...item, ...pricing };
      })
    );
  }, []);

  const addToCart = useCallback((medicine: Omit<CartItem, "quantity">) => {
    setCartItems((items) => {
      const existingItem = items.find((item) => item.id === medicine.id);

      // Ensure stock is a valid number - use totalStock if stock is not available
      const stock = typeof medicine.stock === 'number' && !isNaN(medicine.stock)
        ? medicine.stock
        : (medicine as any).totalStock || 0;

      if (existingItem) {
        // Increment by 1 per click, clamped to available stock
        const nextQty = Math.min(existingItem.quantity + 1, stock);
        return items.map((item) =>
          item.id === medicine.id
            ? { ...item, quantity: nextQty, stock }
            : item
        );
      } else {
        if (stock <= 0) return items;
        return [...items, { ...medicine, quantity: 1, stock }];
      }
    });
  }, []);

  const updateQuantity = useCallback((id: number, delta: number) => {
    setCartItems((items) => {
      const updatedItems = items
        .map((item) => {
          if (item.id !== id) return item;
          const stock = typeof item.stock === 'number' && item.stock > 0 ? item.stock : Infinity;
          const next = Math.min(Math.max(1, item.quantity + delta), stock);
          return { ...item, quantity: next };
        })
        .filter((item) => item.quantity > 0);
      
      // Recalculate prices after quantity update; if batch lookup fails or returns 0,
      // keep the existing per-unit price so totals don't silently disappear.
      return updatedItems.map((item) => {
        try {
          const totalPrice = calculatePriceWithBatches(item.id, item.quantity);
          const avgPrice = item.quantity > 0 && totalPrice > 0 ? totalPrice / item.quantity : item.price;
          const distribution = calculateBatchDistribution(item.id, item.quantity);

          return {
            ...item,
            price: Number(avgPrice) || item.price,
            salePrice: Number(avgPrice) || item.salePrice || item.price,
            batchDistribution: distribution,
          };
        } catch (error) {
          console.warn("Failed to recalculate price for item:", item.name, error);
          return item;
        }
      });
    });
  }, []);

  const setQuantity = useCallback((id: number, quantity: number) => {
    setCartItems((items) => {
      const updatedItems = items.map((item) => {
        if (item.id !== id) return item;
        const stock = typeof item.stock === 'number' && item.stock > 0 ? item.stock : Infinity;
        return { ...item, quantity: Math.min(Math.max(1, quantity), stock) };
      });
      
      // Recalculate prices after quantity update; if batch lookup fails or returns 0,
      // keep the existing per-unit price so totals don't silently disappear.
      return updatedItems.map((item) => {
        try {
          const totalPrice = calculatePriceWithBatches(item.id, item.quantity);
          const avgPrice = item.quantity > 0 && totalPrice > 0 ? totalPrice / item.quantity : item.price;
          const distribution = calculateBatchDistribution(item.id, item.quantity);

          return {
            ...item,
            price: Number(avgPrice) || item.price,
            salePrice: Number(avgPrice) || item.salePrice || item.price,
            batchDistribution: distribution,
          };
        } catch (error) {
          console.warn("Failed to recalculate price for item:", item.name, error);
          return item;
        }
      });
    });
  }, []);

  const removeFromCart = useCallback((id: number) => {
    setCartItems((items) => items.filter((item) => item.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const getCartTotal = useCallback(() => {
    return cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
  }, [cartItems]);

  const getCartCount = useCallback(() => {
    return cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [cartItems]);

  const value = useMemo(
    () => ({
      cartItems,
      addToCart,
      updateQuantity,
      setQuantity,
      removeFromCart,
      clearCart,
      getCartTotal,
      getCartCount,
      updateCartPrices,
      getItemTotal,
    }),
    [cartItems, addToCart, updateQuantity, setQuantity, removeFromCart, clearCart, getCartTotal, getCartCount, updateCartPrices, getItemTotal]
  );

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    // Return a safe fallback for environments without CartProvider (e.g., Figma preview)
    console.warn("useCart called outside CartProvider - using fallback");
    return {
      cartItems: [],
      addToCart: () => {},
      updateQuantity: () => {},
      setQuantity: () => {},
      removeFromCart: () => {},
      clearCart: () => {},
      getCartTotal: () => 0,
      getCartCount: () => 0,
      updateCartPrices: () => {},
      getItemTotal: () => 0,
    };
  }
  return context;
}
