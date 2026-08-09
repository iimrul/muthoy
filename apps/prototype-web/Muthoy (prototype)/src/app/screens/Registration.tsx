import { useState } from "react";

import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { Store, User, Phone, ArrowRight } from "lucide-react";
import logoSvg from "../../imports/logo-1.svg?raw";
import { useMobileNumberSanitizer } from "../hooks/useMobileNumberSanitizer";
import { validateMobileNumber, formatMobileForStorage } from "../utils/mobileNumber";
import { useNavigate } from "../utils/navigation";

export function Registration() {
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [showLoginCTA, setShowLoginCTA] = useState(false);

  // Mobile number sanitizer
  const { sanitizeMobile, handleMobileBlur } = useMobileNumberSanitizer(phone, setPhone);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setShowLoginCTA(false);

    // Sanitize mobile number before validation
    const sanitizedPhone = sanitizeMobile(phone);
    if (sanitizedPhone !== phone) {
      setPhone(sanitizedPhone);
    }

    if (!ownerName.trim()) {
      setError(t("আপনার নাম আবশ্যক", "Your name is required"));
      return;
    }

    if (!shopName.trim()) {
      setError(t("দোকানের নাম আবশ্যক", "Shop name is required"));
      return;
    }

    if (!validateMobileNumber(sanitizedPhone)) {
      setError(t("সঠিক ফোন নম্বর দিন (10 ডিজিট, 1 দিয়ে শুরু)", "Enter valid phone (10 digits, starting with 1)"));
      return;
    }

    // Check if user already exists
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const existingUser = users.find((u: any) => u.phone === sanitizedPhone);
    
    if (existingUser) {
      setShowLoginCTA(true);
      return;
    }

    // Store temp registration data (phone number sanitized)
    localStorage.setItem('tempRegistration', JSON.stringify({
      shopName: shopName.trim(),
      ownerName: ownerName.trim(),
      phone: sanitizedPhone,
    }));

    // Navigate to OTP verification
    navigate("/otp");
  };

  return (
    <div className="bg-gradient-to-br from-[#F9F9FF] to-[#ECFDF5] min-h-screen flex flex-col items-center overflow-x-hidden">
      {/* Cloud Ready Badge */}
      <div className="fixed top-6 right-6 flex items-center space-x-2 bg-white/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/30 shadow-sm z-50">
        <div className="relative flex items-center justify-center">
          <span className="w-2 h-2 rounded-full bg-[#059669] animate-pulse"></span>
          <span className="absolute w-2 h-2 rounded-full bg-[#059669] opacity-20 animate-ping"></span>
        </div>
        <span
          className="text-[10px] uppercase tracking-wider text-[#059669]"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 700 }}
        >
          Cloud Ready
        </span>
      </div>

      {/* Language Toggle */}
      <div className="fixed top-6 left-6 z-50">
        <LanguageToggle />
      </div>

      {/* Main Content */}
      <main className="w-full max-w-md min-h-screen px-6 py-8 flex flex-col justify-between">
        {/* Top Section: Brand */}
        <div className="flex flex-col items-center mt-8">
          <div className="flex items-center space-x-1">
            <span
              className="text-3xl tracking-tight text-[#111827]"
              style={{ fontFamily: "var(--font-sans)", fontWeight: 800 }}
            >
              Muthoy
            </span>
            <span
              className="text-3xl tracking-tight text-[#059669]"
              style={{ fontFamily: "var(--font-sans)", fontWeight: 800 }}
            >
              (মুঠোয়)
            </span>
          </div>

          <p
            className="mt-2 text-[15px] font-medium text-[#6B7280]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("আপনার ফার্মেসির ডিজিটাল সহযোগী", "Your pharmacy's digital partner")}
          </p>

          {/* Logo */}
          <div className="mt-8 w-full flex items-center justify-center">
