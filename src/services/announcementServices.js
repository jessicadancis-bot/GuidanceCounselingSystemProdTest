const { normalize } = require("path");
const pool = require("../db");
const AppError = require("../utils/AppError");

const getAnnouncements = async ({ role, page, limit, connection = pool }) => {
  role = Number(role);
  limit = Math.min(limit, 100) || 10;
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  const offset = (page - 1) * limit;

  const validations = [];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("Validation errors", 400, validation_errors);
  }

  // Build WHERE clause for role filter
  const conditions = [];
  const params = [];

  if (role) {
    conditions.push(
      "EXISTS (SELECT 1 FROM announcement_audience aa WHERE aa.announcement_id = a.id AND aa.audience = ?)",
    );
    params.push(role);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[{ total_count }]] = await connection.query(
    `SELECT COUNT(*) AS total_count
   FROM announcements a
   ${whereClause}`,
    params,
  );

  const [announcement_rows] = await connection.query(
    `SELECT 
      a.*,
      COALESCE(
        (SELECT JSON_ARRAYAGG(aa.audience)
         FROM announcement_audience aa
         WHERE aa.announcement_id = a.id
        ), JSON_ARRAY()
      ) AS audiences
   FROM announcements a
   ${whereClause}
   ORDER BY a.created_at DESC
   LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const total_pages = Math.ceil(total_count / limit);

  return { data: announcement_rows, total_pages, page };
};

const createAnnouncement = async ({ title, content, audience, connection }) => {
  audience = Array.isArray(audience) ? audience : [];
  content = normalize(content);
  title = normalize(title);

  const validations = [
    { check: !title, message: "Title must be provided" },
    {
      check: !content,
      message: "Content of the announcement must be provided",
    },
    {
      check: !audience,
      message: "Audience must be stated before posting the announcement.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError(
      "You have an error in your field.",
      400,
      validation_errors,
    );
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [announcement_in] = await connection.query(
      `
      INSERT INTO announcements(title, content)
      VALUES (?, ?)
    `,
      [title, content],
    );

    const aud_val = [];
    audience.forEach((a) => aud_val.push(announcement_in.insertId, a));

    await connection.query(
      `
        INSERT INTO announcement_audience(announcement_id, audience)
        VALUES ${audience.map(() => "(?, ?)").join(", ")}
    `,
      aud_val,
    );

    if (self_conn) await connection.commit();

    return;
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const deleteAnnouncement = async ({ id, connection = pool }) => {
  const validations = [
    { check: !id, message: "Announcement ID must be provided" },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError(
      "You have an error in your field.",
      400,
      validation_errors,
    );
  }

  await connection.query(
    `
    DELETE FROM announcements
    WHERE id = ?
  `,
    [id],
  );
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  deleteAnnouncement,
};
