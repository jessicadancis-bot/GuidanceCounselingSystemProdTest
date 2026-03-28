const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");
const { auditAction } = require("./auditService");

const createDepartment = async ({
  name,
  description,
  performed_by,
  connection,
}) => {
  name = normalize(name);
  description = normalize(description) ?? null;
  performed_by = normalize(performed_by);

  const validations = [
    { check: !name, message: "Department name must be provided" },
    { check: !performed_by, message: "Could not proceed with your request." },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [department_in] = await connection.query(
      `
      INSERT INTO departments (name, description)
      VALUES (?, ?)
    `,
      [name, description],
    );

    await auditAction({
      action: "CREATE",
      resource: "DEPARTMENT",
      entity_id: [department_in.insertId],
      performed_by: performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return {
      data: {
        name,
        description,
      },
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const updateDepartment = async ({
  department_id,
  name,
  description,
  performed_by,
  connection,
}) => {
  name = normalize(name);
  description = normalize(description) ?? null;
  performed_by = normalize(performed_by);

  const validations = [
    {
      check: !department_id,
      message: "Provide the id of the department you want to update.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  const to_update = [];
  const to_update_values = [];

  if (name !== undefined) {
    to_update.push("name = ?");
    to_update_values.push(name);
  }

  if (description !== undefined) {
    to_update.push("description = ?");
    to_update_values.push(description);
  }

  if (to_update.length === 0) {
    throw new AppError("Nothing to update");
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    await connection.query(
      `
      UPDATE departments 
      SET ${to_update.join(", ")}
      WHERE id = ?
    `,
      [...to_update_values, department_id],
    );

    await auditAction({
      action: "UPDATE",
      resource: "DEPARTMENT",
      entity_id: [department_id],
      performed_by: performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return {
      data: {
        name,
        description,
      },
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const archiveDepartment = async ({ department_id, is_archived, performed_by, connection = pool }) => {
  department_id = normalize(department_id);
  performed_by = normalize(performed_by);

  const validations = [
    {
      check: !department_id,
      message: "Provide the id of the department you want to archive.",
    },
    {
      check: !performed_by,
      message: "Invalid action. Performer must be identified"
    }
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  await connection.query(`
    UPDATE departments SET archived = ?
    WHERE id = ?
  `, [is_archived, department_id]);
}

const getDepartments = async ({ status, page, limit, search, connection = pool }) => {
  search = normalize(search)?.toLowerCase();
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  limit = Number(limit) || 0;
  const offset = (page - 1) * limit;

  const validations = [];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  const filter = [];
  const filter_val = [];

  if (search !== undefined) {
    filter.push("(LOWER(dp.id) LIKE ? OR LOWER(dp.name) LIKE ?)");
    filter_val.push(`%${search}%`, `%${search}%`);
  }
  
  if (status) {
    filter.push('dp.archived = ?');
    filter_val.push(status);
  }

  if (limit && limit > 0) {
    filter_val.push(limit);
    filter_val.push(offset);
  }

  const [department_rows] = await connection.query(`
    SELECT dp.name, dp.description, dp.id, dp.archived AS is_archived, COUNT(*) OVER() AS total_count
    FROM departments AS dp
    ${filter.length > 0 ? `WHERE ${filter.join(" AND ")}` : ''}
    ${limit && limit > 0 ? `LIMIT ? OFFSET ?` : ''}
  `, [...filter_val]);

  const total = department_rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  return { data: department_rows, total, total_pages, page };
};

const createCourse = async ({
  department,
  course_name,
  course_code,
  course_description,
  total_years,
  performed_by,
  connection,
}) => {
  department = normalize(department);
  course_name = normalize(course_name);
  course_description = normalize(course_description) || null;
  course_code = normalize(course_code)?.toLowerCase();
  performed_by = normalize(performed_by);
  total_years = Number(total_years);

  const validations = [
    {
      check: !department,
      message: "Department must be provided",
    },
    {
      check: !performed_by,
      message: "Performer id must be provided for identification.",
    },
    { check: !course_name, message: "Course name must be provided." },
    {
      check:
        course_name && (course_name.length < 3 || course_name.length > 100),
      message:
        "Course name must be atleast 3 characters in length and a maximum character of 100.",
    },
    { check: !course_code, message: "Course code must be provided." },
    {
      check: course_code && course_code.length > 45,
      message: "Maximum course code must not exceed 45 characters",
    },
    {
      check: course_description && course_description.length > 145,
      message: "Maximum course description must not exceed 145 characters",
    },
    {
      check: !total_years,
      message: "Total years must be provided and must be numeric.",
    },
    {
      check: total_years && total_years <= 0,
      message: "Total years must be atleast 1.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [rows] = await connection.query(
      `
      SELECT 1 FROM courses 
      WHERE course_code = ?
      LIMIT 1
    `,
      [course_code],
    );

    if (rows.length > 0) {
      throw new AppError("Course already exist.", 400);
    }

    const [course_insert] = await connection.query(
      `
      INSERT INTO courses (department, name, course_code, description, total_years)
      VALUES (?, ?, ?, ?, ?)
    `,
      [
        department,
        course_name,
        course_code,
        course_description,
        total_years,
      ],
    );

    await auditAction({
      action: "CREATE",
      resource: "COURSE",
      entity_id: [course_insert.insertId],
      performed_by: performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return {
      data: {
        success: true,
        course_code: course_code,
        course_name: course_name,
        course_description: course_description,
        total_years: total_years,
      },
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getCourses = async ({
  search,
  is_archived,
  page,
  limit,
  department = [],
  connection = pool,
}) => {
  search = normalize(search)?.toLowerCase();
  const archive_num = Number(is_archived);
  is_archived = !isNaN(is_archived) ? archive_num : undefined;

  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  limit = Number(limit) || 0;
  const offset = (page - 1) * limit;

  const conditions = [];
  const values = [];

  if (search !== undefined) {
    conditions.push(
      "(LOWER(c.course_code) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(c.id) LIKE ?)",
    );
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (is_archived !== undefined) {
    conditions.push(`c.is_archived = ?`);
    values.push(is_archived);
  }

  if (department.length > 0) {
    conditions.push(`d.id IN (${department.map(() => '?').join(', ')})`);
    values.push(...department);
  }

  let sql = `
    SELECT c.course_code, c.id, c.name, c.description, c.total_years, c.is_archived, d.name AS department_name, d.id AS department_id,
           COUNT(*) OVER() AS total_count
    FROM courses AS c
    JOIN departments AS d ON d.id = c.department
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY c.created_at DESC
    `;

  if (limit && limit > 0) {
    sql += ` LIMIT ? OFFSET ?`;
    values.push(limit, offset);
  }

  const [rows] = await connection.query(sql, [...values]);

  const total = rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  return { data: rows || [], total_pages, page, total };
};

const getCourseData = async ({ course_code, connection = pool }) => {
  course_code = normalize(course_code)?.toLowerCase() || undefined;

  const validations = [
    { check: !course_code, message: "Course code must be provided." },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  const [rows] = await connection.query(
    `
    SELECT course_code, name, description, total_years 
    FROM courses
    WHERE course_code = ?
    LIMIT 1
  `,
    [course_code],
  );

  return { data: rows[0] || {} };
};

const updateCourse = async ({
  performed_by,
  course_code,
  new_course_name,
  new_course_description,
  new_total_years,
  new_department,
  connection,
}) => {
  performed_by = normalize(performed_by);
  course_code = normalize(course_code)?.toLowerCase();
  new_course_name =
    new_course_name !== undefined
      ? normalize(new_course_name)
      : undefined;
  new_course_description =
    new_course_description !== undefined
      ? normalize(new_course_description)
      : undefined;
  new_total_years =
    new_total_years !== undefined ? Number(new_total_years) : undefined;

  const validations = [
    {
      check: !performed_by,
      message: "Account ID of the performer must be provided.",
    },
    {
      check: !course_code,
      message:
        "The code of the course you are trying to update must be provided.",
    },
    {
      check:
        new_course_name !== undefined &&
        (new_course_name.length < 3 || new_course_name.length > 100),
      message:
        "Course name must be atleast 3 characters in length and a maximum character of 100.",
    },
    {
      check:
        new_course_description !== undefined &&
        new_course_description.length > 145,
      message: "Maximum course description must not exceed 145 characters",
    },
    {
      check: new_total_years !== undefined && isNaN(new_total_years),
      message: "New total year must be numeric",
    },
    {
      check:
        new_total_years !== undefined &&
        !isNaN(new_total_years) &&
        new_total_years <= 0,
      message: "Total years must be atleast 1.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  const to_update = [];
  const to_update_value = [];

  if (new_course_name !== undefined) {
    to_update.push("name = ?");
    to_update_value.push(new_course_name);
  }

  if (new_course_description !== undefined) {
    to_update.push("description = ?");
    to_update_value.push(new_course_description);
  }

  if (new_total_years !== undefined) {
    to_update.push("total_years = ?");
    to_update_value.push(new_total_years);
  }

  if (new_department !== undefined) {
    to_update.push("department = ?");
    to_update_value.push(new_department);
  }

  if (to_update.length === 0) {
    throw new AppError("You are not updating any field.", 400);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [department_rows] = await connection.query(`
      SELECT 1 FROM departments
      WHERE id = ?
      `, [new_department]);

    if (department_rows.length === 0) {
      throw new AppError("Invalid department.");
    }

    const [course_rows] = await connection.query(
      `
      SELECT id FROM courses 
      WHERE course_code = ?
      LIMIT 1
    `,
      [course_code],
    );

    if (course_rows.length === 0) {
      throw new AppError(
        "Could not find the course you are trying to update.",
        400,
      );
    }

    const course_id = course_rows[0].id;

    const query = `UPDATE courses SET ${to_update.join(",")} WHERE id = ? AND is_archived != ?`;
    await connection.query(query, [...to_update_value, course_id, true]);

    await auditAction({
      action: "UPDATE",
      resource: "COURSE",
      entity_id: [course_id],
      performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { course_code } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const archiveCourse = async ({
  is_archived,
  performed_by,
  course_code,
  connection,
}) => {
  performed_by = normalize(performed_by);
  course_code = normalize(course_code)?.toLowerCase();

  const validations = [
    {
      check: typeof is_archived !== "boolean",
      message: "Archive value must be set to either true or false",
    },
    {
      check: !performed_by,
      message: "Account ID of the performer must be provided.",
    },
    {
      check: !course_code,
      message:
        "The code of the course you are trying to update must be provided.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  const [course_rows] = await pool.query(
    `
    SELECT id FROM courses 
    WHERE course_code = ?
    LIMIT 1
  `,
    [course_code, true],
  );

  if (course_rows.length === 0) {
    throw new AppError(
      "Could not find the course you are trying to update.",
      400,
    );
  }

  const course_id = course_rows[0].id;

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [course_update] = await connection.query(
      `
      UPDATE courses 
      SET is_archived = ? 
      WHERE id = ?
    `,
      [is_archived, course_id, true],
    );

    if (course_update.affectedRows === 0) {
      throw new AppError(
        "Archiving failed. Please make sure that the id you are trying to archive exist",
        400,
      );
    }

    await auditAction({
      action: is_archived ? "ARCHIVE" : "UNARCHIVE",
      resource: "COURSE",
      entity_id: [course_id],
      performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { course_code } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

module.exports = {
  createDepartment,
  getDepartments,
  createCourse,
  getCourses,
  getCourseData,
  updateCourse,
  archiveCourse,
  updateDepartment,
  archiveDepartment
};
