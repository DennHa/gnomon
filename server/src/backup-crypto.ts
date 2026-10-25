// Encrypting files with a password the server never stores (backups; later, perhaps, more). The password becomes an
// X25519 key pair through scrypt. The server keeps only the public half, so it can encrypt every night without
// anyone typing the password, but can't decrypt: that needs the password again. Self-contained: only node:crypto.
//
// File format (all integers big-endian):
//   "GNOMONBK"  8 bytes magic
//   u32         length of the header
//   header      JSON: { v: 1, kdf: { salt, N, r, p }, publicKey, ephemeral, iv, created, kind } (binary fields base64)
//   ciphertext  AES-256-GCM of the payload, with the header as additional data (so it can't be changed either)
//   tag         16 bytes
// The AES key is HKDF-SHA256 of the X25519 secret between a fresh ephemeral key and the password's key pair.
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scryptSync, timingSafeEqual, type KeyObject } from 'node:crypto';

const MAGIC = Buffer.from('GNOMONBK');
// 64 MiB of memory per derivation: slow to guess, still fine on a Raspberry Pi.
const KDF = { N: 2 ** 16, r: 8, p: 1 };
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

/** What the server keeps to encrypt: no secret in it. */
export type PublicBackupKey = { v: 1; salt: string; N: number; r: number; p: number; publicKey: string };

export class BackupError extends Error {
  constructor(
    readonly code: 'not_a_backup' | 'wrong_password' | 'damaged',
    message: string,
  ) {
    super(message);
  }
}

function derive(password: string, salt: Buffer, kdf: { N: number; r: number; p: number }): { privateKey: KeyObject; publicRaw: Buffer } {
  const seed = scryptSync(password.normalize('NFKC'), salt, 32, { ...kdf, maxmem: 256 * kdf.N * kdf.r });
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' });
  return { privateKey, publicRaw: rawPublic(createPublicKey(privateKey)) };
}

const rawPublic = (k: KeyObject) => (k.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_X25519.length);
const publicFromRaw = (raw: Buffer) => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });
const aesKey = (shared: Buffer, ephemeral: Buffer, recipient: Buffer) => Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), 'gnomon-backup v1', 32));

/** The public key for a password, to store on the server. */
export function backupKeyFor(password: string): PublicBackupKey {
  const salt = randomBytes(16);
  const { publicRaw } = derive(password, salt, KDF);
  return { v: 1, salt: salt.toString('base64'), ...KDF, publicKey: publicRaw.toString('base64') };
}

/** Whether a password belongs to a stored public key (for changing it in the Admin page). */
export function passwordMatches(password: string, key: PublicBackupKey): boolean {
  const { publicRaw } = derive(password, Buffer.from(key.salt, 'base64'), key);
  const stored = Buffer.from(key.publicKey, 'base64');
  return stored.length === publicRaw.length && timingSafeEqual(stored, publicRaw);
}

export function encryptFile(payload: Buffer, key: PublicBackupKey, kind = 'gnomon-sqlite-gzip'): Buffer {
  const recipient = Buffer.from(key.publicKey, 'base64');
  const eph = generateKeyPairSync('x25519');
  const ephemeral = rawPublic(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: publicFromRaw(recipient) });
  const iv = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({ v: 1, kdf: { salt: key.salt, N: key.N, r: key.r, p: key.p }, publicKey: key.publicKey, ephemeral: ephemeral.toString('base64'), iv: iv.toString('base64'), created: new Date().toISOString(), kind }),
  );
  const c = createCipheriv('aes-256-gcm', aesKey(shared, ephemeral, recipient), iv);
  c.setAAD(header);
  const data = Buffer.concat([c.update(payload), c.final()]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, len, header, data, c.getAuthTag()]);
}

type Header = { v: number; kdf: { salt: string; N: number; r: number; p: number }; publicKey: string; ephemeral: string; iv: string; created: string; kind: string };

/** The header of an encrypted file, without the password (when it was made, which key). */
export function readHeader(file: Buffer): Header {
  if (file.length < 12 || !file.subarray(0, 8).equals(MAGIC)) throw new BackupError('not_a_backup', 'This isn’t a Gnomon backup file');
  const len = file.readUInt32BE(8);
  if (len > 10_000 || file.length < 12 + len + 16) throw new BackupError('damaged', 'The backup file is cut off or damaged');
  try {
    const h = JSON.parse(file.subarray(12, 12 + len).toString('utf8')) as Header;
    const str = (v: unknown) => typeof v === 'string' && v.length > 0;
    if (h.v !== 1 || !h.kdf || !str(h.kdf.salt) || ![h.kdf.N, h.kdf.r, h.kdf.p].every(Number.isInteger) || ![h.publicKey, h.ephemeral, h.iv, h.created, h.kind].every(str)) throw new Error();
    return h;
  } catch {
    throw new BackupError('damaged', 'The backup file is damaged');
  }
}

export function decryptFile(file: Buffer, password: string): { payload: Buffer; created: string; kind: string } {
  try {
    return open(file, password);
  } catch (e) {
    // A crafted or damaged header can make the key steps fail in their own ways; to the caller it's a damaged file.
    if (e instanceof BackupError) throw e;
    throw new BackupError('damaged', 'The backup file is damaged');
  }
}

function open(file: Buffer, password: string): { payload: Buffer; created: string; kind: string } {
  const h = readHeader(file);
  const len = file.readUInt32BE(8);
  const header = file.subarray(12, 12 + len);
  // Limits, so a crafted file can't make the server derive with absurd settings.
  const { N, r, p } = h.kdf;
  if (!(Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 20 && (N & (N - 1)) === 0 && r >= 1 && r <= 16 && p >= 1 && p <= 4)) throw new BackupError('damaged', 'The backup file is damaged');
  const { privateKey, publicRaw } = derive(password, Buffer.from(h.kdf.salt, 'base64'), h.kdf);
  const recipient = Buffer.from(h.publicKey, 'base64');
  if (!recipient.equals(publicRaw)) throw new BackupError('wrong_password', 'That isn’t the password this backup was made with');
  const ephemeral = Buffer.from(h.ephemeral, 'base64');
  const shared = diffieHellman({ privateKey, publicKey: publicFromRaw(ephemeral) });
  const d = createDecipheriv('aes-256-gcm', aesKey(shared, ephemeral, recipient), Buffer.from(h.iv, 'base64'));
  d.setAAD(header);
  d.setAuthTag(file.subarray(file.length - 16));
  try {
    const payload = Buffer.concat([d.update(file.subarray(12 + len, file.length - 16)), d.final()]);
    return { payload, created: h.created, kind: h.kind };
  } catch {
    throw new BackupError('damaged', 'The backup file was changed or is damaged');
  }
}

/** A password to show once at install: 6 groups of 4 letters and digits (about 119 bits), easy to read and type. */
export function newBackupPassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i, l, o, 0, 1
  let s = '';
  while (s.length < 24) for (const b of randomBytes(32)) if (b < 248 && s.length < 24) s += abc[b % 31]; // 248 = 8 × 31, no bias
  return s.match(/.{4}/g)!.join('-');
}
