let idSequence = 0;

export function randomUUID(): string {
  return `00000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`;
}

export function getRandomBytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(7);
}