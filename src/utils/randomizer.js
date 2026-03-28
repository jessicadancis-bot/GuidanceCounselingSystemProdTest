const pool = require("../db");
const AppError = require("./AppError");
const { DateTime } = require("luxon");
const crypto = require('crypto');

const generateRandomID = ({ length = 6 }) => {
  return crypto.randomBytes(length).toString('base64url');
};

const generateID = async ({ connection }) => {
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const today_ph = DateTime.now().setZone("Asia/Manila").startOf("day");
    const year = today_ph.year;
    const month = String(today_ph.month).padStart(2, "0");
    const day = String(today_ph.day).padStart(2, "0");

    const [account_rows] = await connection.query(`
        SELECT COUNT(*) AS count 
        FROM accounts 
    `);

    const count_today = parseInt(account_rows[0]?.count || 0, 10);

    // Build public ID
    const public_id = `${year}${month}${day}${count_today + 1}`;

    return public_id;
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const generateReferenceID = async ({ account_id, connection }) => {
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const today_ph = DateTime.now().setZone("Asia/Manila").startOf("day");
    const year = today_ph.year;
    const month = String(today_ph.month).padStart(2, "0");
    const day = String(today_ph.day).padStart(2, "0");

    const month_start = today_ph.startOf("month").toISO();
    const month_end = today_ph.endOf("month").toISO();

    const [request_rows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM counseling_requests
        WHERE client_id = ?
        AND created_at >= ?
        AND created_at <= ?
    `,
      [account_id, month_start, month_end],
    );

    const [user_rows] = await connection.query(
      `
        SELECT public_id FROM users
        WHERE account_id = ?
    `,
      [account_id],
    );

    const count_today = parseInt(request_rows[0]?.count || 0, 10);
    const account_p_id = user_rows[0].public_id || "Unknown";

    if (!account_p_id) {
      throw new AppError("Could not process your request");
    }

    // Build public ID
    const reference_id = `RE${account_p_id}${year}${month}${day}${count_today + 1}`;

    return reference_id;
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const generateCaseID = async ({ reference_id, connection }) => {
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const today_ph = DateTime.now().setZone("Asia/Manila").startOf("day");
    const year = today_ph.year;
    const month = String(today_ph.month).padStart(2, "0");
    const day = String(today_ph.day).padStart(2, "0");

    const month_start = today_ph.startOf("month").toISO();
    const month_end = today_ph.endOf("month").toISO();

    const [case_rows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM counseling_cases
        WHERE created_at >= ?
            AND created_at <= ?
    `,
      [month_start, month_end],
    );

    const count_today = parseInt(case_rows[0]?.count || 0, 10);

    // Build public ID
    const case_id = `CA${reference_id}${count_today + 1}`;

    return case_id;
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const generateCaseSessionID = async ({ case_id, connection }) => {
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [case_session_rows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM counseling_case_sessions
        WHERE case_id = ?
    `,
      [case_id],
    );

    const count_today = parseInt(case_session_rows[0]?.count || 0, 10);

    // Build public ID
    const case_session_id = `${case_id}${count_today}SE`;

    return case_session_id;
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

module.exports = {
  generateID,
  generateReferenceID,
  generateCaseID,
  generateCaseSessionID,
  generateRandomID
};
