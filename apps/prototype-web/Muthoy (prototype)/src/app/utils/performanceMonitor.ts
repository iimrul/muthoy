/**
 * Performance Monitoring Utility
 * Track and optimize app performance in real-time
 */

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private readonly MAX_METRICS = 100; // Keep last 100 metrics per type

  /**
   * Mark the start of a performance measurement
   */
  mark(label: string): void {
    performance.mark(`${label}-start`);
  }

  /**
   * Mark the end and calculate duration
   */
  measure(label: string): number {
    const startMark = `${label}-start`;
    const endMark = `${label}-end`;
    
    performance.mark(endMark);
    
    try {
      performance.measure(label, startMark, endMark);
      const measure = performance.getEntriesByName(label)[0] as PerformanceEntry;
      const duration = measure.duration;

      // Store metric
      this.storeMetric(label, duration);

      // Cleanup
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(label);

      return duration;
    } catch (error) {
      console.warn(`Performance measurement failed for ${label}:`, error);
      return 0;
    }
  }

  /**
   * Store metric with timestamp
   */
  private storeMetric(name: string, duration: number): void {
    const metrics = this.metrics.get(name) || [];
    
    metrics.push({
      name,
      duration,
      timestamp: Date.now(),
    });

    // Keep only last MAX_METRICS
    if (metrics.length > this.MAX_METRICS) {
      metrics.shift();
    }

    this.metrics.set(name, metrics);
  }

  /**
   * Get average duration for a metric
   */
  getAverage(name: string): number {
    const metrics = this.metrics.get(name) || [];
    if (metrics.length === 0) return 0;

    const sum = metrics.reduce((acc, m) => acc + m.duration, 0);
    return sum / metrics.length;
  }

  /**
   * Get all metrics for a name
   */
  getMetrics(name: string): PerformanceMetric[] {
    return this.metrics.get(name) || [];
  }

  /**
   * Get performance summary
   */
  getSummary(): Record<string, { avg: number; min: number; max: number; count: number }> {
    const summary: Record<string, any> = {};

    this.metrics.forEach((metrics, name) => {
      const durations = metrics.map(m => m.duration);
      summary[name] = {
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        count: durations.length,
      };
    });

    return summary;
  }

  /**
   * Log performance summary to console
   */
  logSummary(): void {
    console.group('📊 Performance Summary');
    const summary = this.getSummary();
    
    Object.entries(summary).forEach(([name, stats]) => {
      console.log(
        `${name}:`,
        `avg=${stats.avg.toFixed(2)}ms`,
        `min=${stats.min.toFixed(2)}ms`,
        `max=${stats.max.toFixed(2)}ms`,
        `count=${stats.count}`
      );
    });
    
    console.groupEnd();
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Track component render time
   */
  trackRender(componentName: string, callback: () => void): void {
    this.mark(`render-${componentName}`);
    callback();
    const duration = this.measure(`render-${componentName}`);
    
    if (duration > 16) { // More than one frame (60fps)
      console.warn(`⚠️ Slow render: ${componentName} took ${duration.toFixed(2)}ms`);
    }
  }

  /**
   * Track navigation time
   */
  trackNavigation(from: string, to: string): () => void {
    const label = `nav-${from}-to-${to}`;
    this.mark(label);
    
    return () => {
      const duration = this.measure(label);
      if (duration > 100) {
        console.warn(`⚠️ Slow navigation: ${label} took ${duration.toFixed(2)}ms`);
      }
    };
  }

  /**
   * Track localStorage operation
   */
  trackStorage(operation: string, callback: () => void): void {
    this.mark(`storage-${operation}`);
    callback();
    this.measure(`storage-${operation}`);
  }

  /**
   * Get Web Vitals (LCP, FID, CLS)
   */
  getWebVitals(): void {
    if ('web-vital' in performance) {
      // Observer for performance entries
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          console.log(`${entry.name}:`, entry);
        }
      });

      observer.observe({ entryTypes: ['largest-contentful-paint', 'first-input', 'layout-shift'] });
    }
  }
}

// Singleton instance
export const perfMonitor = new PerformanceMonitor();

/**
 * Hook for tracking component performance
 */
export function usePerformanceTracking(componentName: string) {
  perfMonitor.mark(`mount-${componentName}`);
  
  // Track mount time on unmount
  return () => {
    perfMonitor.measure(`mount-${componentName}`);
  };
}

/**
 * Decorator for tracking function performance
 */
export function trackPerformance(label: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      perfMonitor.mark(label);
      const result = originalMethod.apply(this, args);
      perfMonitor.measure(label);
      return result;
    };

    return descriptor;
  };
}

// Development mode only - log summary periodically
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    if (perfMonitor.getSummary && Object.keys(perfMonitor.getSummary()).length > 0) {
      perfMonitor.logSummary();
    }
  }, 30000); // Every 30 seconds
}
