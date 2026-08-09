/**
 * Performance Optimization Utilities
 * Lightning-fast app performance through caching, debouncing, and memoization
 * Updated: 2026-04-10 - Enhanced with additional optimizations
 */

import { useCallback, useRef, useEffect, useMemo, useState } from "react";
import { getActiveShopId } from "./shopManager";

/**
 * localStorage Cache Manager
 * Reduces repeated localStorage reads with in-memory caching
 * Shop-aware: scoped keys are cached separately per shop to prevent cross-shop contamination
 */
class LocalStorageCache {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes cache TTL

  // Scoped keys that should be namespaced by shop ID in the cache
  private readonly SCOPED_KEYS = new Set([
    "medicines",
    "medicines_grouped",
    "transactions",
    "customers",
    "creditData",
    "expenses",
    "inventory",
    "suppliers",
    "supplierInvoices",
    "supplierPayments",
    "cashDrawer",
    "dailyHistory",
    "settledCreditHistory",
    "auditLogs",
    "staffMembers",
    "deletedMedicineIds",
    "reportSettings",
  ]);

  /**
   * Returns shop-prefixed cache key for scoped keys, bare key for global keys
   * This ensures shop_1 and shop_2 never share cached values
   */
  private cacheKey(key: string): string {
    return this.SCOPED_KEYS.has(key) ? `${getActiveShopId()}__${key}` : key;
  }

  /**
   * Returns the storage key to use when reading/writing to localStorage
   * For scoped keys, returns the shop-prefixed key; for global keys, returns bare key
   */
  private storageKey(key: string): string {
    return this.SCOPED_KEYS.has(key) ? `${getActiveShopId()}__${key}` : key;
  }

  get<T>(key: string, parser?: (val: string) => T): T | null {
    // Check cache first (using shop-aware key)
    const cached = this.cache.get(this.cacheKey(key));
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.data;
    }

    // Read from localStorage using shop-namespaced key for scoped data
    const value = localStorage.getItem(this.storageKey(key));
    if (!value) return null;

    try {
      const parsed = parser ? parser(value) : JSON.parse(value);
      // Update cache (using shop-aware key)
      this.cache.set(this.cacheKey(key), { data: parsed, timestamp: Date.now() });
      return parsed;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    const stringified = JSON.stringify(value);
    // Write to localStorage using shop-namespaced key for scoped data
    localStorage.setItem(this.storageKey(key), stringified);

    // Update cache immediately (using shop-aware key)
    this.cache.set(this.cacheKey(key), { data: value, timestamp: Date.now() });
  }

  invalidate(key: string): void {
    this.cache.delete(this.cacheKey(key));
  }

  clear(): void {
    this.cache.clear();
  }
}

export const storageCache = new LocalStorageCache();

/**
 * Debounce hook for input fields
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Optimized throttle function
 * @param func - Function to throttle
 * @param limit - Time limit in ms
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Optimized debounce function
 * @param func - Function to debounce
 * @param wait - Wait time in ms
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Hook for handling callbacks that should only run once per render cycle
 */
export function useEvent<T extends (...args: any[]) => any>(
  callback: T
): (...args: Parameters<T>) => ReturnType<T> {
  const ref = useRef<T>(callback);
  
  useEffect(() => {
    ref.current = callback;
  });

  return useCallback((...args: Parameters<T>) => {
    return ref.current(...args);
  }, []) as T;
}

/**
 * Intersection Observer hook for lazy loading
 */
export function useIntersectionObserver(
  elementRef: React.RefObject<Element>,
  options?: IntersectionObserverInit
): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      options
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [elementRef, options]);

  return isVisible;
}

/**
 * Fast array filter with early exit
 */
export function fastFilter<T>(
  array: T[],
  predicate: (item: T, index: number) => boolean,
  maxResults?: number
): T[] {
  const result: T[] = [];
  for (let i = 0; i < array.length; i++) {
    if (predicate(array[i], i)) {
      result.push(array[i]);
      if (maxResults && result.length >= maxResults) break;
    }
  }
  return result;
}

/**
 * Memoized array sort
 */
export function memoizedSort<T>(
  array: T[],
  compareFn: (a: T, b: T) => number,
  deps: React.DependencyList
): T[] {
  const memoized = useMemo(() => {
    return [...array].sort(compareFn);
  }, deps);

  return memoized;
}

/**
 * Virtual scroll hook for large lists
 */
export function useVirtualScroll(
  itemCount: number,
  itemHeight: number,
  containerHeight: number,
  scrollTop: number
): { startIndex: number; endIndex: number; offsetY: number } {
  return useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 5); // Buffer
    const endIndex = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + 5 // Buffer
    );
    const offsetY = startIndex * itemHeight;

    return { startIndex, endIndex, offsetY };
  }, [itemCount, itemHeight, containerHeight, scrollTop]);
}

/**
 * Batch updates to reduce re-renders
 */
export function useBatchedUpdates() {
  const pendingUpdates = useRef<(() => void)[]>([]);
  const frameId = useRef<number | null>(null);

  const schedule = useCallback((update: () => void) => {
    pendingUpdates.current.push(update);

    if (frameId.current === null) {
      frameId.current = requestAnimationFrame(() => {
        const updates = pendingUpdates.current;
        pendingUpdates.current = [];
        frameId.current = null;
        
        updates.forEach(update => update());
      });
    }
  }, []);

  return schedule;
}

/**
 * Optimized search filter for medicines and products
 */
export function optimizedSearch<T extends Record<string, any>>(
  items: T[],
  searchTerm: string,
  searchFields: (keyof T)[],
  maxResults: number = 50
): T[] {
  if (!searchTerm) return items.slice(0, maxResults);

  const lowerSearch = searchTerm.toLowerCase();
  const results: T[] = [];

  for (let i = 0; i < items.length; i++) {
    if (results.length >= maxResults) break;

    const item = items[i];
    for (const field of searchFields) {
      const value = item[field];
      if (
        value &&
        String(value).toLowerCase().includes(lowerSearch)
      ) {
        results.push(item);
        break;
      }
    }
  }

  return results;
}