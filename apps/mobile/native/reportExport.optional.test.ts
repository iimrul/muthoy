import { describe, expect, it, vi } from 'vitest';

const sharing = vi.hoisted(() => ({ loads: 0 }));

vi.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  FileMode: { Truncate: 'wt' },
  Paths: { cache: 'cache' },
}));

vi.mock('expo-sharing', () => {
  sharing.loads += 1;
  throw new Error("Cannot find native module 'ExpoSharing'");
});

describe('optional sharing capability', () => {
  it('does not collapse route imports when the installed client lacks ExpoSharing', async () => {
    const reportExport = await import('./reportExport');

    expect(reportExport.writeReportExport).toBeTypeOf('function');
    expect(sharing.loads).toBe(0);
    await expect(reportExport.shareWrittenExport({
      uri: 'file:///cache/report.csv',
      filename: 'report.csv',
      size: 1,
    })).rejects.toThrow();
    expect(sharing.loads).toBe(1);
  });
});
