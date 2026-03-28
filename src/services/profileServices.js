const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");
const { isValidName } = require("../utils/Validator");

// perform maintenance as this service is still incomplete
const updateProfile = async ({
  account_id,
  given_name,
  middle_name,
  last_name,
  contact_number,
  connection = pool,
}) => {
  account_id = normalize(account_id);
  given_name = given_name !== undefined ? normalize(given_name) : undefined;
  middle_name = middle_name !== undefined ? normalize(middle_name) : undefined;
  last_name = last_name !== undefined ? normalize(last_name) : undefined;
  contact_number = contact_number !== undefined ? normalize(contact_number) : undefined;

  const phone_regex = /^09\d{9}$/;

  const validations = [
    { check: !account_id, message: "Invalid account id" },
    { check: contact_number && (contact_number.length > 11), message: "Contact number cannot exceed 11 number. Please refer to Philippine Phone Number format."},
    { check: contact_number && (!phone_regex.test(contact_number)), message: "Please provide a valid phone number."},
    {
      check: !isValidName(given_name, middle_name, last_name),
      message:
        "Name must be atleast 2 letter and does not contain any number or special characters!",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  const update = [];
  const values = [];

  if (given_name) {
    update.push("given_name = ?");
    values.push(given_name);
  }

  if (middle_name) {
    update.push("middle_name = ?");
    values.push(middle_name);
  } else if (middle_name === "") {
    update.push("middle_name = NULL");
  }

  if (last_name) {
    update.push("last_name = ?");
    values.push(last_name);
  }

  if (contact_number) {
    update.push("contact_number = ?");
    values.push(contact_number);
  }

  if (update.length === 0) {
    throw new AppError("Bad request", 400, ["You are not updating any field"]);
  }

  const sql = `UPDATE users SET ${update.join(", ")} WHERE account_id = ?`;
  const [result] = await connection.query(sql, [...values, account_id]);

  if (result.affectedRows === 0) {
    return { success: false };
  }

  return { success: true };
};

const getProfileOrNull = async ({ account_id, conenction = pool }) => {
  account_id = normalize(account_id);

  const validations = [
    { check: !account_id, message: "Account id must be provided and must be a numberic type" },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  const [rows] = await conenction.query(
    `
      SELECT u.public_id, u.given_name, u.middle_name, u.last_name, a.email, u.contact_number
      FROM users AS u
      JOIN accounts AS a ON a.account_id = u.account_id
      WHERE u.account_id = ?
      GROUP BY a.id;
    `,
    [account_id]
  );

  if (rows.length === 0) {
    return null;
  }

  const user_data = rows[0];

  return { data: user_data };
};

module.exports = { 
  getProfileOrNull, 
  updateProfile 
};
