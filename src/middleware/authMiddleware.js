const jwt = require("jsonwebtoken");
const AppError = require("../utils/AppError");
const { PERMISSION } = require("../config/permissionsConfig");
const { ROLE } = require("../config/serverConstants");
const pool = require("../db");
const crypto = require('crypto');
const { permission } = require("process");

const checkForRefreshToken = async (req, res, next) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    return next(new AppError("UNAUTHORIZED: Access prohibited", 401));
  }

  try {
    // Hash the incoming token
    const hashed_refresh_token = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Fetch from DB
    const [rows] = await pool.query(
    `
    SELECT 
      accounts.role,
      refresh_tokens.*,
      GROUP_CONCAT(role_permissions.permission_id) AS permissions
    FROM refresh_tokens
    JOIN accounts ON refresh_tokens.account_id = accounts.account_id
    JOIN role_permissions ON role_permissions.role_id = accounts.role
    WHERE refresh_tokens.hashed_token = ? 
      AND refresh_tokens.expires_at > NOW()
    GROUP BY refresh_tokens.hashed_token;
    `, [hashed_refresh_token]
    );

    if (rows.length === 0) {
      return next(new AppError("Invalid or expired refresh token.", 401));
    }

    const permissions = rows[0].permissions
      ? rows[0].permissions.split(',').map(Number)
      : [];

    req.user = { accountId: rows[0].account_id, role: rows[0].role, permissions };
    
    return next();
  } catch (e) {
    return next(new AppError("Invalid token or Internal Server Error.", 401));
  }
};

const requiresPermission = (config = { permission: [] }) => {
  return (req, res, next) => {
    const { permission } = config;

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError("UNAUTHORIZED: Access prohibited", 401));
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return next(new AppError("UNAUTHORIZED: Access prohibited", 401));
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      if (!permission || permission.length === 0) {
        return next();
      }

      const user_permissions = decoded.permissions || [];

      // SUPER override (ID = 1)
      const required = [...permission, 1];

      const hasPermission = required.some(p =>
        user_permissions.includes(p)
      );

      if (!hasPermission) {
        return next(
          new AppError(
            "FORBIDDEN: You do not have the sufficient permission to interact with this route",
            403
          )
        );
      }

      return next();
    } catch (e) {
      return next(new AppError("Invalid token or Internal Server Error.", 401));
    }
  };
};

// middleware for checking operation permission
const checkPermission = (operation) => {
  return (req, res, next) => {
    const user = req.user
    
    if (!user) {
      return next(new AppError("You do not have a proper permission to perform this action.", 401))
    }
    
    const target_role = operation === "GET" ? req.query.role?.trim() || null : operation === "CREATE" ? req.body.role?.trim() : null;
    const target_role_id = ROLE[target_role?.toUpperCase()];
    
    if (!target_role) {
      return next(new AppError("You have not provided a role to work on.", 400));
    }
    
    if (!target_role_id) {
      return next(new AppError("The role you are trying to work on is invalid", 400));
    }
    
    const allowed = PERMISSION[user.role]?.[operation.toUpperCase()]?.includes(target_role_id);
    
    if (!allowed) {
      return next(new AppError("You do not have the sufficient permission to perform this action on this role.", 403));
    }
    
    return next();
  } 
}

module.exports = {
  requiresPermission,
  checkPermission,
  checkForRefreshToken
};
