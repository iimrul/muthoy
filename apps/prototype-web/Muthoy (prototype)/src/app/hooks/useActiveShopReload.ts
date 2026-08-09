import { useEffect } from "react";

/**
 * Re-runs the provided reload function whenever the active shop changes.
 * Ensures data screens refresh when the user switches shops.
 *
 * @param reload - The function to call when the shop changes (typically the screen's data loading function)
 */
export function useActiveShopReload(reload: () => void) {
  useEffect(() => {
    const handleShopChange = () => {
      reload();
    };

    window.addEventListener("activeShopChanged", handleShopChange);
    return () => window.removeEventListener("activeShopChanged", handleShopChange);
  }, [reload]);
}
