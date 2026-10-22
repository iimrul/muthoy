// domain/medicineSearchProvider.ts — the seam a real ~21k medicine
// master-database search/select will plug into later, without redesigning
// Add Medicine's UI. No backend/dataset decision has been made yet
// (MedEx vs. another source is still pending) — this stub always returns no
// results, which the UI renders as an explicit "not connected yet" state,
// never a fake or fixture match. Zero React/DB imports (DEVELOPMENT_RULES.md).

export interface MedicineSearchResult {
  id: string;
  name: string;
  generic?: string;
  manufacturer?: string;
  // W2-02: disambiguating fields. Without them a 21k catalogue renders
  // "Napa 500mg" and "Napa 665mg" as two identical rows reading "Napa" and the
  // user picks blind. OPTIONAL so unavailableMedicineSearchProvider below and
  // every existing consumer keep compiling unchanged. These are shown beside the
  // name — never concatenated INTO it, because medicines.name must stay the
  // brand name for medicines_fts and findExactNameMatch.
  strength?: string;
  dosageForm?: string;
  packSize?: string;
}

export interface MedicineSearchProvider {
  search(query: string): Promise<MedicineSearchResult[]>;
}

export const unavailableMedicineSearchProvider: MedicineSearchProvider = {
  async search(): Promise<MedicineSearchResult[]> {
    return [];
  },
};
