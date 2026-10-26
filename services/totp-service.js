/**
 * STORM MULTIMEDIA 1.2.0 — Двухфакторная аутентификация (2FA / RFC 6238 TOTP, Пункт 3.6)
 * Совместимо с Google Authenticator, Яндекс Ключ, Authy, 1Password, Bitwarden.
 */
import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(base32Str) {
  const cleaned = String(base32Str || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function generateTotpUri(arg1, secretArg, issuerArg = process.env.ADMIN_TOTP_ISSUER || 'STORM MULTIMEDIA') {
  let username = arg1;
  let secret = secretArg;
  let issuer = issuerArg;
  if (arg1 && typeof arg1 === 'object') {
    username = arg1.accountName || arg1.username || 'user';
    secret = arg1.secret || '';
    issuer = arg1.issuer || issuerArg;
  }
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function computeHotpToken(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  let tmp = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

export function generateTotpCode(secretBase32, timestampMs = Date.now()) {
  const counter = Math.floor(timestampMs / 30000);
  return computeHotpToken(secretBase32, counter);
}

export function verifyTotpCode(secretBase32, codeInput, windowSteps = 1, timestampMs = Date.now()) {
  if (!secretBase32 || !codeInput) return false;
  const cleanCode = String(codeInput).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const currentCounter = Math.floor(timestampMs / 30000);
  for (let step = -windowSteps; step <= windowSteps; step++) {
    const candidate = computeHotpToken(secretBase32, currentCounter + step);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleanCode))) {
      return true;
    }
  }
  return false;
}

export function generateBackupCodes(count = 6) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    codes.push(`${part1}-${part2}`);
  }
  return codes;
}
