import { useState, useEffect, useMemo, useCallback } from "react";
import { useDebounce, storageCache } from "../utils/performance";
import { useLocation } from "react-router";
import { Plus, Edit2, Trash2, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, PackageX, Clock } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { StandardHeader } from "../components/StandardHeader";
import { AddMedicineModal } from "../components/AddMedicineModal";
import { CSVImportButton } from "../components/CSVImportButton";
import { EditMedicineModal } from "../components/EditMedicineModal";
import { EditBatchModal } from "../components/EditBatchModal";
import { getMedicines, saveMedicines, invalidateGroupedMedicinesCache, sortBatchesFEFO, expiryDaysFromDate, type Medicine } from "../utils/medicineData";
import { calculateExpiryDays } from "../utils/batchUtils";
import { useAuditLog } from "../contexts/AuditLogContext";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";
import { getActiveShopId } from "../utils/shopManager";

export function Inventory() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { addLog } = useAuditLog();
  const { staff, isOwner, hasPermission, isAuthenticated } = useAuth();
  const [selectedFilter, setSelectedFilter] = useState("All");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditBatchModalOpen, setIsEditBatchModalOpen] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<any>(null);
  const [editingBatch, setEditingBatch] = useState<any>(null);
  const [editingBatchMedicineName, setEditingBatchMedicineName] = useState("");
  const [expandedMedicineId, setExpandedMedicineId] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isBatchSelectModalOpen, setIsBatchSelectModalOpen] = useState(false);
  const [batchSelectMedicine, setBatchSelectMedicine] = useState<any>(null);

  const loadMedicines = useCallback(() => {
    setMedicines(getMedicines());
  }, []);

  // Reload medicines when active shop changes
  useActiveShopReload(loadMedicines);

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      const allMedicines = getMedicines();
      setMedicines(allMedicines);
      setIsSyncing(false);
      setLastSynced(new Date());
    }, 1500);
  };

  // Permission check - deferred to avoid suspension conflicts
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("inventory_view")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  useEffect(() => {
    setMedicines(getMedicines());
  }, [location.pathname]);

  useEffect(() => {
    const handleMedicinesUpdate = () => {
      const shopId = getActiveShopId();
      storageCache.invalidate(`${shopId}__medicines`);
      invalidateGroupedMedicinesCache(shopId);
      setMedicines(getMedicines());
    };
    window.addEventListener("medicines-updated", handleMedicinesUpdate);
    return () => window.removeEventListener("medicines-updated", handleMedicinesUpdate);
  }, []);

  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  const filters = [
    { key: "All", label: { bn: "সব ঔষধ", en: "All Medications" } },
    { key: "Low Stock", label: { bn: "কম স্টক", en: "Low Stock" } },
    { key: "Out of Stock", label: { bn: "স্টক নেই", en: "Out of Stock" } },
    { key: "Expiring", label: { bn: "মেয়াদ শেষ", en: "Expiring Soon" } },
  ];

  // Group medicines by name+generic — O(n) via Map, memoized.
  const groupedMedicines = useMemo(() => medicines.reduce((acc: any, med: any) => {
    const medStock = med.batches && med.batches.length > 0
      ? med.batches.reduce((sum: number, b: any) => sum + (Number(b.stock) || 0), 0)
      : (Number(med.stock) || 0);
    if (medStock === 0) return acc;

    const existing = acc.find((m: any) => m.name === med.name && m.generic === med.generic);
    if (existing) {
      existing.totalStock += medStock;
      
      // Only add batches that have stock > 0
      if (med.batches && med.batches.length > 0) {
        med.batches.forEach((batch: any) => {
          if (batch.stock > 0) {
            existing.batches.push({
              id: med.id,
              batchNo: batch.batchNo,
              expiryDate: batch.expiryDate,
              stock: batch.stock,
              expiry: batch.expiryDate ? calculateExpiryDays(batch.expiryDate) : null,
              purchasePrice: batch.purchasePrice,
              salePrice: batch.salePrice,
              isDiscounted: med.isDiscounted,
              discountPercentage: med.discountPercentage,
            });
          }
        });
      } else {
        // Legacy format
        existing.batches.push({
          id: med.id,
          batchNo: med.batchNo,
          expiryDate: med.expiryDate,
          stock: med.stock,
          expiry: med.expiryDate ? calculateExpiryDays(med.expiryDate) : med.expiry,
          purchasePrice: med.purchasePrice,
          salePrice: med.salePrice,
          isDiscounted: med.isDiscounted,
          discountPercentage: med.discountPercentage,
        });
      }

      // Update earliest expiry from all batches
      existing.batches.forEach((batch: any) => {
        if (batch.expiry !== null && batch.expiry !== undefined) {
          if (existing.earliestExpiry === null || existing.earliestExpiry === undefined || batch.expiry < existing.earliestExpiry) {
            existing.earliestExpiry = batch.expiry;
          }
        }
      });
    } else {
      const batches: any[] = [];

      // Handle batched format
      if (med.batches && med.batches.length > 0) {
        med.batches.forEach((batch: any) => {
          if (batch.stock > 0) {
            batches.push({
              id: med.id,
              batchNo: batch.batchNo,
              expiryDate: batch.expiryDate,
              stock: batch.stock,
              expiry: batch.expiryDate ? calculateExpiryDays(batch.expiryDate) : null,
              purchasePrice: batch.purchasePrice,
              salePrice: batch.salePrice,
              isDiscounted: med.isDiscounted,
              discountPercentage: med.discountPercentage,
            });
          }
        });
      } else {
        // Legacy format
        batches.push({
          id: med.id,
          batchNo: med.batchNo,
          expiryDate: med.expiryDate,
          stock: med.stock,
          expiry: med.expiryDate ? calculateExpiryDays(med.expiryDate) : med.expiry,
          purchasePrice: med.purchasePrice,
          salePrice: med.salePrice,
          isDiscounted: med.isDiscounted,
          discountPercentage: med.discountPercentage,
        });
      }

      // Calculate earliest expiry from all batches
      let earliestExpiry = null;
      batches.forEach((batch: any) => {
        if (batch.expiry !== null && batch.expiry !== undefined) {
          if (earliestExpiry === null || batch.expiry < earliestExpiry) {
            earliestExpiry = batch.expiry;
          }
        }
      });

      acc.push({
        id: med.id,
        name: med.name,
        generic: med.generic,
        manufacturer: med.manufacturer,
        type: med.type,
        threshold: med.threshold,
        totalStock: medStock,
        earliestExpiry: earliestExpiry,
        batches: batches,
      });
    }
    return acc;
  }, []), [medicines]);

  const filteredMedicines = useMemo(() => groupedMedicines.filter((med: any) => {
    if (debouncedSearchQuery) {
      const query = debouncedSearchQuery.toLowerCase();
      const matchesName = med.name.toLowerCase().includes(query);
      const matchesGeneric = med.generic.toLowerCase().includes(query);
      const matchesBatch = med.batches.some((b: any) => b.batchNo.toLowerCase().includes(query));
      if (!matchesName && !matchesGeneric && !matchesBatch) return false;
    }
    if (selectedFilter === "All") return true;
    if (selectedFilter === "Low Stock") return med.totalStock > 0 && med.totalStock < med.threshold;
    if (selectedFilter === "Expiring") return med.earliestExpiry !== null && med.earliestExpiry <= 60;
    if (selectedFilter === "Out of Stock") return med.totalStock === 0;
    return true;
  }), [groupedMedicines, debouncedSearchQuery, selectedFilter]);

  // Summary stats — single pass.
  const { totalMedicines, lowStockCount, outOfStockCount, expiringCount } = useMemo(() => {
    let low = 0, out = 0, exp = 0;
    for (const med of groupedMedicines as any[]) {
      if (med.totalStock === 0) out++;
      else if (med.totalStock < med.threshold) low++;
      if (med.earliestExpiry !== null && med.earliestExpiry <= 60) exp++;
    }
    return {
      totalMedicines: groupedMedicines.length,
      lowStockCount: low,
      outOfStockCount: out,
      expiringCount: exp,
    };
  }, [groupedMedicines]);

  const getMedicineIcon = (type: string) => {
    switch (type) {
      case "tablet": return "pill";
      case "capsule": return "medication";
      case "syrup": return "water_drop";
      case "injection": return "syringe";
      case "insulin": return "vaccines";
      default: return "medication";
    }
  };

  const getMedicineIconColor = (med: any) => {
    if (med.totalStock === 0) {
      return { bg: "bg-[#ffdad6]/30", text: "text-[#ba1a1a]" };
    }
    if (med.totalStock < med.threshold) {
      return { bg: "bg-[#ffdbca]/30", text: "text-[#84451e]" };
    }
    if (med.earliestExpiry !== null && med.earliestExpiry < 60) {
      return { bg: "bg-[#ffdad6]/30", text: "text-[#ba1a1a]" };
    }
    return { bg: "bg-[#ECFDF5]/50", text: "text-[#059669]" };
  };

  const getStatusBadge = (med: any) => {
    if (med.totalStock === 0) {
      return { bg: "bg-[#ffdad6]", text: "text-[#93000a]", label: { bn: "স্টক নেই", en: "Out of Stock" } };
    }
    if (med.earliestExpiry !== null && med.earliestExpiry < 60) {
      return { bg: "bg-[#ffdad6]", text: "text-[#93000a]", label: { bn: `${med.earliestExpiry} দিন`, en: `${med.earliestExpiry} days` } };
    }
    if (med.totalStock < med.threshold) {
      return { bg: "bg-[#ffdbca]", text: "text-[#713610]", label: { bn: "কম স্টক", en: "Low Stock" } };
    }
    return { bg: "bg-[#95f2f1]", text: "text-[#004f4f]", label: { bn: "স্বাভাবিক", en: "Status: OK" } };
  };

  const getStockPercentage = (med: any) => {
    if (med.totalStock === 0) return 0;
    return Math.min((med.totalStock / med.threshold) * 100, 100);
  };

  const getStockBarColor = (med: any) => {
    if (med.totalStock === 0) return "bg-[#ba1a1a]";
    if (med.totalStock < med.threshold) return "bg-[#84451e]";
    return "bg-[#059669]";
  };

  return (
    <div className="min-h-screen bg-[#f9f9fc]">
      {/* Header */}
      <StandardHeader
        title={t("ইনভেন্টরি ম্যানেজমেন্ট", "Inventory Management")}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              className={`relative p-2 rounded-full hover:bg-[#ECFDF5]/50 transition-all ${
                isSyncing ? 'animate-spin' : ''
              }`}
              aria-label="Sync"
              title={lastSynced ? `Last synced: ${lastSynced.toLocaleTimeString()}` : 'Sync now'}
            >
              <RefreshCw className="w-5 h-5 text-[#059669]" />
              {lastSynced && (
                <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#10b981] rounded-full"></span>
              )}
            </button>
            <LanguageToggle />
          </div>
        }
      />

      {/* Search and Action Bar */}
      <div className="px-3 py-2 flex flex-col gap-2 bg-[#f9f9fc]">
        <div className="flex-1 w-full">
          <label className="flex flex-col min-w-40 h-9 w-full">
            <div className="flex w-full flex-1 items-stretch rounded-lg h-full bg-[#e8e8ea]">
              <div className="text-[#3e4949] flex items-center justify-center pl-3">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
              </div>
              <input
                className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-[#1a1c1e] focus:outline-0 focus:ring-0 border-none bg-transparent placeholder:text-[#3e4949]/60 px-3 pl-2 text-sm font-normal leading-normal"
                placeholder={t("নাম, জেনেরিক বা ব্যাচ দিয়ে খুঁজুন...", "Search by name, generic or batch...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </label>
        </div>
        {(isOwner || hasPermission("inventory_edit")) && (
          <div className="flex items-center gap-2 w-full">
            {(isOwner || hasPermission("inventory_edit")) && (
              <button
                className="group flex flex-1 min-w-0 h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-white shadow-md shadow-[#059669]/10 transition-all active:scale-95 hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #047857 0%, #059669 100%)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #059669 0%, #10b981 100%)'; }}
                onClick={() => setIsAddModalOpen(true)}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1", fontSize: 16 }}>add_circle</span>
                <span className="text-xs font-bold tracking-wide whitespace-nowrap" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("স্টক যোগ করুন", "Add Stock")}
                </span>
              </button>
            )}
            {isOwner && <CSVImportButton />}
          </div>
        )}
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 px-4 pb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {filters.map((filter) => {
          const count = filter.key === "Low Stock" ? lowStockCount
            : filter.key === "Out of Stock" ? outOfStockCount
            : filter.key === "Expiring" ? expiringCount
            : 0;

          return (
            <button
              key={filter.key}
              onClick={() => setSelectedFilter(filter.key)}
              className={`flex h-7 shrink-0 items-center justify-center gap-x-1.5 rounded-full px-3 transition-all ${
                selectedFilter === filter.key
                  ? "bg-[#059669] text-white"
                  : "bg-[#e8e8ea] text-[#3e4949] hover:bg-[#e2e2e5]"
              }`}
            >
              <p className="text-xs font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
                {t(filter.label.bn, filter.label.en)}
              </p>
              {count > 0 && filter.key !== "All" && (
                <span
                  className={`flex items-center justify-center text-[9px] font-bold h-4 px-1 rounded-full ${
                    filter.key === "Low Stock" ? "bg-[#ffdbca]/20 text-[#84451e]" :
                    filter.key === "Out of Stock" ? "bg-[#ffdad6]/20 text-[#ba1a1a]" :
                    "bg-[#ffdad6]/20 text-[#ba1a1a]"
                  }`}
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {formatNumber(count)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content: Stock Grid */}
      <main className="flex-1 px-4 pb-24">
        {/* Empty states */}
        {medicines.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-[#ECFDF5] flex items-center justify-center mb-4">
              <PackageX className="w-10 h-10 text-[#059669]" />
            </div>
            <h3 className="text-lg font-bold text-[#111827] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("ইনভেন্টরি খালি", "Inventory is Empty")}
            </h3>
            <p className="text-sm text-[#6B7280] mb-6 max-w-xs" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("এখনো কোনো ওষুধ যোগ করা হয়নি। নতুন ওষুধ যোগ করুন অথবা CSV ফাইল আমদানি করুন।", "No medicines added yet. Add a new medicine or import a CSV file to get started.")}
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 h-12 px-6 bg-[#059669] text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <Plus className="w-4 h-4" />
              {t("প্রথম ওষুধ যোগ করুন", "Add First Medicine")}
            </button>
          </div>
        )}
        {medicines.length > 0 && filteredMedicines.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-[#F3F4F6] flex items-center justify-center mb-3">
              <PackageX className="w-8 h-8 text-[#9CA3AF]" />
            </div>
            <p className="text-base font-bold text-[#111827] mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কোনো ফলাফল পাওয়া যায়নি", "No results found")}
            </p>
            <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("অন্য কিছু খোঁজার চেষ্টা করুন", "Try a different search or filter")}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          {filteredMedicines.map((med: any) => {
            const iconColor = getMedicineIconColor(med);
            const statusBadge = getStatusBadge(med);
            const stockPercentage = getStockPercentage(med);
            const stockBarColor = getStockBarColor(med);
            const isExpanded = expandedMedicineId === med.id;
            // Create unique key based on name and generic
            const uniqueKey = `${med.name}-${med.generic}`;
            
            return (
              <div 
                key={uniqueKey} 
                className="bg-white rounded-2xl p-4 shadow-sm border border-[#e2e2e5]/5"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconColor.bg} ${iconColor.text}`}>
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {getMedicineIcon(med.type)}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-bold text-[#1a1c1e] text-base" style={{ fontFamily: "var(--font-bangla)" }}>
                        {med.name}
                      </h3>
                      <p className="text-xs text-[#3e4949] font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("জেনেরিক", "Generic")}: {med.generic}
                      </p>
                      <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("প্রস্তুতকারক", "Manufacturer")}: {med.manufacturer || t("তথ্য নেই", "N/A")}
                      </p>
                      {/* Show discount badge if any batch is discounted */}
                      {med.batches.some((b: any) => b.isDiscounted) && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="bg-gradient-to-r from-[#059669] to-[#10b981] text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>sell</span>
                            {t("ছাড়যুক্ত", "Discounted")} {med.batches[0]?.discountPercentage && `${formatNumber(med.batches[0].discountPercentage)}%`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span 
                      className={`${statusBadge.bg} ${statusBadge.text} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider mb-1`}
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t(statusBadge.label.bn, statusBadge.label.en)}
                    </span>
                    <p className="text-[10px] text-[#3e4949] uppercase tracking-widest">
                      {t("থ্রেশহোল্ড", "Threshold")}: {formatNumber(med.threshold)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-[#f3f3f6] rounded-lg p-2">
                    <p className="text-[10px] text-[#3e4949] uppercase font-bold tracking-tighter" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("বর্তমান", "Current")}
                    </p>
                    <p
                      className={`text-lg font-extrabold ${
                        med.totalStock === 0 ? 'text-[#ba1a1a]' :
                        med.totalStock < med.threshold ? 'text-[#84451e]' :
                        'text-[#059669]'
                      }`}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {formatNumber(Number(med.totalStock) || 0)}
                    </p>
                  </div>
                  <div className="bg-[#f3f3f6] rounded-lg p-2">
                    <p className="text-[10px] text-[#3e4949] uppercase font-bold tracking-tighter" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("ব্যাচ সংখ্যা", "Batches")}
                    </p>
                    <p className="text-lg font-extrabold text-[#1a1c1e]" style={{ fontFamily: "var(--font-sans)" }}>
                      {formatNumber(med.batches.length)}
                    </p>
                  </div>
                  <div className="bg-[#f3f3f6] rounded-lg p-2">
                    <p className="text-[10px] text-[#3e4949] uppercase font-bold tracking-tighter" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("মেয়াদ", "Expiry")}
                    </p>
                    <p className="text-sm font-bold text-[#1a1c1e] pt-1" style={{ fontFamily: "var(--font-bangla)" }}>
                      {med.earliestExpiry !== null && med.earliestExpiry !== undefined && !isNaN(med.earliestExpiry)
                        ? t(`${formatNumber(med.earliestExpiry)} দিন`, `${med.earliestExpiry}d`)
                        : "—"
                      }
                    </p>
                  </div>
                </div>

                {/* Mini Heatmap */}
                <div className="w-full h-1.5 bg-[#e8e8ea] rounded-full overflow-hidden mb-4">
                  <div className={`h-full ${stockBarColor}`} style={{ width: `${stockPercentage}%` }}></div>
                </div>

                <div className="flex gap-2">
                  {med.batches.length > 1 && (
                    <button
                      className="flex-1 h-10 rounded-lg bg-[#cfe6f2] text-[#526772] font-bold text-sm transition-colors hover:bg-[#b4cad6]"
                      onClick={() => setExpandedMedicineId(isExpanded ? null : med.id)}
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("ব্যাচ দেখুন", "View Batches")}
                      {isExpanded ? <ChevronUp className="inline w-4 h-4 ml-1" /> : <ChevronDown className="inline w-4 h-4 ml-1" />}
                    </button>
                  )}
                  {(isOwner || hasPermission("inventory_edit")) && (
                    <>
                      <button
                        className="w-10 h-10 rounded-lg bg-[#e8e8ea] text-[#3e4949] flex items-center justify-center hover:bg-[#e2e2e5]"
                        onClick={() => {
                          // Check if multiple batches exist
                          if (med.batches.length > 1) {
                            // Show batch selection modal
                            setBatchSelectMedicine(med);
                            setIsBatchSelectModalOpen(true);
                          } else {
                            // Edit single batch directly — flatten the batch info onto the
                            // medicine record so the modal's flat fields (stock, batchNo,
                            // expiryDate, etc.) prefill correctly for batched-format medicines.
                            const medicineToEdit = medicines.find(m => m.id === med.batches[0]?.id);
                            if (medicineToEdit) {
                              const b = med.batches[0] || {};
                              const sourceBatch =
                                (medicineToEdit as any).batches?.find((x: any) => x.batchNo === b.batchNo) || b;
                              setEditingMedicine({
                                ...medicineToEdit,
                                batchNo: sourceBatch.batchNo ?? (medicineToEdit as any).batchNo,
                                expiryDate: sourceBatch.expiryDate ?? (medicineToEdit as any).expiryDate,
                                stock: sourceBatch.stock ?? (medicineToEdit as any).stock,
                                purchasePrice: sourceBatch.purchasePrice ?? (medicineToEdit as any).purchasePrice,
                                salePrice: sourceBatch.salePrice ?? (medicineToEdit as any).salePrice,
                                expiry: expiryDaysFromDate(sourceBatch.expiryDate ?? (medicineToEdit as any).expiryDate),
                                __editingBatchNo: sourceBatch.batchNo,
                              });
                              setIsEditModalOpen(true);
                            }
                          }
                        }}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        className="w-10 h-10 rounded-lg bg-[#e8e8ea] text-[#3e4949] flex items-center justify-center hover:bg-[#e2e2e5]"
                        onClick={() => {
                          // Delete all batches of this grouped medicine
                          const batchIds = med.batches.map((b: any) => b.id);
                          const updatedMedicines = medicines.filter((m: any) => !batchIds.includes(m.id));
                          setMedicines(updatedMedicines);

                          // No "default" medicines anymore — simply remove the record.
                          // P0 FIX: Write audit log for delete action
                          addLog({
                            action: "delete",
                            staffId: staff?.id.toString() || "unknown",
                            staffName: staff?.name || "Unknown",
                            reference: med.name,
                            notes: `Deleted ${med.batches.length} batch(es) of ${med.name}`
                          });

                          // Save ALL medicines to localStorage
                          saveMedicines(updatedMedicines);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>

                {/* Expandable Batch Details */}
                {isExpanded && med.batches.length > 1 && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-[#bdc9c8]/30">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#e8e8ea] text-[#3e4949] uppercase font-bold tracking-tight">
                        <tr>
                          <th className="px-3 py-2" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("ব্যাচ নং", "Batch No")}
                          </th>
                          <th className="px-3 py-2" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("মেয়াদ", "Expiry")}
                          </th>
                          <th className="px-3 py-2" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("পরিমাণ", "Qty")}
                          </th>
                          <th className="px-3 py-2" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("মূল্য", "Price")}
                          </th>
                          <th className="px-3 py-2" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("এডিট", "Edit")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#bdc9c8]/20 bg-white">
                        {sortBatchesFEFO(med.batches as any[]).map((batch: any, batchIndex: number) => {
                            const isActiveBatch = batchIndex === 0; // First batch (earliest expiry) is active
                            return (
                              <tr 
                                key={`${med.id}-${batch.id}-${batchIndex}`} 
                                className={`hover:bg-[#f3f3f6] transition-colors ${
                                  isActiveBatch ? 'bg-[#ECFDF5]/50' : ''
                                }`}
                              >
                                <td className="px-3 py-3 font-bold text-[#1a1c1e]" style={{ fontFamily: "var(--font-sans)" }}>
                                  <div className="flex items-center gap-1.5">
                                    #{batch.batchNo}
                                    {isActiveBatch && (
                                      <span 
                                        className="bg-[#059669] text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase"
                                        style={{ fontFamily: "var(--font-bangla)" }}
                                      >
                                        {t("সক্রিয়", "Active")}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className={`px-3 py-3 font-medium ${
                                  batch.expiry !== null && batch.expiry < 60 
                                    ? 'text-[#ba1a1a]' 
                                    : 'text-[#3e4949]'
                                }`}>
                                  {batch.expiryDate || "N/A"}
                                  {batch.expiry !== null && batch.expiry !== undefined && (
                                    <span className="text-[10px] ml-1">({t(`${formatNumber(batch.expiry)} দিন`, `${batch.expiry}d`)})</span>
                                  )}
                                </td>
                                <td className="px-3 py-3 font-bold text-[#1a1c1e]" style={{ fontFamily: "var(--font-sans)" }}>
                                  {formatNumber(batch.stock)}
                                </td>
                                <td className="px-3 py-3 text-[#1a1c1e]" style={{ fontFamily: "var(--font-money)" }}>
                                  ৳{formatNumber(batch.salePrice)}
                                </td>
                                <td className="px-3 py-3">
                                  {(isOwner || hasPermission("inventory_edit")) && (
                                    <button
                                      type="button"
                                      onPointerDown={(e) => {
                                        e.preventDefault();
                                        setEditingBatch({
                                          ...batch,
                                          __medicineId: batch.id,
                                          __originalBatchNo: batch.batchNo,
                                        });
                                        setEditingBatchMedicineName(med.name);
                                        setIsEditBatchModalOpen(true);
                                      }}
                                      className="p-1.5 hover:bg-[#ECFDF5] rounded-lg text-[#059669] transition-colors"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        }
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Add Medicine Modal */}
      <AddMedicineModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddMedicine={(newMedicine) => {
          const updatedMedicines = [...medicines, newMedicine];
          setMedicines(updatedMedicines);

          // P0 FIX: Write audit log for stock addition
          addLog({
            action: "stock",
            staffId: staff?.id.toString() || "unknown",
            staffName: staff?.name || "Unknown",
            reference: newMedicine.name,
            notes: `Added new medicine`,
            after: {
              stock: newMedicine.batches?.[0]?.stock || 0,
              batchNo: newMedicine.batches?.[0]?.batchNo,
              purchasePrice: newMedicine.batches?.[0]?.purchasePrice,
              salePrice: newMedicine.batches?.[0]?.salePrice
            }
          });

          // Save ALL medicines to localStorage
          saveMedicines(updatedMedicines);
        }}
      />
      
      {/* Edit Medicine Modal */}
      <EditMedicineModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onUpdateMedicine={(updatedMedicine: any) => {
          // Trust the modal: it already folded the form fields into the right
          // entry of `batches[]` using __editingBatchNo. Just swap the row.
          const targetBatchNo =
            (editingMedicine as any)?.__editingBatchNo ?? (updatedMedicine as any).__editingBatchNo;
          const originalMedicine = medicines.find((m: any) => m.id === updatedMedicine.id);
          const originalBatch = originalMedicine?.batches?.find((b: any) => b.batchNo === targetBatchNo);
          const newBatch = Array.isArray(updatedMedicine.batches)
            ? updatedMedicine.batches.find((b: any) => b.batchNo === (updatedMedicine.batchNo ?? targetBatchNo))
              ?? updatedMedicine.batches[0]
            : null;

          const updatedMedicines = medicines.map((m: any) =>
            m.id === updatedMedicine.id
              ? { ...m, ...updatedMedicine, batches: updatedMedicine.batches ?? m.batches }
              : m
          );

          if (originalBatch && newBatch) {
            addLog({
              action: "stock",
              staffId: staff?.id.toString() || "unknown",
              staffName: staff?.name || "Unknown",
              reference: updatedMedicine.name,
              notes: `Edited medicine details`,
              before: {
                stock: originalBatch.stock,
                batchNo: originalBatch.batchNo,
                expiryDate: originalBatch.expiryDate,
                purchasePrice: originalBatch.purchasePrice,
                salePrice: originalBatch.salePrice,
              },
              after: {
                stock: newBatch.stock,
                batchNo: newBatch.batchNo,
                expiryDate: newBatch.expiryDate,
                purchasePrice: newBatch.purchasePrice,
                salePrice: newBatch.salePrice,
              },
            });
          }

          saveMedicines(updatedMedicines);
          setMedicines(getMedicines());
        }}
        medicine={editingMedicine}
      />
      
      {/* Edit Batch Modal */}
      <EditBatchModal
        isOpen={isEditBatchModalOpen}
        onClose={() => {
          setIsEditBatchModalOpen(false);
          setEditingBatch(null);
        }}
        onUpdateBatch={(updatedBatch) => {
          const medId = editingBatch?.__medicineId;
          const origBatchNo = editingBatch?.__originalBatchNo;
          const originalMedicine = medicines.find((m: any) => m.id === medId);
          const originalBatch = originalMedicine?.batches?.find((b: any) => b.batchNo === origBatchNo);

          const updatedMedicines = medicines.map((med: any) => {
            if (med.id !== medId) return med;
            if (!Array.isArray(med.batches)) return med;
            return {
              ...med,
              batches: med.batches.map((b: any) =>
                b.batchNo === origBatchNo
                  ? {
                      ...b,
                      batchNo: updatedBatch.batchNo,
                      expiryDate: updatedBatch.expiryDate,
                      stock: Number(updatedBatch.stock),
                      purchasePrice: Number(updatedBatch.purchasePrice),
                      salePrice: Number(updatedBatch.salePrice),
                    }
                  : b
              ),
            };
          });

          if (originalBatch) {
            addLog({
              action: "stock",
              staffId: staff?.id.toString() || "unknown",
              staffName: staff?.name || "Unknown",
              reference: `${editingBatchMedicineName} (${updatedBatch.batchNo})`,
              notes: `Edited batch details`,
              before: {
                batchNo: originalBatch.batchNo,
                stock: originalBatch.stock,
                expiryDate: originalBatch.expiryDate,
                purchasePrice: originalBatch.purchasePrice,
                salePrice: originalBatch.salePrice,
              },
              after: {
                batchNo: updatedBatch.batchNo,
                stock: Number(updatedBatch.stock),
                expiryDate: updatedBatch.expiryDate,
                purchasePrice: Number(updatedBatch.purchasePrice),
                salePrice: Number(updatedBatch.salePrice),
              },
            });
          }

          saveMedicines(updatedMedicines);
          setMedicines(getMedicines());
          setIsEditBatchModalOpen(false);
          setEditingBatch(null);
        }}
        batch={editingBatch}
        medicineName={editingBatchMedicineName}
      />

      {/* Batch Selection Modal */}
      {isBatchSelectModalOpen && batchSelectMedicine && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3
                  className="text-lg font-bold text-[#059669]"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("ব্যাচ নির্বাচন করুন", "Select Batch to Edit")}
                </h3>
                <p className="text-sm text-gray-600 mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                  {batchSelectMedicine.name}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsBatchSelectModalOpen(false);
                  setBatchSelectMedicine(null);
                }}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Batch List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {batchSelectMedicine.batches.map((batch: any, index: number) => (
                <button
                  key={`${batch.id}-${index}`}
                  onClick={() => {
                    setEditingBatch(batch);
                    setEditingBatchMedicineName(batchSelectMedicine.name);
                    setIsEditBatchModalOpen(true);
                    setIsBatchSelectModalOpen(false);
                    setBatchSelectMedicine(null);
                  }}
                  className="w-full p-4 bg-gray-50 hover:bg-[#ECFDF5] rounded-xl transition-colors border-2 border-transparent hover:border-[#059669] text-left"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p
                        className="text-sm font-bold text-gray-900"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {t("ব্যাচ", "Batch")} #{batch.batchNo}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5" style={{ fontFamily: "var(--font-sans)" }}>
                        {t("মেয়াদ", "Expires")}: {batch.expiryDate || "N/A"}
                        {batch.expiry !== null && batch.expiry !== undefined && (
                          <span className={`ml-1 ${batch.expiry < 60 ? 'text-[#ba1a1a] font-bold' : ''}`}>
                            ({batch.expiry}d)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("স্টক", "Stock")}
                      </p>
                      <p className="text-lg font-bold text-[#059669]" style={{ fontFamily: "var(--font-sans)" }}>
                        {formatNumber(batch.stock)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-600" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("ক্রয়", "Purchase")}:
                      </span>
                      <span className="ml-1 font-semibold" style={{ fontFamily: "var(--font-money)" }}>৳{batch.purchasePrice?.toFixed(2) || "0.00"}</span>
                    </div>
                    <div>
                      <span className="text-gray-600" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("বিক্রয়", "Sale")}:
                      </span>
                      <span className="ml-1 font-semibold" style={{ fontFamily: "var(--font-money)" }}>৳{batch.salePrice?.toFixed(2) || "0.00"}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-600 text-center" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("সম্পাদনা করার জন্য একটি ব্যাচ নির্বাচন করুন", "Select a batch to edit")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}