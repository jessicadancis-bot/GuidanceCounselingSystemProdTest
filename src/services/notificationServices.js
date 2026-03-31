const { ROLE } = require("../config/serverConstants");
const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");
const { sendEmail } = require("../utils/emails");
const { chunkArray } = require("../utils/ArrayHelper");
const pLimit = require("p-limit");

const sendUpcomingSessionNotification = async ({ connection }) => {
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [schedules] = await connection.query(`
      SELECT s.id, s.case_id, s.schedule_time 
      FROM schedules AS s 
      WHERE s.schedule_time BETWEEN NOW() 
        AND DATE_ADD(NOW(), INTERVAL 1 HOUR) 
        AND s.reminder_sent = FALSE
    `);

    if (!schedules.length) {
      if (self_conn) await connection.commit();
      return;
    }

    const case_ids = schedules.map((s) => s.case_id);

    const [case_collaborator_rows] = await connection.query(
      `
      SELECT ccl.counselor_id AS account_id, a.email, a.role, ccl.case_id
      FROM case_collaborators AS ccl
      JOIN accounts AS a ON ccl.counselor_id = a.account_id
      WHERE ccl.case_id IN (?)
    `,
      [case_ids],
    );

    const [case_client_rows] = await connection.query(
      `
      SELECT a.account_id, a.email, a.role, cc.case_id
      FROM counseling_cases AS cc
      JOIN counseling_requests AS cr ON cr.reference_id = cc.request_reference_id
      JOIN accounts AS a ON a.account_id = cr.client_id
      WHERE cc.case_id IN (?)
    `,
      [case_ids],
    );

    const case_map = new Map();

    for (const client of case_client_rows) {
      case_map.set(client.case_id, { email: client.email, role: client.role });
    }

    for (const collab of case_collaborator_rows) {
      if (!case_map.has(collab.case_id)) {
        case_map.set(collab.case_id, {
          email: collab.email,
          role: collab.role,
        });
      }
    }

    const notifications_to_insert = [
      ...case_client_rows.map((n) => [
        n.account_id,
        `Reminder: You have a counseling session within the next hour. ${n.case_id}`,
        "upcoming_schedule",
      ]),
      ...case_collaborator_rows.map((n) => [
        n.account_id,
        `Reminder: You have a counseling session within the next hour. ${n.case_id}`,
        "upcoming_schedule",
      ]),
    ];

    await connection.query(
      `INSERT INTO notifications (account_id, message, type) VALUES ?`,
      [notifications_to_insert],
    );

    const schedule_ids = schedules.map((s) => s.id);
    await connection.query(
      `UPDATE schedules SET reminder_sent = TRUE WHERE id IN (?)`,
      [schedule_ids],
    );

    if (self_conn) await connection.commit();

    const final_data = schedules.map((s) => ({
      ...s,
      ...case_map.get(s.case_id),
    }));

    const limit = pLimit(5);

    for (const sched_chunk of chunkArray(final_data, 5)) {
      await Promise.all(
        sched_chunk.map((sched) =>
          limit(async () => {
            const html_body = `
              <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                <h2>Upcoming Counseling Session</h2>
                <p>Dear ${sched.role === ROLE.CLIENT ? "Student" : "Counselor"},</p>
                <p>This is a reminder that your CASE ${sched.case_id} has a counseling session scheduled at:</p>
                <p><strong>${sched.schedule_time}</strong></p>
                <p>Please make sure to be ready on time.</p>
                <br/>
                <p>Best regards,<br/>Guidance Counseling System</p>
              </div>
            `;
            try {
              await sendEmail(sched.email, "Upcoming session", html_body);
            } catch (err) {
              console.error(`Retrying email for ${sched.email}`, err);
              try {
                await sendEmail(sched.email, "Upcoming session", html_body);
              } catch (err2) {
                console.error(`Failed permanently for ${sched.email}`, err2);
              }
            }
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (err) {
    if (self_conn) await connection.rollback();
    throw err;
  } finally {
    if (self_conn) connection.release();
  }
};

const getNotifications = async ({
  account_id,
  page,
  limit,
  connection = pool,
}) => {
  account_id = normalize(account_id);
  limit = Math.min(limit) || 0;
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  const offset = (page - 1) * limit;

  const validations = [
    {
      check: !account_id,
      message: "Please provide the account id",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("Validation errors", 400, validation_errors);
  }

  const [notification_rows] = await connection.query(
    `
    SELECT * FROM notifications
    WHERE account_id = ?
    ORDER BY created_at DESC
    ${limit && limit > 0 ? "LIMIT ? OFFSET ?" : ""}
  `,
    [account_id, limit, offset],
  );

  const ids_to_mark_read = notification_rows
    .filter((n) => !n.is_read)
    .map((n) => n.id);

  if (ids_to_mark_read.length > 0) {
    await connection.query(
      `
    UPDATE notifications SET is_read = TRUE
    WHERE id IN (?)
  `,
      [ids_to_mark_read],
    );
  }

  return { data: notification_rows };
};

module.exports = {
  sendUpcomingSessionNotification,
  getNotifications,
};
