const pool = require("../db");
const AppError = require("./AppError");
const { normalize } = require("./DataHelper");

/**
 * @param {String} email
 * @param {Object} options
 * @param {String} [options.allowedDomain] - optional domain to validate against
 * @returns {Object} An object containing:
 *  - valid: {Boolean} true if email is valid
 *  - errors: {Array<String>} list of validation errors
 */
const isValidEmail = (email, allowedDomain) => {
  email = normalize(email)?.toLowerCase();

  if (!email) {
    return false;
  }

  if (typeof email !== "string") {
    return false;
  }

  const localRegex = /^[a-z0-9._-]{2,}$/;
  const local = email.split("@")[0];

  if (!localRegex.test(local)) {
    return false;
  }

  // Optional Domain check
  if (allowedDomain) {
    if (typeof allowedDomain !== "string" || allowedDomain.trim() === "") {
      throw new AppError("Invalid domain.", 400)
    } else if (!email.endsWith(allowedDomain)) {
      return false;
    }
  }

  return true;
};

/**
 * @param {String} first
 * @param {String} middle
 * @param {String} last
 * @returns {Object} An object containing:
 *  - valid: {Boolean} true if email is valid, false otherwise
 *  - error: {Array<String>} list of validation errors (empty if valid)
 */
function isValidName(first, middle, last) {
  const nameRegex = /^[a-zA-Z.\- ]{2,}$/;

  const name_check = nameRegex.test(first);
  const middle_name_check = nameRegex.test(middle);
  const surname_check = nameRegex.test(last);

  if (!name_check && first?.trim()) {
    return false;
  }

  if (!middle_name_check && middle?.trim()) {
    return false;
  }

  if (!surname_check && last?.trim()) {
    return false;
  }

  return true;
}

/**
 * @param {String} password
 * @returns {Object} An object containing:
 *  - valid: {Boolean} true if password is valid, false otherwhise
 *  - errors: {Array<String>} list if validation error (empty if valid)
 */
const isValidPassword = (password) => {
  const password_regex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};:'",.<>/?\\|`~]).{8,32}$/;

  if (!password_regex.test(password)) {
    return false;
  }

  return true;
};

const findRoleByName = async (role, connection = pool) => {
  const [rows] = await connection.query(
    "SELECT id, name FROM roles WHERE name = ?",
    [role]
  );

  if (rows.length === 0) {
    return { valid: false, errors: ["INVALID ROLE"] };
  }

  const { id, role_name } = rows[0];
  return { valid: true, id: id, name: role_name };
};

module.exports = {
  isValidEmail,
  isValidName,
  isValidPassword,
};
