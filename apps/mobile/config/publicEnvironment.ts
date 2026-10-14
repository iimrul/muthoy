// Literal member expressions are required for Expo transform-time inlining.
export const publicEnvironment = Object.freeze({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '',
  publicKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '',
});
