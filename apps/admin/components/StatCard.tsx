interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  /**
   * CLAUDE.md rule 6: a money figure renders in DM Mono (font-mono), every
   * other number in Plus Jakarta Sans (font-sans).
   */
  isMoney?: boolean;
}

export default function StatCard({ label, value, hint, isMoney = false }: StatCardProps) {
  return (
    <section className="rounded-xl border border-black/10 p-5">
      <h2 className="text-sm font-medium text-midGray">{label}</h2>
      <p className={`mt-2 text-3xl text-richBlack ${isMoney ? 'font-mono' : 'font-sans font-semibold'}`}>{value}</p>
      <p className="mt-1 text-xs text-midGray">{hint}</p>
    </section>
  );
}
