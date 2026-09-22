// Non-dev resolver target. It grants no capability and imports nothing.

export function DevAuthorityRecovery(_props: {
  shopId: string;
  ownerUserId: string;
  onRecovered: () => void;
}) {
  return null;
}
