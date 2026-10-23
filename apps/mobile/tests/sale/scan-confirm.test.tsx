// @vitest-environment jsdom
//
// W2-01 section 6.2.3 — the confirmation gate on the sale scan.
//
// An exact OCR match used to go straight into the cart. A cart line is the
// first step of a money path, and the founder's own recovery note for this
// feature is "a misread got saved without confirmation — add the confirmation
// step back, it must never be skippable". So the property under test is
// negative and absolute: the cart does not change until somebody presses
// Confirm.
//
// app/scan.tsx is driven for real here, with the real cart store, the real
// ScanConfirmSheet and the real OCR matching — only the camera, the database
// and the permission check are doubled. app/(tabs)/sale.tsx carries the same
// gate and has no render harness in this repo, so it is asserted at source
// level the way tests/localization-and-ui-consistency.test.ts does; the
// mutation checks recorded in the commit prove both assertions bite.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SHOP_ID = '7c5e1a20-0000-4000-8000-000000000001';
const MEDICINE_ID = '7c5e1a20-0000-4000-8000-000000000004';
const BATCH_ID = '7c5e1a20-0000-4000-8000-000000000005';

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  visible?: boolean;
}

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  KeyboardAvoidingView: ({ children }: StubProps) => createElement('div', null, children),
  Modal: ({ children, visible }: StubProps) =>
    visible === false ? null : createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel, testID }: StubProps) =>
    createElement(
      'button',
      { onClick: onPress, 'aria-label': accessibilityLabel, 'data-testid': testID },
      children,
    ),
}));

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }));
vi.mock('expo-router', () => ({ router: routerMock }));

vi.mock('../../components/ui/StandardHeader', () => ({
  StandardHeader: ({ title }: { title: string }) => createElement('h1', null, title),
}));

// The scanner stands in for camera + ML Kit: one button that delivers the text
// a successful capture would have produced.
vi.mock('../../components/scanner/MedicineTextScanner', () => ({
  MedicineTextScanner: ({
    onTextRecognized,
  }: {
    onTextRecognized: (text: string) => void | Promise<void>;
  }) =>
    createElement(
      'button',
      {
        'aria-label': 'fire-ocr',
        onClick: () => void onTextRecognized('Napa Extra'),
      },
      'fire-ocr',
    ),
}));

const deps = vi.hoisted(() => ({
  searchMedicinesForSale: vi.fn(),
  requirePermission: vi.fn(),
}));
vi.mock('../../db/sales', () => ({
  searchMedicinesForSale: deps.searchMedicinesForSale,
}));
vi.mock('../../db/auth', () => ({ requirePermission: deps.requirePermission }));

const { useLocaleStore } = await import('../../state/localeStore');
const { useSessionStore } = await import('../../state/sessionStore');
type Session = import('../../state/sessionStore').Session;
const { useCartStore } = await import('../../state/cartStore');
const { asPaisa } = await import('@muthoy/types');
const ScanSaleScreen = (await import('../../app/scan')).default;

const OWNER: Session = {
  shopId: SHOP_ID,
  userId: '7c5e1a20-0000-4000-8000-000000000002',
  role: 'owner',
};

/** One result whose name matches the scanned text exactly — the auto-add case. */
const EXACT_MATCH = {
  medicineId: MEDICINE_ID,
  name: 'Napa Extra',
  generic: 'Paracetamol + Caffeine',
  manufacturer: 'Beximco',
  requiresPrescription: false,
  activeBatch: {
    id: BATCH_ID,
    medicineId: MEDICINE_ID,
    quantityAvailable: 10,
    salePrice: asPaisa(1200),
    expiryDate: '2099-01-01',
  },
  activeBatchNo: 'B-2401',
  promotionBps: 0,
  originalUnitPrice: asPaisa(1200),
};

function cartLines(): number {
  return useCartStore.getState().items.length;
}

async function scan(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByLabelText('fire-ocr'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.getState().setLocale('en');
  useSessionStore.setState({ session: OWNER });
  useCartStore.setState({ items: [] });
  deps.requirePermission.mockResolvedValue(undefined);
  deps.searchMedicinesForSale.mockResolvedValue([EXACT_MATCH]);
});

afterEach(() => cleanup());

