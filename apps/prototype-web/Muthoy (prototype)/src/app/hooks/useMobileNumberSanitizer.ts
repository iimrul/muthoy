import { useCallback } from "react";
import { sanitizeMobileNumber as sanitizeMobile } from "../utils/mobileNumber";

/**
 * Global Mobile Number Sanitizer Hook
 * 
 * Removes leading zero from Bangladeshi mobile numbers
 * - User types: "01822240603" (11 digits with leading 0)
 * - System stores: "1822240603" (10 digits without leading 0)
 * 
 * Usage:
 * const { sanitizeMobile, handleMobileBlur } = useMobileNumberSanitizer(value, setValue);
 */
export function useMobileNumberSanitizer(
  value: string,
  setValue: (value: string) => void
) {
  /**
   * Sanitizes mobile number by removing leading zero
   * @param mobile - The mobile number string
   * @returns Sanitized mobile number without leading zero
   */
  const sanitizeMobileNumber = useCallback((mobile: string): string => {
    return sanitizeMobile(mobile);
  }, []);

  /**
   * Handles blur event - automatically sanitizes the input value
   * Updates the field silently without any toast/alert
   */
  const handleMobileBlur = useCallback(() => {
    const sanitized = sanitizeMobile(value);
    if (sanitized !== value) {
      setValue(sanitized);
    }
  }, [value, setValue]);

  return {
    sanitizeMobile: sanitizeMobileNumber,
    handleMobileBlur,
  };
}

/**
 * Standalone sanitize function for direct use
 * @param mobile - The mobile number string
 * @returns Sanitized mobile number without leading zero
 */
export { sanitizeMobileNumber } from "../utils/mobileNumber";