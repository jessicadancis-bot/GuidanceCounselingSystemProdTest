const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");
const { sendEmail } = require("../utils/emails");

const sendUpcomingSessionNotification = async ({ connection = pool }) => {
  const [schedules] = await connection.query(`
      SELECT * FROM schedules
      WHERE 
        schedule_time BETWEEN NOW() 
        AND DATE_ADD(NOW(), INTERVAL 1 HOUR)
        AND reminder_sent = FALSE
    `);

  for (const sched of schedules) {
    const message = "Reminder: You have a counseling session within 1 hour.";

    await connection.query(
      `INSERT INTO notifications (account_id, message, type)
         VALUES (?, ?, ?)`,
      [sched.account_id, message, "upcoming_schedule"],
    );

    const html_body = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
            <h2>Upcoming Counseling Session</h2>
            <p>Dear Student,</p>
            <p>This is a reminder that you have a counseling session scheduled at:</p>
            <p><strong>${sched.schedule_time}</strong></p>
            <p>Please make sure to be ready on time.</p>
            <br/>
            <p>Best regards,<br/>Guidance Counseling System</p>
        </div>
        `;

    await sendEmail(process.env.SMTP_USER, "Upcoming session", html_body);

    await connection.query(
      `UPDATE schedules SET reminder_sent = TRUE WHERE id = ?`,
      [sched.id],
    );
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
