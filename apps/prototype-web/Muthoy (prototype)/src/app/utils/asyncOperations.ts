/**
 * Async operation utilities for better performance
 * Using requestIdleCallback for non-critical operations
 */

/**
 * Execute function when browser is idle
 */
export function runWhenIdle(callback: () => void, timeout: number = 2000): void {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(callback, { timeout });
  } else {
    // Fallback for browsers that don't support requestIdleCallback
    setTimeout(callback, 1);
  }
}

/**
 * Batch multiple operations and run when idle
 */
export function batchOperations(operations: Array<() => void>): void {
  runWhenIdle(() => {
    operations.forEach(op => op());
  });
}

/**
 * Defer heavy computation
 */
export async function deferComputation<T>(computation: () => T): Promise<T> {
  return new Promise((resolve) => {
    runWhenIdle(() => {
      resolve(computation());
    });
  });
}

/**
 * Chunk array processing for better performance
 */
export async function processInChunks<T, R>(
  items: T[],
  processor: (item: T) => R,
  chunkSize: number = 50
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = chunk.map(processor);
    results.push(...chunkResults);
    
    // Give browser a chance to breathe
    if (i + chunkSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  return results;
}
