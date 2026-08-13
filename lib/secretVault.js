import crypto from "crypto";

const PREFIX = "enc:v1:";

function encryptionKey() {
  const secret = String(process.env.API_KEY_ENCRYPTION_SECRET || "").trim();
  if (secret.length < 32) {
    throw new Error("API_KEY_ENCRYPTION_SECRET must be set to a random value of at least 32 characters.");
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(value) {
  const plain = String(value || "").trim();
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(value) {
  const stored = String(value || "").trim();
  if (!stored) return "";

  // Temporary backwards compatibility: existing plaintext values continue to
  // work until an administrator saves them again through the API Key Vault.
  if (!stored.startsWith(PREFIX)) return stored;

  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (raw.length < 29) throw new Error("The stored API credential is invalid.");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
