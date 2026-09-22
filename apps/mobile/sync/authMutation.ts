// Serialises mutations/refreshes of Supabase's single device credential.
// Session epochs protect local Zustand state; they cannot stop an outgoing
// signOut from deleting a newly written refresh token. This lock closes that
// separate shared-storage race.
let tail: Promise<void> = Promise.resolve();

export async function withAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
