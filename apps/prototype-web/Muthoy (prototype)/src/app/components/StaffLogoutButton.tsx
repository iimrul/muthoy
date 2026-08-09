import { LogOut } from "lucide-react";

import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import { LogoutConfirmationModal } from "./LogoutConfirmationModal";
import { useState } from "react";
import { useNavigate } from "../utils/navigation";

export function StaffLogoutButton() {
  const navigate = useNavigate();
  const { logout, isOwner, staff } = useAuth();
  const { t } = useLanguage();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Only show for staff, not for owners
  if (!staff || isOwner) {
    return null;
  }

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = () => {
    logout();
    setShowLogoutModal(false);
    navigate("/staff-login", { replace: true });
  };

  const handleCancelLogout = () => {
    setShowLogoutModal(false);
  };

  return (
    <>
      <button
        onClick={handleLogoutClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] active:bg-[#FECACA] text-[#DC2626] transition-all duration-200 shadow-sm hover:shadow active:scale-95"
        title={t("লগআউট", "Logout")}
      >
        <LogOut className="w-4 h-4" />
        <span 
          className="text-xs font-semibold"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {t("লগআউট", "Logout")}
        </span>
      </button>

      <LogoutConfirmationModal
        isOpen={showLogoutModal}
        onClose={handleCancelLogout}
        onConfirm={handleConfirmLogout}
        userType="staff"
      />
    </>
  );
}