<div
              role="img"
              aria-label="Portable POS"
              className="w-36 h-36 [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: logoSvg.replace(/<svg([^>]*)>/, '<svg$1 viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">') }}
            />
          </div>
        </div>

        {/* Form Section */}
        <div className="flex-1 mt-12 flex flex-col space-y-6">
          <div className="text-center mb-4">
            <h2 
              className="text-2xl font-bold text-[#111827] mb-2"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("রেজিস্ট্রেশন করুন", "Register Now")}
            </h2>
            <p 
              className="text-sm text-[#6B7280]"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("আপনার তথ্য দিয়ে শুরু করুন", "Get started with your information")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Owner Name */}
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-[#374151] flex items-center gap-2"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                <User className="w-4 h-4 text-[#059669]" />
                {t("আপনার নাম", "Your Name")}
                <span className="text-[#DC2626]">*</span>
              </label>
              <input
                className="w-full h-14 px-4 bg-white/80 backdrop-blur-sm border-2 border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:bg-white focus:ring-0 transition-all outline-none shadow-sm"
                placeholder={t("যেমন: আব্দুর রহিম", "e.g., Abdur Rahim")}
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                style={{ fontFamily: "var(--font-bangla)" }}
                autoFocus
              />
            </div>

            {/* Shop Name */}
            <div className="space-y-2">
              <label 
                className="text-sm font-medium text-[#374151] flex items-center gap-2"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                <Store className="w-4 h-4 text-[#059669]" />
                {t("দোকানের নাম", "Shop Name")}
                <span className="text-[#DC2626]">*</span>
              </label>
              <input
                className="w-full h-14 px-4 bg-white/80 backdrop-blur-sm border-2 border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:bg-white focus:ring-0 transition-all outline-none shadow-sm"
                placeholder={t("যেমন: রহিম ফার্মেসি", "e.g., Rahim Pharmacy")}
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                style={{ fontFamily: "var(--font-bangla)" }}
              />
            </div>

            {/* Phone Number */}
            <div className="space-y-2">
              <label 
                className="text-sm font-medium text-[#374151] flex items-center gap-2"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                <Phone className="w-4 h-4 text-[#059669]" />
                {t("মোবাইল নম্বর", "Mobile Number")}
                <span className="text-[#DC2626]">*</span>
              </label>
              <div className="relative">
                <span 
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[#111827] font-semibold pointer-events-none"
                  style={{ fontFamily: "var(--font-sans)", fontSize: "16px" }}
                >
                  +880
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    if (value.length <= 10) setPhone(value);
                  }}
                  onBlur={handleMobileBlur}
                  className="w-full h-14 pl-16 pr-4 bg-white border-2 border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:ring-0 transition-all outline-none"
                  placeholder="1XXX XXX XXX"
                  style={{ fontFamily: "var(--font-sans)", fontSize: "16px" }}
                  maxLength={10}
                  autoFocus
                />
              </div>
            </div>

            {/* Duplicate-phone CTA (FR-006) */}
            {showLoginCTA && (
              <div className="bg-[#ECFDF5] border border-[#059669] rounded-xl p-4 space-y-3">
                <p className="text-sm text-[#047857]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                  {t("এই নম্বরে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।", "An account already exists for this number.")}
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/login", { state: { phone } })}
                  className="w-full h-11 bg-[#059669] hover:bg-[#047857] text-white rounded-xl flex items-center justify-center gap-2 transition-colors active:scale-95"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
                >
                  {t("বিদ্যমান অ্যাকাউন্টে লগ ইন করুন", "Log in to existing account")}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Validation errors */}
            {error && (
              <div className="bg-[#FEE2E2] border border-[#DC2626] rounded-xl p-3 text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)" }}>
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full h-14 text-white text-base font-bold rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                fontFamily: "var(--font-bangla)",
              }}
            >
              {t("পরবর্তী", "Continue")}
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>

          {/* Login Link */}
          <div className="pt-4 text-center">
            <button
              onClick={() => navigate("/login")}
              className="text-[#059669] font-semibold text-sm hover:underline"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ইতিমধ্যে অ্যাকাউন্ট আছে? লগইন করুন", "Already have an account? Login")}
            </button>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-6 text-center px-4">
          <p
            className="text-[11px] leading-relaxed text-[#6B7280]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("রেজিস্ট্রেশন করে আপনি আমাদের ", "By registering you agree to our ")}
            <a className="underline font-medium text-[#374151]" href="#">
              {t("শর্তাবলী", "Terms")}
            </a>
            {t(" এবং ", " and ")}
            <a className="underline font-medium text-[#374151]" href="#">
              {t("গোপনীয়তা নীতিতে", "Privacy Policy")}
            </a>
            {t(" সম্মত হচ্ছেন", "")}
          </p>
        </footer>
      </main>
    </div>
  );
}