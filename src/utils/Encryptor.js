const crypto = require("crypto");

const encryptMessage = (plaintext) => {
  const ENCRYPTION_KEY = Buffer.from(process.env.MESSAGE_ENCRYPTION_KEY, "hex");

  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). Check your .env file.",
    );
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const autht_tag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    content: encrypted.toString("hex"),
    tag: autht_tag.toString("hex"),
  };
};

const decryptMessage = (encrypted_obj) => {
  const ENCRYPTION_KEY = Buffer.from(process.env.MESSAGE_ENCRYPTION_KEY, "hex");

  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). Check your .env file.",
    );
  }

  const { iv, content, tag } = encrypted_obj;

  const iv_buffer = Buffer.from(iv, "hex");
  const encrypted_buffer = Buffer.from(content, "hex");
  const auth_tag_buffer = Buffer.from(tag, "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    iv_buffer,
  );
  decipher.setAuthTag(auth_tag_buffer);

  const decrypted = Buffer.concat([
    decipher.update(encrypted_buffer),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

module.exports = {
  encryptMessage,
  decryptMessage,
};