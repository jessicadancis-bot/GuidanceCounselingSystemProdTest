const crypto = require("crypto");
const bcrypt = require("bcrypt");
const pool = require("../db");
const AppError = require("../utils/AppError");
const { isValidEmail, isValidPassword } = require("../utils/Validator");
const { normalize } = require("../utils/DataHelper");
const { generateToken } = require("../utils/Token");
const { verifyGoogleToken } = require("./googleServices");
const { ROLE } = require("../config/serverConstants");

const authenticateUserByEmail = async ({
  email,
  password,
  connection = pool,
}) => {
  email = normalize(email)?.toLowerCase();
  password = normalize(password);

  const validations = [
    {
      check: !isValidEmail(email),
      message: "Invalid email format!",
    },
    { check: !password, message: "Invalid password!" },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  const [rows] = await connection.query(
    `
      SELECT 
        a.account_id,
        a.role,
        a.is_disabled,
        a.password AS stored_hash,
        GROUP_CONCAT(rp.permission_id) AS permissions
      FROM accounts a
      LEFT JOIN role_permissions rp ON a.role = rp.role_id
      WHERE a.email = ? AND a.is_archived != ? AND a.google_sub IS NULL
      GROUP BY a.account_id
      LIMIT 1
    `,
    [email, 1, ROLE.CLIENT]
  );

  const account = rows[0];

  const stored_hash = normalize(account?.stored_hash) || process.env.DUMMY_HASH;
  const match = await bcrypt.compare(password, stored_hash);

  if (!account || !match) {
    throw new AppError("Invalid credentials", 401);
  }

  if (account.is_disabled === 1) {
    throw new AppError("Access has been revoked for this account. Please contact the administrator", 404);
  }

  const refresh_token = crypto.randomBytes(32).toString("hex");
  const hashed_refresh_token = crypto.createHash("sha256").update(refresh_token).digest("hex");

  await connection.query(`
    INSERT INTO refresh_tokens (account_id, hashed_token, expires_at)
    VALUES (?, ?, NOW() + INTERVAL 1 DAY)
  `, [account.account_id, hashed_refresh_token]);

  const permissions = account.permissions
    ? account.permissions.split(',').map(Number)
    : [];

  const token = await generateToken({
    accountId: account.account_id || 0,
    role: account.role,
    permissions: permissions
  });

  return { token, refresh_token, role: account.role };
};

const authenticateUserByGoogleSub = async ({
  credential,
  connection = pool,
}) => {
  credential = normalize(credential);

  const payload = await verifyGoogleToken(
    credential,
    process.env.GOOGLE_CLIENT_ID
  );

  const { email, sub } = payload;

  const validations = [
    {
      check: !credential,
      message: "Google credential token cannot be empty!",
    },
    {
      check: !isValidEmail(payload.email),
      message: "Invalid email format",
    }
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
    
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST", 400, validation_errors);
  }

  const [rows] = await connection.query(
    `
    SELECT 
      a.account_id, 
      a.role,
      GROUP_CONCAT(rp.permission_id) AS permissions
    FROM accounts a
    LEFT JOIN role_permissions rp ON a.role = rp.role_id
    WHERE a.email = ?
      AND a.is_archived != ?
    GROUP BY a.account_id
    LIMIT 1
    `,
    [email, 1]
  );

  let account = rows[0];

  if (!account) {
    throw new AppError("Invalid credentials", 401);
  }

  const refresh_token = crypto.randomBytes(32).toString("hex");
  const hashed_refresh_token = crypto.createHash("sha256").update(refresh_token).digest("hex");
  
  await connection.query(`
    INSERT INTO refresh_tokens (account_id, hashed_token, expires_at)
    VALUES (?, ?, NOW() + INTERVAL 1 DAY)
  `, [account.account_id, hashed_refresh_token]);

  const permissions = account.permissions
    ? account.permissions.split(',').map(Number)
    : [];

  const token = await generateToken({
    accountId: account.account_id || 0,
    role: account.role,
    permissions: permissions
  });

  return { token, refresh_token, role: account.role };
};

const changePassword = async (
  account_id,
  current_password,
  new_password,
  connection = pool
) => {
  account_id = normalize(account_id);
  current_password = normalize(current_password);
  new_password = normalize(new_password);

  const validations = [
    {
      check: !account_id,
      message: "Account id of the account being changed must be provided",
    },
    {
      check: !new_password,
      message: "New password must be provided.",
    },
    {
      check: !isValidPassword(new_password), message: "Invalid password format. Password must contain atleast 1 special character, one upper case letter, and must be atleast 8 in length and cannot exceed 32 characters"
    }
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST", 400, validation_errors);
  }

  const [account] = await connection.query(
    `
    SELECT password FROM accounts
    WHERE account_id = ?
    LIMIT 1
    `,
    [account_id]
  );

  const stored_hash = account[0].password;

  const password_check = await bcrypt.compare(current_password, stored_hash);
  if (!password_check) {
    throw new AppError("Could not verify current password!", 401);
  }

  const match = await bcrypt.compare(new_password, stored_hash);
  if (match) {
    throw new AppError(
      "BAD REQUEST!",
      400,
      "New password cannot be the same as the current password!"
    );
  }

  const hashedPassword = await bcrypt.hash(
    new_password,
    Number(process.env.BCRYPT_SALT_ROUNDS) || 10
  );

  const [query] = await connection.query(
    `
    UPDATE accounts
    SET password = ?
    WHERE account_id = ?
    `,
    [hashedPassword, account_id]
  );
  if (query.affectedRows === 0) {
    throw new AppError("Could not update password!", 500);
  }

  return true;
};

const resetPassword = async ({
  reset_token,
  new_password,
  connection,
}) => {
  reset_token = normalize(reset_token);
  new_password = normalize(new_password);

  const validations = [
    {
      check: !reset_token,
      message: "Token cannot be empty!",
    },
    {
      check: !new_password,
      message: "New password is required",
    },
    {
      check: !isValidPassword(new_password), message: "Invalid password format. Password must contain atleast 1 special character, one upper case letter, and must be atleast 8 in length and cannot exceed 32 characters"
    }
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST", 400, validation_errors);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [rows] = await connection.query(
      `SELECT account_id 
       FROM password_resets 
       WHERE token = ? 
       AND expires_at > NOW()`,
      [reset_token]
    );

    if (rows.length === 0) {
      throw new AppError("Invalid or expired reset token");
    }

    const account_id = rows[0].account_id;

    const hashed_password = await bcrypt.hash(
      new_password,
      Number(process.env.BCRYPT_SALT_ROUNDS) || 10
    );

    const [update_password_query] = await connection.query(
      `UPDATE accounts SET password = ? WHERE account_id = ?`,
      [hashed_password, account_id]
    );
    if (update_password_query.affectedRows === 0) {
      throw new AppError("Password reset failed!", 500);
    }

    const [delete_password_resets_query] = await connection.query(
      `DELETE FROM password_resets WHERE account_id = ?`,
      [account_id]
    );
    if (delete_password_resets_query.affectedRows === 0) {
      throw new AppError("Password reset failed!", 500);
    }

    if (self_conn) await connection.commit();

    return { message: "Password reset successfully" };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const requestPasswordReset = async ({ account_email, connection }) => {
  account_email = normalize(account_email)?.toLowerCase();

  if (!account_email) {
    throw new AppError("Account email cannot be empty!", 400);
  }

  // Verify account exists
  const [rows] = await pool.query(
    `SELECT account_id FROM accounts WHERE email = ? AND google_sub IS NULL`,
    [account_email]
  );

  if (rows.length === 0) {
    throw new AppError("Request could not be processed!", 400);
  }

  const account_id = rows[0].account_id;

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [delete_query_for_existing] = await connection.query(
      `DELETE FROM password_resets WHERE account_id = ?`,
      [account_id]
    );

    const token = crypto.randomBytes(20).toString("hex");
    await connection.query(
      `INSERT INTO password_resets (account_id, token, expires_at)
       VALUES (?, ?, NOW() + INTERVAL 15 MINUTE)`,
      [account_id, token]
    );

    if (self_conn) await connection.commit();

    return { success: true, email: account_email, reset_token: token };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const isProfileComplete = async (account_id, connection = pool) => {
  if (!account_id) {
    throw new AppError("Account id cannot be empty!", 500);
  }

  const [rows] = await connection.query(
    "SELECT profile_completed FROM users WHERE account_id = ?",
    [account_id]
  );

  if (rows.length === 0) return false;

  return !!rows[0].profile_completed;
};

const requestAccountVerification = async ({ email, connection }) => {
  if (!email)
    throw new AppError("Missing required field", 400, ["INVALID_EMAIL"]);


  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [result] = await connection.query(
    `
      SELECT account_id FROM accounts 
      WHERE email = ? AND is_verified = 0
      LIMIT 1`,
    [email]);

    if (result.length === 0) {
      throw new AppError(
        "Account is verified or does not exist!",
        401
      );
    }

    const account = result[0];
    // delete old request if any
    await connection.query(
      `DELETE FROM verification_request WHERE account_id = ?`,
      [account.account_id]
    );

    // insert new token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await connection.query(
      `INSERT INTO verification_request (account_id, token, expires_at) VALUES (?, ?, ?)`,
      [account.account_id, token, expiresAt]
    );

    if (self_conn) await connection.commit();

    return { token: token }
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const verifyAccount = async ({
  token,
  connection,
}) => {
  token = normalize(token);

  const validations = [
    { check: !token, message: "Token cannot be empty" }
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST", 400, validation_errors);
  }

  const [rows] = await pool.query(
    `SELECT account_id FROM verification_request WHERE token = ? AND expires_at > NOW()`,
    [token]
  );

  if (rows.length === 0) {
    throw new AppError("BAD REQUEST", 400, ["Invalid or expired token"]);
  }

  const account_id = rows[0].account_id;

  const [result] = await pool.query(
    `
    SELECT is_verified FROM accounts
    WHERE account_id = ?
    `,
    [account_id]
  );

  const is_verified = result[0].status;

  if (is_verified === 1) {
    throw new AppError("Account has been verified already!", 400);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    await connection.query(`
      UPDATE accounts 
      SET is_verified = ?
      WHERE account_id = ?
    `, [true, account_id]);

    await connection.query(`DELETE FROM verification_request WHERE token = ?`, [
      token,
    ]);

    if (self_conn) await connection.commit();

    return { success: true };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

module.exports = {
  authenticateUserByEmail,
  requestPasswordReset,
  changePassword,
  resetPassword,
  isProfileComplete,
  verifyAccount,
  requestAccountVerification,
  authenticateUserByGoogleSub
};
