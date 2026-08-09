
import { Home, ArrowLeft } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { Button } from "../components/ui/button";
import { useNavigate } from "../utils/navigation";

export function NotFound() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* 404 Illustration */}
        <div className="mb-8">
          <div className="text-[120px] font-bold text-[#059669]/10 leading-none" style={{ fontFamily: "var(--font-sans)" }}>
            404
          </div>
        </div>

        {/* Error Message */}
        <h1
          className="text-2xl text-[#111827] mb-3"
          style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
        >
          {t("পৃষ্ঠা পাওয়া যায়নি", "Page Not Found")}
        </h1>
        
        <p
          className="text-base text-[#6B7280] mb-8"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {t(
            "আপনি যে পৃষ্ঠাটি খুঁজছেন তা বিদ্যমান নেই বা সরানো হয়েছে।",
            "The page you're looking for doesn't exist or has been moved."
          )}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => navigate("/app")}
            className="h-12 bg-[#059669] hover:bg-[#047857] text-white rounded-xl shadow-lg"
          >
            <Home className="w-5 h-5 mr-2" />
            <span style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {t("হোম পেজে ফিরে যান", "Go to Home")}
            </span>
          </Button>

          <Button
            onClick={() => navigate(-1)}
            variant="outline"
            className="h-12 border-[#059669] text-[#059669] hover:bg-[#ECFDF5] rounded-xl"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            <span style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {t("পেছনে যান", "Go Back")}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
