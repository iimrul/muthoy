import { useEffect } from "react";

import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

/**
 * Component that checks if logged-in staff is still active
 * Logs them out if owner has deactivated their account
 */
export function StaffActiveCheck() {
  const navigate = useNavigate();
  const { staff, logout } = useAuth();

  useEffect(() => {
    // Only run for logged-in staff
    if (!staff) return;

    // Check every 2 seconds if staff is still active
    const interval = setInterval(() => {
      const staffMembers = JSON.parse(shopStorage.getItem('staffMembers') || '[]');
      const currentStaff = staffMembers.find((s: any) => s.id === staff.id);

      // If staff no longer exists or is deactivated, log them out
      if (!currentStaff || !currentStaff.active) {
        logout();
        // Clear auth type so MainLayout redirects to correct login
        localStorage.removeItem('authType');
        navigate("/staff-login", { replace: true });
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [staff, logout, navigate]);

  return null;
}