
import { useCallback, useTransition } from "react";
import { useNavigate } from "../utils/navigation";

/**
 * Optimized Navigation Hook
 * Provides smooth transitions and instant feedback
 */
export function useOptimizedNavigation() {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  const navigateTo = useCallback(
    (path: string, options?: { replace?: boolean; state?: any }) => {
      startTransition(() => {
        navigate(path, options);
      });
    },
    [navigate]
  );

  const goBack = useCallback(() => {
    startTransition(() => {
      navigate(-1);
    });
  }, [navigate]);

  return {
    navigateTo,
    goBack,
    isPending,
  };
}

/**
 * Navigate with delay for animations
 */
export function useDelayedNavigation(delay: number = 300) {
  const navigate = useNavigate();

  const navigateWithDelay = useCallback(
    (path: string, options?: { replace?: boolean; state?: any }) => {
      setTimeout(() => {
        navigate(path, options);
      }, delay);
    },
    [navigate, delay]
  );

  return navigateWithDelay;
}
