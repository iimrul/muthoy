// Loads the REAL modules under test from the selected checkout.
// HW_TARGET_ROOT is always set by vitest.hardware.config.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const TARGET_ROOT = resolve(process.env.HW_TARGET_ROOT ?? process.cwd());

function absolute(relativePath: string): string {
  return resolve(TARGET_ROOT, relativePath).replace(/\\/g, "/");
}

export async function loadTarget<T>(relativePath: string): Promise<T> {
  return (await import(/* @vite-ignore */ absolute(relativePath))) as T;
}

export function targetSource(relativePath: string): string {
  return readFileSync(absolute(relativePath), "utf8");
}

/**
 * The uncommitted working tree adds an iOS branch to native/printer.ts
 * (`Platform.OS === 'ios'` returns before the Android permission request).
 * The a23ca61 baseline refuses every non-Android platform instead.
 */
export const TARGET_PRINTER_HAS_IOS_PATH = targetSource("apps/mobile/native/printer.ts").includes(
  "Platform.OS === 'ios'",
);

export type PrinterModule = typeof import("../../../native/printer");
export type EscPosModule = typeof import("../../../domain/escpos");
export type OcrTextModule = typeof import("../../../domain/ocrText");
export type OcrDateModule = typeof import("../../../domain/ocrDateNormalizer");
export type PrescriptionModule = typeof import("../../../domain/prescriptionLines");
export type MedicineMatchModule = typeof import("../../../domain/medicineMatch");
export type CameraPermissionModule = typeof import("../../../domain/cameraPermissionState");
export type ExportModule = typeof import("../../../domain/export");
