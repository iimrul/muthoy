import { memo, useMemo, useCallback } from "react";

/**
 * Deep comparison for memo
 */
export function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  
  if (
    typeof obj1 !== "object" ||
    typeof obj2 !== "object" ||
    obj1 === null ||
    obj2 === null
  ) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Memoize component with deep comparison
 */
export function memoDeep<T extends React.ComponentType<any>>(
  Component: T
): T {
  return memo(Component, deepEqual) as T;
}

/**
 * Stable callback hook - prevents recreating functions
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  return useCallback(callback, []);
}

/**
 * Memoize expensive calculations with dependency tracking
 */
export function useMemoizedValue<T>(
  factory: () => T,
  deps: React.DependencyList
): T {
  return useMemo(factory, deps);
}

/**
 * Batch state updates for better performance
 */
export function batchUpdates<T>(
  updates: Array<(prev: T) => T>,
  setter: React.Dispatch<React.SetStateAction<T>>
) {
  setter((prev) => {
    let current = prev;
    updates.forEach((update) => {
      current = update(current);
    });
    return current;
  });
}
