/**
 * M11 Unit 4: UUID v7 generator (RFC 9562 §5.7).
 *
 * Hand-rolled to avoid a new npm dependency (see plan D7). Uses
 * `crypto.getRandomValues` which is available in Node 18+ and every
 * modern browser. Emits a standard 36-char hyphenated lowercase
 * string.
 *
 * Layout (128 bits):
 *
 *   bits      0-47:  48-bit Unix millisecond timestamp (big-endian)
 *   bits     48-51:  4-bit version nibble, always 0b0111 = 7
 *   bits     52-63:  12-bit random
 *   bits     64-65:  2-bit variant, always 0b10 (RFC 4122 variant)
 *   bits     66-127: 62-bit random
 *
 * Why v7 vs v4:
 *   - The 48-bit timestamp prefix gives natural lexicographic ordering
 *     by creation time. Firestore doc IDs sorted ascending become
 *     chronological. Useful for the M12 gallery "newest first" query
 *     without needing the createdAt composite index for paging.
 *   - Two UUIDs minted in the same millisecond still differ in their
 *     74 bits of randomness — practical collision space 2^74 ≈ 10^22.
 *
 * Pure module. Importable from client + server.
 */

export function generateUuidV7(): string {
  // 48-bit Unix millis. Date.now() is millisecond-precise.
  const ms = BigInt(Date.now());

  // 10 bytes of random for the rest of the UUID. We only use 76 of
  // those bits (12 after timestamp + 62 after variant + 2 variant);
  // 2 bits are overwritten by the variant and 4 by the version.
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);

  // 16 bytes total.
  const bytes = new Uint8Array(16);
  // Bytes 0-5: high 48 bits of timestamp.
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // Bytes 6-7: version nibble + 12-bit random.
  bytes[6] = (rand[0] & 0x0f) | 0x70; // top nibble = 0111 (version 7)
  bytes[7] = rand[1];

  // Bytes 8-9: variant bits + remaining random.
  bytes[8] = (rand[2] & 0x3f) | 0x80; // top two bits = 10 (RFC 4122 variant)
  bytes[9] = rand[3];

  // Bytes 10-15: remaining random.
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
}

export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
