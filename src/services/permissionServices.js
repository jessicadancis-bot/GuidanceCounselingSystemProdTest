const AppError = require("../utils/AppError");
const pool = require("../db");

const getPermissions = async ({ connection = pool }) => {
  const [rows] = await connection.query (
    `
      SELECT id, name, COALESCE(description, '') AS description FROM permissions
    `
  )

  return { data: rows }
}

const addRolePermission = async ({role_id, permission_id, connection = pool}) => {
  role_id = Number(role_id);
  permission_id = Array.isArray(permission_id) ? permission_id : [];
  
  const validations = [
    { check: !role_id, message: "role_id is required" },
    { check: permission_id.length === 0, message: "At least one permission must be provided" }
  ];

  const validation_errors = validations.filter(v => v.check).map(v => v.message);
  if (validation_errors.length > 0) {
    throw new AppError(validation_errors.join(", "), 400);
  }

  const [roleExists] = await connection.query(
    "SELECT id FROM roles WHERE id = ?",
    [role_id]
  );
  if (roleExists.length === 0) {
    throw new AppError("Role does not exist", 400);
  }

  const [validPermissions] = await connection.query(
    `SELECT id FROM permissions WHERE id IN (${permission_id.map(() => "?").join(",")})`,
    permission_id
  );

  if (validPermissions.length === 0) {
    throw new AppError("At least one valid permission must be provided", 400);
  }

  const validPermissionIds = validPermissions.map(p => p.id);

  const [existing] = await connection.query(
    `SELECT permission_id FROM role_permissions WHERE role_id = ? AND permission_id IN (${validPermissionIds.map(() => "?").join(",")})`,
    [role_id, ...validPermissionIds]
  );

  const existingIds = existing.map(e => e.permission_id);
  const newPermissionIds = validPermissionIds.filter(id => !existingIds.includes(id));

  if (newPermissionIds.length > 0) {
    const placeholders = newPermissionIds.map(() => "(?, ?)").join(", ");
    const params = newPermissionIds.flatMap(pid => [role_id, pid]);

    await connection.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ${placeholders}`,
      params
    );
  }
}

const getAccountPermissions = async ({account_id, connection}) => {
  account_id = Number(account_id);

  if (!account_id) {
    throw new AppError("Account id must not be empty and is numeric");
  }

  if (!connection) {
    connection = pool;
  }

  const [rows] = await connection.query(
  `
    SELECT permission_id, name, COALESCE(description, '') AS description FROM account_permissions
    JOIN permissions ON account_permissions.permission_id = permissions.id
    WHERE account_id = ?
  `, [account_id]
  )

  return {data: rows};
}

module.exports = {
  addRolePermission,
  getAccountPermissions,
  getPermissions
};
