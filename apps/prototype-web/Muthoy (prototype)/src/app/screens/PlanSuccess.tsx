import { useNavigate } from "../utils/navigation";
import { CheckCircle2 } from "lucide-react";

function useQueryParam(key: string): string {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get(key) || "";
}

const UNLOCKED: Record<string, string[]> = {
  pro: ["৩টি দোকান", "৪ জন স্টাফ", "সরবরাহকারী ইনভয়েস", "রিপোর্ট ও এক্সপোর্ট", "প্রিন্টার"],
  ultra: ["আনলিমিটেড দোকান", "আনলিমিটেড স্টাফ", "সব ফিচার", "প্রায়োরিটি সাপোর্ট"],
};

const PLAN_LABELS: Record<string, { bn: string }> = {
  pro: { bn: "প্রো" },
  ultra: { bn: "আল্ট্রা" },
};

export function PlanSuccess() {
  const navigate = useNavigate();
  const tier = useQueryParam("tier");
  const label = PLAN_LABELS[tier]?.bn || "প্রো";
  const unlocked = UNLOCKED[tier] || UNLOCKED.pro;

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col items-center justify-center px-6">
      {/* Big check badge */}
      <div className="relative mb-8">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center shadow-xl"
          style={{ background: "linear-gradient(135deg, #059669, #065F46)" }}
        >
          <CheckCircle2 className="w-12 h-12 text-white" />
        </div>
        {/* Subtle rings */}
        <div className="absolute inset-0 rounded-full border-2 border-[#059669]/20 scale-[1.3]" />
        <div className="absolute inset-0 rounded-full border border-[#059669]/10 scale-[1.6]" />
      </div>

      {/* Heading */}
      <p
        className="text-[22px] text-[#111827] text-center mb-2 leading-snug"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        অভিনন্দন!
      </p>
      <p
        className="text-[15px] text-[#047857] text-center mb-6"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        আপনি এখন {label} ব্যবহারকারী
      </p>

      {/* What's unlocked */}
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm mb-8 shadow-sm border border-[#D1FAE5]">
        <p className="text-[12px] text-[#6B7280] mb-3 uppercase tracking-wide" style={{ fontFamily: "var(--font-sans)" }}>
          এখন আনলক হয়েছে
        </p>
        <div className="space-y-2.5">
          {unlocked.map((item, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#ECFDF5] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" />
              </div>
              <span className="text-[13px] text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
                {item}
              </span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => navigate("/app")}
        className="w-full max-w-sm py-4 rounded-2xl text-white text-[15px] shadow-lg"
        style={{
          background: "linear-gradient(135deg, #059669, #065F46)",
          fontFamily: "var(--font-bangla)",
        }}
      >
        শুরু করুন / Get Started
      </button>
    </div>
  );
}
