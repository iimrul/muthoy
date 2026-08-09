import { useNavigate } from "../utils/navigation";
import { getTrialDaysLeft, isTrialActive, isTrialExpired } from "../utils/planStore";

export function TrialBanner() {
  const navigate = useNavigate();
  const active = isTrialActive();
  const expired = isTrialExpired();

  if (!active && !expired) return null;

  if (active) {
    const daysLeft = getTrialDaysLeft() ?? 0;
    return (
      <div className="mx-4 mb-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] px-4 py-2.5 flex items-center justify-between">
        <p className="text-[12px] text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
          ট্রায়াল চলছে — <strong style={{ fontFamily: "var(--font-sans)" }}>{daysLeft}</strong> দিন বাকি
        </p>
        <button
          onClick={() => navigate("/app/plans")}
          className="text-[11px] text-[#92400E] underline ml-4 shrink-0"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          আপগ্রেড
        </button>
      </div>
    );
  }

  // Trial expired
  return (
    <div className="mx-4 mb-4 bg-white rounded-2xl border-l-4 border-[#059669] shadow-sm p-4">
      <p className="text-[14px] text-[#111827] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
        আপনার ট্রায়াল শেষ হয়েছে
      </p>
      <p className="text-[12px] text-[#6B7280] mb-3 leading-relaxed" style={{ fontFamily: "var(--font-bangla)" }}>
        এখন আপনি বিক্রয়, ইনভেন্টরি, স্ক্যান এবং ১ জন স্টাফ ব্যবহার করতে পারবেন।
        সম্পূর্ণ ফিচার ফিরে পেতে আপগ্রেড করুন।
      </p>
      <button
        onClick={() => navigate("/app/plans")}
        className="w-full py-2.5 rounded-xl text-white text-[13px]"
        style={{
          background: "linear-gradient(135deg, #059669, #065F46)",
          fontFamily: "var(--font-bangla)",
        }}
      >
        আপগ্রেড করুন / Upgrade
      </button>
    </div>
  );
}
