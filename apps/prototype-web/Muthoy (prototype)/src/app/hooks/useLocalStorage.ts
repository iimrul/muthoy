import { useState, useEffect, useCallback } from "react";

/**
 * Optimized LocalStorage Hook with Caching
 * Reduces redundant localStorage reads and improves performance
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void, () => void] {
  // Cache to prevent multiple reads
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Memoized setValue function
  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        
        setStoredValue(valueToStore);
        
        // Batch localStorage writes
        requestIdleCallback(
          () => {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          },
          { timeout: 100 }
        );
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  // Memoized remove function
  const removeValue = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
      setStoredValue(initialValue);
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}

/**
 * Batch localStorage operations for better performance
 */
export function batchLocalStorage(operations: (() => void)[]) {
  requestIdleCallback(
    () => {
      operations.forEach((op) => {
        try {
          op();
        } catch (error) {
          console.warn("Batch localStorage operation failed:", error);
        }
      });
    },
    { timeout: 100 }
  );
}

/**
 * Cached localStorage getter - reads from memory after first access
 */
const localStorageCache = new Map<string, any>();

export function getCachedItem<T>(key: string, defaultValue: T): T {
  if (localStorageCache.has(key)) {
    return localStorageCache.get(key);
  }

  try {
    const item = window.localStorage.getItem(key);
    const value = item ? JSON.parse(item) : defaultValue;
    localStorageCache.set(key, value);
    return value;
  } catch (error) {
    console.warn(`Error reading cached localStorage key "${key}":`, error);
    return defaultValue;
  }
}

/**
 * Invalidate cache for a specific key
 */
export function invalidateCache(key: string) {
  localStorageCache.delete(key);
}

/**
 * Clear all cache
 */
export function clearCache() {
  localStorageCache.clear();
}
