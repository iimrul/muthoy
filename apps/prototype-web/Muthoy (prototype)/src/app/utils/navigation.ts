import { useCallback } from "react";
import { useNavigate as useRouterNavigate, NavigateOptions, To } from "react-router";

/**
 * Thin wrapper around react-router's useNavigate.
 * React Router v7 wraps all state updates in React.startTransition internally
 * (RouterProvider's setState subscriber), so we must NOT add another
 * startTransition here — double-wrapping causes the Suspense warning:
 * "A component suspended while responding to synchronous input."
 */
export function useNavigate() {
  const navigate = useRouterNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        (navigate as any)(to);
      } else {
        navigate(to as To, options);
      }
    },
    [navigate]
  ) as ReturnType<typeof useRouterNavigate>;
}
