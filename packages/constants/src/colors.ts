import tokens from './tokens/colors.json';

// Brand color tokens — single source of truth. Values extracted from
// apps/prototype-web's theme.css; only the VALUES transfer, never its CSS.
export const colors = tokens;
export type ColorToken = keyof typeof colors;
