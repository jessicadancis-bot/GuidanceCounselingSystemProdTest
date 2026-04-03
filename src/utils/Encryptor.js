const crypto = require("crypto");
const ALGORITHM = "aes-256-gcm";

const getKey = (env_key_name) => {
  const key_hex = process.env[env_key_name];
  if (!key_hex) throw new Error(`${env_key_name} is not set`);

  const key = Buffer.from(key_hex, "hex");
  if (key.length !== 32) throw new Error(`${env_key_name} must be 32 bytes (64 hex chars)`);

  return key;
};

const encryptMessage = (plaintext) => {
  if (plaintext === undefined || plaintext === null) return "";

  const encryption_key = getKey("MESSAGE_ENCRYPTION_KEY");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryption_key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    content: encrypted.toString("hex"),
    tag: tag.toString("hex"),
  };
};

const decryptMessage = (encrypted_obj) => {
  if (!encrypted_obj || !encrypted_obj.iv || !encrypted_obj.content || !encrypted_obj.tag) return "";

  const encryption_key = getKey("MESSAGE_ENCRYPTION_KEY");

  const iv_buffer = Buffer.from(encrypted_obj.iv, "hex");
  const content_buffer = Buffer.from(encrypted_obj.content, "hex");
  const tag_buffer = Buffer.from(encrypted_obj.tag, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, encryption_key, iv_buffer);
  decipher.setAuthTag(tag_buffer);

  const decrypted = Buffer.concat([decipher.update(content_buffer), decipher.final()]);
  return decrypted.toString("utf8");
};

const encryptCaseField = (plaintext) => {
  if (plaintext === undefined || plaintext === null) return "";

  const key = getKey("CASE_ENCRYPTION_KEY");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
};

const decryptCaseField = (encrypted_string) => {
  if (!encrypted_string) return "";

  const key = getKey("CASE_ENCRYPTION_KEY");
  const [iv_hex, tag_hex, content_hex] = encrypted_string.split(":");
  if (!iv_hex || !tag_hex || !content_hex) return "";

  const iv_buffer = Buffer.from(iv_hex, "hex");
  const tag_buffer = Buffer.from(tag_hex, "hex");
  const content_buffer = Buffer.from(content_hex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv_buffer);
  decipher.setAuthTag(tag_buffer);

  const decrypted = Buffer.concat([decipher.update(content_buffer), decipher.final()]);
  return decrypted.toString("utf8");
};

module.exports = {
  encryptMessage,
  decryptMessage,
  encryptCaseField,
  decryptCaseField,
};