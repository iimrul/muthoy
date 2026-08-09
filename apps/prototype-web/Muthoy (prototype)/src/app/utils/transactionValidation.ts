import { shopStorage } from "./shopStorage";
/**
 * Transaction Validation Utilities (P2)
 * Invariant gate for all transaction writes to ensure data integrity
 */

export interface TransactionItem {
  id: number;
  name: string;
  quantity: number;
  price: number;
  total: number;
  cogsLines?: Array<{
    batchNo: string;
    qty: number;
    purchasePrice: number;
  }>;
  cogs?: number;
}

export interface Transaction {
  id: number;
  date: string;
  timestamp: string;
  staffName: string;
  staffId?: number;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: "cash" | "credit" | "split";
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  items: TransactionItem[];
  cogs?: number;
  isCreditSale?: boolean;
  isPartialPayment?: boolean;
  partialPaidAmount?: number;
  partialRemainingAmount?: number;
  isRefunded?: boolean;
  isDeleted?: boolean;
  status?: "confirmed" | "hold" | "cancelled";
}

export class TransactionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionValidationError";
  }
}

/**
 * Validates a transaction before saving
 * Throws TransactionValidationError if validation fails
 */
export function assertTxnValid(txn: Transaction): void {
  // Basic required fields
  if (!txn.id) {
    throw new TransactionValidationError("Transaction ID is required");
  }

  if (!txn.date || !/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
    throw new TransactionValidationError("Valid date (YYYY-MM-DD) is required");
  }

  if (!txn.timestamp) {
    throw new TransactionValidationError("Timestamp is required");
  }

  if (!txn.staffName) {
    throw new TransactionValidationError("Staff name is required");
  }

  // Validate items
  if (!txn.items || !Array.isArray(txn.items) || txn.items.length === 0) {
    throw new TransactionValidationError("Transaction must have at least one item");
  }

  for (const item of txn.items) {
    if (!item.id || !item.name || !item.quantity || !item.price) {
      throw new TransactionValidationError(
        `Invalid item: ${JSON.stringify(item)}`
      );
    }

    if (item.quantity <= 0) {
      throw new TransactionValidationError(
        `Item quantity must be positive: ${item.name}`
      );
    }

    if (item.price < 0) {
      throw new TransactionValidationError(
        `Item price cannot be negative: ${item.name}`
      );
    }

    // P2: Validate COGS lines if present
    if (item.cogsLines) {
      if (!Array.isArray(item.cogsLines)) {
        throw new TransactionValidationError(
          `cogsLines must be an array: ${item.name}`
        );
      }

      for (const cogsLine of item.cogsLines) {
        if (!cogsLine.batchNo || cogsLine.qty <= 0 || cogsLine.purchasePrice < 0) {
          throw new TransactionValidationError(
            `Invalid COGS line: ${JSON.stringify(cogsLine)} for item ${item.name}`
          );
        }
      }
    }
  }

  // Validate financial fields
  if (txn.subtotal < 0) {
    throw new TransactionValidationError("Subtotal cannot be negative");
  }

  if (txn.discount < 0) {
    throw new TransactionValidationError("Discount cannot be negative");
  }

  if (txn.total < 0) {
    throw new TransactionValidationError("Total cannot be negative");
  }

  // P2: Validate customerId for credit/split transactions
  if (
    (txn.paymentMethod === "credit" || txn.paymentMethod === "split") &&
    !txn.customerId
  ) {
    throw new TransactionValidationError(
      "customerId is required for credit and split payment transactions"
    );
  }

  // Validate split payment fields
  if (txn.paymentMethod === "split") {
    if (
      txn.partialPaidAmount === undefined ||
      txn.partialRemainingAmount === undefined
    ) {
      throw new TransactionValidationError(
        "Split payment requires partialPaidAmount and partialRemainingAmount"
      );
    }

    if (txn.partialPaidAmount < 0 || txn.partialRemainingAmount < 0) {
      throw new TransactionValidationError(
        "Split payment amounts cannot be negative"
      );
    }

    if (Math.abs((txn.partialPaidAmount + txn.partialRemainingAmount) - txn.total) > 0.01) {
      throw new TransactionValidationError(
        "Split payment amounts must sum to total"
      );
    }
  }

  // Validate COGS consistency
  if (txn.cogs !== undefined) {
    const calculatedCOGS = txn.items.reduce((sum, item) => sum + (item.cogs || 0), 0);
    if (Math.abs(calculatedCOGS - txn.cogs) > 0.01) {
      throw new TransactionValidationError(
        `Transaction COGS (${txn.cogs}) does not match sum of item COGS (${calculatedCOGS})`
      );
    }
  }
}

/**
 * Validates and saves transactions to localStorage
 */
export function saveTxn(txn: Transaction): void {
  assertTxnValid(txn);

  const stored = shopStorage.getItem("transactions");
  const transactions = stored ? JSON.parse(stored) : [];

  transactions.push(txn);
  shopStorage.setItem("transactions", JSON.stringify(transactions));
}

/**
 * Validates and updates a transaction in localStorage
 */
export function updateTxn(txnId: number, updates: Partial<Transaction>): void {
  const stored = shopStorage.getItem("transactions");
  const transactions = stored ? JSON.parse(stored) : [];

  const index = transactions.findIndex((t: Transaction) => t.id === txnId);
  if (index === -1) {
    throw new TransactionValidationError(`Transaction ${txnId} not found`);
  }

  const updatedTxn = { ...transactions[index], ...updates };
  assertTxnValid(updatedTxn);

  transactions[index] = updatedTxn;
  shopStorage.setItem("transactions", JSON.stringify(transactions));
}
