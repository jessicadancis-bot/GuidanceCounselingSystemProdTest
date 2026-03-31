const { ROLE } = require("../config/serverConstants");
const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");
const { sendEmail } = require("../utils/emails");
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
      SELECT s.id, s.case_id, s.account_id, s.schedule_time, a.email, a.role 
      FROM schedules AS s
      JOIN accounts AS a ON s.account_id = a.account_id
      WHERE s.schedule_time BETWEEN NOW() 
        AND DATE_ADD(NOW(), INTERVAL 1 HOUR)
        AND s.reminder_sent = FALSE
    `);

    if (!schedules.length) {
      if (self_conn) await connection.commit();
      return;
    }

    const notifications_to_insert = schedules.map((sched) => ({
      account_id: sched.account_id,
      message: "Reminder: You have a counseling session within 1 hour.",
      type: "upcoming_schedule",
    }));

    await connection.query(
      `INSERT INTO notifications (account_id, message, type) VALUES ?`,
      [notifications_to_insert.map((n) => [n.account_id, n.message, n.type])],
    );

    const ids = schedules.map((s) => s.id);
    await connection.query(
      `UPDATE schedules SET reminder_sent = TRUE WHERE id IN (?)`,
      [ids],
    );

    if (self_conn) await connection.commit();

    const limit = pLimit(5);

    process.nextTick(async () => {
      for (const schedChunk of chunkArray(schedules, 5)) {
        await Promise.all(
          schedChunk.map((sched) =>
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
    });
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
  limit = Math.min(limit, 100) || 10;
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
    LIMIT ?
    OFFSET ?
  `,
    [account_id, limit, offset],
  );

  for (const notif of notification_rows) {
    if (notif.is_read) continue;

    await connection.query(
      `
        UPDATE notifications SET is_read = ?
        WHERE id = ?
    `,
      [true, notif.id],
    );
  }

  return { data: notification_rows };
};

module.exports = {
  sendUpcomingSessionNotification,
  getNotifications,
};
