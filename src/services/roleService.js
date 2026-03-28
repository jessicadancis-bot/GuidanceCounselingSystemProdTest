const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");

const createRole = async ({
  role_name,
  role_description,
  role_permissions = [],
  connection,
}) => {
  role_name = normalize(role_name)?.toLowerCase();
  role_description = normalize(role_description) || null;
  role_permissions = Array.isArray(role_permissions) ? role_permissions : [];

  const validations = [
    {
      check: !role_name,
      message: "Role name must be provided and must be a unique name",
    },
    {
      check: role_permissions.length === 0,
      message: "Role must have atleast one permission",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError(validation_errors.join(", "), 400);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [rows] = await connection.query(
      "SELECT EXISTS(SELECT 1 FROM roles WHERE LOWER(name) = ?) AS `exists`",
      [role_name]
    );

    if (rows[0].exists) {
      throw new AppError("Role already exist!", 400);
    }

    const [result] = await connection.query(
      "INSERT INTO roles (name, description) VALUES (?, ?)",
      [role_name, role_description]
    );

    const [rows2] = await connection.query(
      `SELECT id FROM permissions WHERE id IN (${role_permissions
        .map(() => "?")
        .join(", ")})`,
      role_permissions
    );

    const validIds = rows2.map((r) => r.id);
    const validPermissions = role_permissions.filter((id) =>
      validIds.includes(id)
    );

    if (validPermissions.length === 0) {
      throw new AppError("Role must have at least one valid permission", 400);
    }

    await connection.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ${validPermissions
        .map(() => "(?, ?)")
        .join(", ")}`,
      validPermissions.flatMap((permission_id) => [
        result.insertId,
        permission_id,
      ])
    );

    if (self_conn) await connection.commit();

    return { id: result.insertId };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getRoles = async ({ connection = pool }) => {
  const [rows] = await connection.query(`
    SELECT 
      roles.id, 
      roles.name, 
      roles.description,
      COALESCE(GROUP_CONCAT(role_permissions.permission_id SEPARATOR ','), '') AS permissions
    FROM roles
    LEFT JOIN role_permissions ON roles.id = role_permissions.role_id
    WHERE roles.id != 1
    GROUP BY roles.id, roles.name, roles.description;
  `);

  const data = rows.map(row => ({
    ...row,
    permissions: row.permissions
      ? row.permissions.split(",").map(p => Number(p.trim()))
      : []
  }));

  return { data: rows };
};

module.exports = {
  createRole,
  getRoles,
};