describe('a scanned exact match waits for confirmation', () => {
  it('puts nothing in the cart when OCR finds an exact single match', async () => {
    render(createElement(ScanSaleScreen));
    await scan();

    // The whole point: an exact match is now a proposal, not a cart line.
    expect(await screen.findByText('Confirm scanned medicine')).toBeTruthy();
    expect(cartLines()).toBe(0);
  });

  it('shows what was read, what it matched, the batch, the expiry and the price', async () => {
    render(createElement(ScanSaleScreen));
    await scan();

    expect(await screen.findByText('Scanned text')).toBeTruthy();
    expect(screen.getByText('Paracetamol + Caffeine • Beximco')).toBeTruthy();
    expect(screen.getByText('B-2401')).toBeTruthy();
    expect(screen.getByText('৳12.00')).toBeTruthy();
  });

  it('adds exactly one line when Confirm is pressed', async () => {
    render(createElement(ScanSaleScreen));
    await scan();

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Add to cart'));
    });

    expect(cartLines()).toBe(1);
    // EVERY field, not a sample. The four-field version of this assertion could
    // not see that this screen dropped generic, manufacturer,
    // requiresPrescription, batchNo, expiryDate and availableQuantity — and the
    // last two of those are the prescription warning and the stock ceiling.
    expect(useCartStore.getState().items[0]).toMatchObject({
      medicineId: MEDICINE_ID,
      medicineName: 'Napa Extra',
      generic: 'Paracetamol + Caffeine',
      manufacturer: 'Beximco',
      requiresPrescription: false,
      batchId: BATCH_ID,
      batchNo: 'B-2401',
      expiryDate: '2099-01-01',
      availableQuantity: 10,
      quantity: 1,
      unitPrice: 1200,
    });
    // The sheet closes, so a second confirm is impossible without a new scan.
    expect(screen.queryByText('Confirm scanned medicine')).toBeNull();
  });

  it('adds nothing when Discard is pressed', async () => {
    render(createElement(ScanSaleScreen));
    await scan();

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Discard'));
    });

    expect(cartLines()).toBe(0);
    expect(screen.queryByText('Confirm scanned medicine')).toBeNull();
  });

  it('adds nothing when Edit hands the scan to the manual search', async () => {
    render(createElement(ScanSaleScreen));
    await scan();

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Edit and search'));
    });

    expect(cartLines()).toBe(0);
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/sale',
      params: { q: 'Napa Extra' },
    });
  });

  it('cannot be resolved by a tap outside the panel', async () => {
    render(createElement(ScanSaleScreen));
    await scan();
    await screen.findByText('Confirm scanned medicine');

    // BaseModal only renders its backdrop Pressable when dismissOnBackdropPress
    // is set. There must be no accidental-dismiss gesture on a confirmation.
    expect(screen.queryByTestId('modal-backdrop')).toBeNull();
    expect(cartLines()).toBe(0);
  });

  it('still reports a miss instead of opening an empty confirmation', async () => {
    deps.searchMedicinesForSale.mockResolvedValue([]);
    render(createElement(ScanSaleScreen));
    await scan();

    await waitFor(() =>
      expect(screen.getByText('No exact medicine match. Search manually.')).toBeTruthy(),
    );
    expect(screen.queryByText('Confirm scanned medicine')).toBeNull();
    expect(cartLines()).toBe(0);
  });
});

// The Sale tab's own scanner had the identical auto-add — plan section 6.2.3
// named only app/scan.tsx, but "never skippable" cannot hold while the busier
// path still commits on a misread. It has no render harness here, so the gate
// is pinned at source level.
describe('the Sale tab scanner carries the same gate', () => {
  /** Comments out, so prose naming a function cannot satisfy or break a check. */
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const source = code(
    readFileSync(resolve(process.cwd(), 'apps/mobile/app/(tabs)/sale.tsx'), 'utf8'),
  );
  const scanHandler = source.slice(
    source.indexOf('const handleScanResult'),
    source.indexOf('const confirmPendingScan'),
  );

  it('proposes the exact match instead of adding it', () => {
    expect(scanHandler).toContain('setPendingScan({');
    // The call, not the name: a trailing paren cannot appear in prose.
    expect(scanHandler).not.toContain('addLineAndReport(');
  });

  it('reaches the cart only from the confirmation callback', () => {
    expect(source).toContain('onConfirm={confirmPendingScan}');
    const confirmCallback = source.slice(
      source.indexOf('const confirmPendingScan'),
      source.indexOf('const addBarcodeCandidate'),
    );
    expect(confirmCallback).toContain('addLineAndReport({');
  });

  it('does not let a tap outside the panel resolve the confirmation', () => {
    const sheet = readFileSync(
      resolve(process.cwd(), 'apps/mobile/components/scanner/ScanConfirmSheet.tsx'),
      'utf8',
    );
    expect(sheet).toContain('dismissOnBackdropPress={false}');
    expect(sheet).toContain('onClose={onDiscard}');
  });
});

describe('a confirmed scan that the cart REFUSES', () => {
  // R1b from the delta review: nothing drove addItem() to return false, so
  // removing the stock-limit handling left the suite green — and this screen
  // would then have told the seller a line existed that did not.
  it('reports the stock limit and adds nothing when the cart is already at it', async () => {
    // The batch has 10 available and the cart already holds all 10.
    useCartStore.getState().addItem({
      medicineId: MEDICINE_ID,
      medicineName: 'Napa Extra',
      batchId: BATCH_ID,
      quantity: 10,
      unitPrice: asPaisa(1200),
      availableQuantity: 10,
    });

    render(createElement(ScanSaleScreen));
    await scan();

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Add to cart'));
    });

    // One line, still at 10: the refusal did not quietly become an 11th unit.
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]?.quantity).toBe(10);
    expect(screen.getByText('Cart quantity is already at available stock.')).toBeTruthy();
  });
});
