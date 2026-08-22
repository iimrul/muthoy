const REFUND_NAMESPACE = '4f93ae4e-b093-5f69-89af-2e176f45ed51';

function uuidBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Invalid UUID: ${uuid}`);
  return Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function sha1(bytes: number[]): number[] {
  const message = [...bytes, 0x80];
  while (message.length % 64 !== 56) message.push(0);
  const bitLength = BigInt(bytes.length) * 8n;
  for (let shift = 56n; shift >= 0n; shift -= 8n) message.push(Number((bitLength >> shift) & 0xffn));
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  for (let offset = 0; offset < message.length; offset += 64) {
    const words = new Array<number>(80);
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      words[i] = ((message[at]! << 24) | (message[at + 1]! << 16) | (message[at + 2]! << 8) | message[at + 3]!) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      const value = words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!;
      words[i] = ((value << 1) | (value >>> 31)) >>> 0;
    }
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i += 1) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const rotated = ((a << 5) | (a >>> 27)) >>> 0;
      [a, b, c, d, e] = [((rotated + f + e + k + words[i]!) >>> 0), a, ((b << 30) | (b >>> 2)) >>> 0, c, d];
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].flatMap((word) => [word >>> 24, word >>> 16, word >>> 8, word].map((part) => part & 0xff));
}

export function uuidV5(namespace: string, name: string): string {
  const hash = sha1([...uuidBytes(namespace), ...new TextEncoder().encode(name)]).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function refundOperationId(shopId: string, saleId: string): string {
  return uuidV5(REFUND_NAMESPACE, `${shopId}:${saleId}`);
}

export function refundChildId(operationId: string, effect: string): string {
  return uuidV5(operationId, effect);
}
