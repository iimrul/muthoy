/**
 * Mobile Number Utilities for Bangladesh Phone Numbers
 * 
 * Consistent approach:
 * - Users CAN type with or without leading '0' (natural UX)
 * - System ALWAYS stores WITHOUT leading '0' (1XXXXXXXXX format - 10 digits)
 * - Display shows +880 1XXXXXXXXX
 */

/**
 * Sanitizes mobile number by removing leading zero
 * @param mobile - Raw mobile number input
 * @returns Sanitized mobile number (10 digits, no leading zero)
 */
export function sanitizeMobileNumber(mobile: string): string {
  const trimmed = mobile.trim();
  // Remove leading zero if present
  if (trimmed.startsWith("0")) {
    return trimmed.substring(1);
  }
  return trimmed;
}

/**
 * Validates Bangladesh mobile number
 * Accepts: 1XXXXXXXXX (10 digits) or 01XXXXXXXXX (11 digits with leading 0)
 * First digit after optional 0 must be 1, second digit must be 3-9
 * @param mobile - Mobile number to validate
 * @returns true if valid
 */
export function validateMobileNumber(mobile: string): boolean {
  const trimmed = mobile.trim();
  
  // Accept both formats: 1XXXXXXXXX (10 digits) or 01XXXXXXXXX (11 digits)
  // After optional 0, must start with 1[3-9]
  return /^(0)?1[3-9]\d{8}$/.test(trimmed);
}

/**
 * Formats mobile number for storage
 * Always returns 10-digit format (1XXXXXXXXX)
 * @param mobile - Raw mobile number
 * @returns Formatted mobile number for storage
 */
export function formatMobileForStorage(mobile: string): string {
  return sanitizeMobileNumber(mobile);
}

/**
 * Formats mobile number for display
 * @param mobile - Stored mobile number (10 digits)
 * @returns Formatted for display (e.g., "1822 240603")
 */
export function formatMobileForDisplay(mobile: string): string {
  const sanitized = sanitizeMobileNumber(mobile);
  if (sanitized.length === 10) {
    return `${sanitized.slice(0, 4)} ${sanitized.slice(4)}`;
  }
  return sanitized;
}

/**
 * Gets full international format
 * @param mobile - Stored mobile number (10 digits)
 * @returns Full format (e.g., "+880 1822 240603")
 */
export function getInternationalFormat(mobile: string): string {
  const sanitized = sanitizeMobileNumber(mobile);
  return `+880 ${formatMobileForDisplay(sanitized)}`;
}
