import { Share } from 'react-native';

/** Native transport only; report callers authorize through services/reportExport. */
export async function shareReportText(message: string): Promise<void> {
  await Share.share({ message });
}
