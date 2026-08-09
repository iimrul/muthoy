import { Lock } from "lucide-react";
import { useNavigate } from "../utils/navigation";

interface PremiumLockProps {
  featureNameBn?: string;
  featureNameEn?: string;
  onBack?: () => void;
}

export function PremiumLock({ featureNameBn = "এই ফিচার", featureNameEn = "This feature", onBack }: PremiumLockProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col items-center justify-center px-6 text-center">
      {/* Lock badge */}
      <div className="relative mb-8">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg, #059669, #065F46)" }}
        >
          <Lock className="w-9 h-9 text-white" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-[#059669]/20 scale-[1.3]" />
        <div className="absolute inset-0 rounded-full border border-[#059669]/10 scale-[1.6]" />
      </div>

      {/* Heading */}
      <p
        className="text-[19px] text-[#111827] mb-3 leading-snug"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {featureNameBn} প্রিমিয়াম ফিচার
      </p>
      <p className="text-[11px] text-[#9CA3AF] mb-1">{featureNameEn} is a premium feature</p>

      {/* Sub-text */}
      <p
        className="text-[13px] text-[#6B7280] mb-6 max-w-xs leading-relaxed"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        এই ফিচারটি ব্যবহার করতে প্রো বা আল্ট্রা প্ল্যানে আপগ্রেড করুন।
      </p>

      {/* Plan chips */}
      <div className="flex gap-3 mb-8">
        <span
          className="bg-white border border-[#D1FAE5] text-[#059669] px-4 py-2 rounded-full text-[13px]"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          প্রো <span style={{ fontFamily: "var(--font-money)" }}>৳৩৯৯</span>
        </span>
        <span
          className="bg-white border border-[#D1FAE5] text-[#065F46] px-4 py-2 rounded-full text-[13px]"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          আল্ট্রা <span style={{ fontFamily: "var(--font-money)" }}>৳৪৯৯</span>
        </span>
      </div>

      {/* CTA */}
      <button
        onClick={() => navigate("/app/plans")}
        className="w-full max-w-xs py-3.5 rounded-2xl text-white text-[14px] shadow-lg mb-3"
        style={{
          background: "linear-gradient(135deg, #059669, #065F46)",
          fontFamily: "var(--font-bangla)",
        }}
      >
        প্ল্যান দেখুন / View Plans
      </button>

      <button
        onClick={() => (onBack ? onBack() : navigate(-1))}
        className="text-[13px] text-[#6B7280] py-2"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        ফিরে যান / Go Back
      </button>
    </div>
  );
}

/* Modal version — render inside any screen as an overlay */
export function PremiumLockModal({
  featureNameBn,
  featureNameEn,
  onClose,
}: {
  featureNameBn?: string;
  featureNameEn?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="bg-[#ECFDF5] rounded-t-3xl w-full max-w-md px-6 pt-8 pb-10 text-center">
        <div className="relative mb-6 flex justify-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: "linear-gradient(135deg, #059669, #065F46)" }}
          >
            <Lock className="w-7 h-7 text-white" />
          </div>
        </div>
        <p
          className="text-[17px] text-[#111827] mb-2"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {featureNameBn || "এই ফিচার"} প্রিমিয়াম ফিচার
        </p>
        <p
          className="text-[12px] text-[#6B7280] mb-5 leading-relaxed"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          এই ফিচারটি ব্যবহার করতে প্রো বা আল্ট্রা প্ল্যানে আপগ্রেড করুন।
        </p>
        <div className="flex gap-3 justify-center mb-6">
          <span
            className="bg-white border border-[#D1FAE5] text-[#059669] px-3 py-1.5 rounded-full text-[12px]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            প্রো <span style={{ fontFamily: "var(--font-money)" }}>৳৩৯৯</span>
          </span>
          <span
            className="bg-white border border-[#D1FAE5] text-[#065F46] px-3 py-1.5 rounded-full text-[12px]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            আল্ট্রা <span style={{ fontFamily: "var(--font-money)" }}>৳৪৯৯</span>
          </span>
        </div>
        <button
          onClick={() => { onClose(); navigate("/app/plans"); }}
          className="w-full py-3.5 rounded-2xl text-white text-[14px] shadow-lg mb-3"
          style={{
            background: "linear-gradient(135deg, #059669, #065F46)",
            fontFamily: "var(--font-bangla)",
          }}
        >
          প্ল্যান দেখুন / View Plans
        </button>
        <button
          onClick={onClose}
          className="text-[13px] text-[#6B7280] py-2"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          ফিরে যান / Go Back
        </button>
      </div>
    </div>
  );
}
