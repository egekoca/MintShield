import { createHash, timingSafeEqual } from "node:crypto";

const RIPPLE_BASE58_ALPHABET =
  "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest();
}

function decodeRippleBase58(value: string) {
  let number = 0n;
  for (const character of value) {
    const digit = RIPPLE_BASE58_ALPHABET.indexOf(character);
    if (digit === -1) return undefined;
    number = number * 58n + BigInt(digit);
  }

  let decoded =
    number === 0n
      ? Buffer.alloc(0)
      : Buffer.from(
          number.toString(16).padStart(
            Math.ceil(number.toString(16).length / 2) * 2,
            "0",
          ),
          "hex",
        );
  let leadingZeroes = 0;
  while (value[leadingZeroes] === RIPPLE_BASE58_ALPHABET[0]) {
    leadingZeroes += 1;
  }
  if (leadingZeroes > 0) {
    decoded = Buffer.concat([Buffer.alloc(leadingZeroes), decoded]);
  }
  return decoded;
}

export function isValidXrplClassicAddress(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 25 ||
    value.length > 35 ||
    value[0] !== "r"
  ) {
    return false;
  }
  const decoded = decodeRippleBase58(value);
  if (decoded === undefined || decoded.length !== 25 || decoded[0] !== 0) {
    return false;
  }
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  return timingSafeEqual(checksum, expected);
}
