const AppError = require("../utils/AppError");
const pool = require("../db");
const bcrypt = require("bcrypt");
const { isValidEmail } = require("../utils/Validator");
const { normalize } = require("../utils/DataHelper");
const { randomUUID } = require("crypto");
const { auditAction } = require("./auditService");
const { generateComplexPassword } = require("../utils/PasswordHelper");
const { ROLE } = require("../config/serverConstants");
const { generateID } = require("../utils/randomizer");

const batchRegisterAccounts = async ({
  performed_by,
  payload = [],
  batch_role,
  batch_department,
  batch_course,
  connection,
}) => {
  performed_by = normalize(performed_by);
  batch_role = Number(batch_role) || undefined;
  batch_course =
    batch_role === ROLE.CLIENT ? normalize(batch_course) : undefined;
  batch_department =
    batch_role === ROLE.COUNSELOR ? normalize(batch_department) : undefined;

  const validations = [
    { check: !performed_by, message: "Could not proceed with request." },
    {
      check: batch_role === ROLE.COUNSELOR && !batch_department,
      message: "Department must be provided for this type of account",
    },
    {
      check: batch_role === ROLE.CLIENT && !batch_course,
      message: "Batch course must be provided for this type of account",
    },
    {
      check: !Array.isArray(payload),
      message: "Invalid payload format.",
    },
    {
      check: Array.isArray(payload) && payload.length === 0,
      message:
        "No account to insert. Please provide atleast one account to insert.",
    },
    { check: !batch_role, message: "Accounts role must be provided" },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const invalid_accounts = [];
    const valid_accounts = [];
    const account_creds = [];
    const accounts_to_insert = [];
    const insert_value = [];
    const account_users = [];
    const account_users_value = [];
    const is_disabled = batch_role !== ROLE.CLIENT;

    if (batch_role === ROLE.CLIENT) {
      const [department_rows] = await connection.query(
        `
        SELECT d.id FROM departments AS d
        JOIN courses AS c ON c.department = d.id
        WHERE c.id = ?
        LIMIT 1
      `,
        [batch_course],
      );

      batch_department = department_rows[0].id;
    }

    for (const {
      email,
      given_name,
      middle_name,
      last_name,
      student_id,
      year_level,
    } of payload) {
      const normalized_email = normalize(email);
      const normalized_given = normalize(given_name);
      const normalized_middle = normalize(middle_name);
      const normalized_last = normalize(last_name);
      const normalized_student_id =
        batch_role === ROLE.CLIENT ? normalize(student_id) : undefined;
      const year_level_norm =
        batch_role === ROLE.CLIENT
          ? Number(year_level) || undefined
          : undefined;

      const validations = [
        {
          check: batch_role === ROLE.CLIENT && !normalized_student_id,
          message: "student id must be provided",
        },
        {
          check:
            batch_role === ROLE.CLIENT &&
            normalized_student_id &&
            normalized_student_id.length > 14,
          message: "Student ID must not exceed 14 char.",
        },
        {
          check: !isValidEmail(normalized_email, process.env.CLIENT_DOMAIN),
          message: "Invalid email format",
        },
        { check: !normalized_given, message: "Given name must be provided" },
        { check: !normalized_last, message: "Last name must be provided" },
        { check: !year_level_norm, message: "Invalid year level." },
      ];

      const validation_errors = validations
        .filter((v) => v.check)
        .map((v) => v.message);

      if (validation_errors.length > 0) {
        invalid_accounts.push({
          email: normalized_email,
          given_name: normalized_given,
          middle_name: normalized_middle,
          last_name: normalized_last,
          errors: validation_errors,
        });

        continue;
      }

      const [existing] = await connection.query(
        `SELECT account_id FROM accounts WHERE email = ?`,
        [normalized_email],
      );

      const account_id =
        existing.length > 0 ? existing[0].account_id : randomUUID();
      const is_new = existing.length === 0;
      const password = generateComplexPassword({});
      const salt_rounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;
      const hashed_password = await bcrypt.hash(password, salt_rounds);

      accounts_to_insert.push("(?, ?, ?, ?, ?, ?)");
      insert_value.push(
        account_id,
        normalized_email,
        hashed_password,
        batch_role,
        true,
        is_disabled,
      );

      const public_id = normalized_student_id;
      account_users.push("(?, ?, ?, ?, ?, ?, ?, ?)");
      account_users_value.push(
        account_id,
        public_id,
        normalized_given,
        normalized_middle,
        normalized_last,
        batch_department,
        batch_course,
        year_level_norm,
      );

      valid_accounts.push({
        account_id,
        email,
        given_name,
        middle_name,
        last_name,
      });

      if (is_new) {
        account_creds.push({
          email,
          password,
        });
      }
    }

    const failed_total = invalid_accounts.length;

    if (accounts_to_insert.length === 0) {
      return {
        success_total: 0,
        failed_total,
        success: valid_accounts,
        failed: invalid_accounts,
        inserted_cred: account_creds,
      };
    }

    const [account_insert] = await connection.query(
      `
        INSERT INTO accounts(account_id, email, password, role, is_verified, is_disabled) 
        VALUES ${accounts_to_insert.join(", ")}
        ON DUPLICATE KEY UPDATE
          role = VALUES(role),
          is_disabled = VALUES(is_disabled)
      `,
      insert_value,
    );

    await connection.query(
      `
        INSERT INTO users(account_id, public_id, given_name, middle_name, last_name, department_id, course, year_level) 
        VALUES ${account_users.join(", ")}
        ON DUPLICATE KEY UPDATE
          public_id = VALUES(public_id),
          given_name = VALUES(given_name),
          middle_name = VALUES(middle_name),
          last_name = VALUES(last_name),
          department_id = VALUES(department_id),
          course = VALUES(course),
          year_level = VALUES(year_level)
      `,
      account_users_value,
    );

    const success_total = account_insert.affectedRows;
    const inserted_ids = accounts_to_insert.map((_, i) => insert_value[i * 6]);

    await auditAction({
      action: "CREATE",
      resource: "ACCOUNT",
      entity_id: inserted_ids,
      performed_by: performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return {
      success_total,
      failed_total,
      success: valid_accounts,
      failed: invalid_accounts,
      inserted_cred: account_creds,
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const batchArchive = async ({
  performed_by,
  payload = [],
  connection = pool,
}) => {
  performed_by = normalize(performed_by);

  const validations = [
    { check: !performed_by, message: "Could not proceed with request." },
    {
      check: !Array.isArray(payload),
      message: "Invalid payload format.",
    },
    {
      check: Array.isArray(payload) && payload.length === 0,
      message:
        "No account to archive. Please provide atleast one account to archive.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  const accounts_to_update = [];

  for (const { email } of payload) {
    accounts_to_update.push(email);
  }

  await connection.query(
    `
    UPDATE accounts SET is_archived = ?
    WHERE email IN (?)
  `,
    [true, accounts_to_update],
  );

  return { data: {}, total_archived: payload.length };
};

const registerAccount = async ({
  email,
  role,
  given_name,
  middle_name,
  last_name,
  performed_by,
  connection,
  student_id,
  year_level,
  course,
  department,
}) => {
  email = normalize(email)?.toLowerCase();
  const password = generateComplexPassword({});
  role = Number(role);
  year_level = role === ROLE.CLIENT ? Number(year_level) : undefined;
  course = role === ROLE.CLIENT ? normalize(course) : undefined;
  given_name = normalize(given_name);
  middle_name = normalize(middle_name);
  last_name = normalize(last_name);
  student_id = normalize(student_id);
  performed_by = normalize(performed_by);
  department = role === ROLE.COUNSELOR ? normalize(department) : undefined;

  const validations = [
    {
      check: role === ROLE.CLIENT && student_id && student_id.length > 14,
      message: "Maximum length of student id must not exceed 14 characters",
    },
    {
      check: role === ROLE.CLIENT && !course,
      message: "Course must be provided for Student type account",
    },
    {
      check: role === ROLE.CLIENT && !year_level,
      message: "Year Level must be provided of type Student",
    },
    {
      check: role === ROLE.COUNSELOR && !department,
      message: "Department must be provided for this type of account",
    },
    {
      check: !performed_by,
      message: "Performer must be identified before inserting.",
    },
    {
      check: role === ROLE.CLIENT && !student_id,
      message: "Student ID must be provided of type Student",
    },
    {
      check: email && !isValidEmail(email),
      message: `Email cannot be empty, must follow the standard email format`,
    },
    {
      check: !given_name,
      message: "Given name of user must be provided.",
    },
    {
      check: !last_name,
      message: "Last name must be provided",
    },
    {
      check: !role,
      message: "Role cannot be empty and must be a valid system role!",
    },
    {
      check: !email.endsWith(
        process.env.CLIENT_DOMAIN || "@citycollegeoftagaytay.edu.ph",
      ),
      message: "Could not register an account outside the school institution.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);

  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
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
      SELECT EXISTS(
        SELECT 1 FROM accounts WHERE email = ?
      ) AS exist  `,
      [email],
    );

    if (rows[0].exist === 1) {
      throw new AppError("Email is already registered to an account!", 400);
    }

    if (role === ROLE.CLIENT) {
      const [department_rows] = await connection.query(
        `
        SELECT d.id FROM departments AS d
        JOIN courses AS c ON c.department = d.id
        WHERE c.id = ?
        LIMIT 1
      `,
        [course],
      );

      department = department_rows[0].id;
    }

    const salt_rounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const hashed_password = await bcrypt.hash(password, salt_rounds);

    const account_id = randomUUID();
    const is_disabled = role !== ROLE.CLIENT;

    await connection.query(
      `
      INSERT INTO accounts(account_id, email, password, role, is_disabled) 
      VALUES(?, ?, ?, ?, ?) 
      `,
      [account_id, email, hashed_password, role, is_disabled],
    );

    const public_id =
      role === ROLE.CLIENT ? student_id : await generateID({ connection });

    await createUser({
      account_id: account_id,
      public_id: public_id,
      given_name: given_name,
      middle_name: middle_name,
      last_name: last_name,
      department: department,
      course: course,
      year_level,
      connection: connection,
    });

    await auditAction({
      action: "CREATE",
      resource: "ACCOUNT",
      entity_id: [account_id],
      performed_by: performed_by,
      connection: connection,
    });

    if (self_conn) {
      await connection.commit();
    }

    return {
      data: {
        id: account_id,
        email: email,
        given_name,
        middle_name,
        last_name,
        password,
      },
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const createAccountWithGoogle = async ({ payload, connection }) => {
  if (!payload) {
    throw new AppError("Data must be provided for account creation!", 400);
  }

  const sub = normalize(payload.sub);
  const email = normalize(payload.email)?.toLowerCase();
  const given_name = normalize(payload.given_name) || "User";
  const last_name = normalize(payload.family_name);
  const role = Number(payload.role);

  const validations = [
    {
      check: !isValidEmail(email, process.env.CLIENT_DOMAIN),
      message: `Email cannot be empty, must follow the standard email format and must be in the organization ${process.env.CLIENT_DOMAIN}`,
    },
    {
      check: !sub,
      message: "Google sub id is required!",
    },
    {
      check: !role,
      message: "Role cannot be empty and must be a valid system role!",
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
    const account_id = randomUUID();
    const public_id = randomUUID();

    // Insert account in database
    const [result] = await connection.query(
      `
      INSERT INTO accounts(account_id, email, google_sub, role, is_verified) 
      VALUES (?, ?, ?, ?, ?)
      `,
      [account_id, email, sub, role, 1],
    );

    await createUser({
      account_id: account_id,
      public_id: public_id,
      given_name: given_name,
      last_name: last_name,
      connection: connection,
    });

    if (self_conn) await connection.commit();

    return { account_id: account_id, email: email, sub: sub, role: role };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const updateAccount = async ({
  performer_id,
  account_id,
  email,
  year_level,
  course,
  department,
  public_id,
  given_name,
  middle_name,
  last_name,
  role,
  affected_roles,
  connection,
}) => {
  account_id = normalize(account_id);
  email = email !== undefined ? normalize(email) : undefined;
  year_level = Number(year_level);
  course = normalize(course);
  department = normalize(department);
  public_id = normalize(public_id);
  given_name = given_name !== undefined ? normalize(given_name) : undefined;
  affected_roles = affected_roles ?? [];
  const normalized_middle_name =
    middle_name !== undefined ? normalize(middle_name) : undefined;
  middle_name =
    normalized_middle_name !== undefined
      ? normalized_middle_name !== ""
        ? normalized_middle_name
        : null
      : undefined;
  last_name = last_name !== undefined ? normalize(last_name) : undefined;
  role = role !== undefined ? Number(role) : undefined;
  const name_regex = /[^a-zA-Z ]/g;

  const validations = [
    { check: !account_id, message: "Account id must be provided" },
    {
      check: !Array.isArray(affected_roles),
      message: "Role check must be an array.",
    },
    {
      check:
        email !== undefined && !isValidEmail(email, process.env.CLIENT_DOMAIN),
      message: "Email format must be followed set by the organization.",
    },
    {
      check: given_name !== undefined && name_regex.test(given_name),
      message: "Given name must only contain letters (A-Z or a-z).",
    },
    {
      check:
        (given_name !== undefined && given_name?.length > 50) ||
        given_name?.length < 3,
      message:
        "Given name must not exceed 50 characters and atleast 3 characters.",
    },
    {
      check:
        middle_name !== undefined &&
        middle_name !== null &&
        name_regex.test(middle_name),
      message: "Middle name must only contain letters (A-Z or a-z).",
    },
    {
      check:
        (middle_name !== undefined &&
          middle_name !== null &&
          middle_name?.length > 50) ||
        middle_name?.length < 2,
      message:
        "Middle name must not exceed 50 characters and atleast 3 characters.",
    },
    {
      check: last_name !== undefined && name_regex.test(last_name),
      message: "Last name must only contain letters (A-Z or a-z).",
    },
    {
      check:
        (last_name !== undefined && last_name?.length > 50) ||
        given_name?.length < 3,
      message:
        "Last name must not exceed 50 characters and atleast 3 characters.",
    },
    {
      check: role !== undefined && isNaN(role),
      message: "Role must be provided as number.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, [validation_errors]);
  }

  const user_update = [];
  const user_update_value = [];

  const [account_rows] = await pool.query(
    `
    SELECT u.public_id, a.role
    FROM accounts AS a
    JOIN users AS u ON u.account_id = a.account_id
    WHERE u.account_id = ? ${affected_roles.length > 0 ? ` AND a.role IN (${affected_roles.map(() => "?").join(",")})` : ""}
    LIMIT 1
      `,
    [performer_id, account_id, ...affected_roles],
  );

  const account = account_rows[0];

  if (!account) {
    throw new AppError(
      "Could not find the account youre trying to update.",
      400,
    );
  }

  if (given_name !== undefined) {
    user_update.push("given_name = ?");
    user_update_value.push(given_name);
  }

  if (middle_name !== undefined) {
    user_update.push("middle_name = ?");
    user_update_value.push(middle_name);
  }

  if (last_name !== undefined) {
    user_update.push("last_name = ?");
    user_update_value.push(last_name);
  }

  if (!isNaN(year_level)) {
    if (account.role === ROLE.CLIENT) {
      user_update.push("year_level = ?");
      user_update_value.push(year_level);
    }
  }

  if (department !== undefined) {
    if (account.role === ROLE.COUNSELOR) {
      user_update.push("department_id = ?");
      user_update_value.push(department);
    }
  }

  if (course !== undefined) {
    if (account.role === ROLE.CLIENT) {
      user_update.push("course = ?");
      user_update_value.push(course);

      const [course_rows] = await pool.query(
        `
        SELECT department
        FROM courses
        WHERE id = ?
        LIMIT 1
      `,
        [course],
      );

      const course_data = course_rows[0];

      department = course_data.department;

      user_update.push("department_id = ?");
      user_update_value.push(department);
    }
  }

  if (public_id !== undefined) {
    user_update.push("public_id = ?");
    user_update_value.push(public_id);
  }

  const account_update = [];
  const account_update_value = [];

  if (email !== undefined) {
    account_update.push("email = ?");
    account_update_value.push(email);
  }

  if (role !== undefined) {
    if (performer_id === account_id) {
      throw new AppError("Cannot change your own role.");
    }
    
    account_update.push("role = ?");
    account_update_value.push(role);
  }

  if (user_update.length === 0 && account_update.length === 0) {
    throw new AppError("Youre not updating anything.", 400);
  }

  if (user_update?.length === 0 && account_update?.length === 0) {
    throw new AppError("No field to update.");
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    if (user_update.length > 0) {
      await connection.query(
        `
        UPDATE users
        SET ${user_update.join(",")}
        WHERE public_id = ?
      `,
        [...user_update_value, account.public_id],
      );
    }

    if (account_update.length > 0) {
      if (role !== undefined) {
        const [rows] = await connection.query(
          `
          SELECT 1 FROM roles
          WHERE id = ?
          LIMIT 1
        `,
          [role],
        );

        if (rows.length === 0) {
          throw new AppError("Invalid system role!", 400);
        }
      }

      await connection.query(
        `
        UPDATE accounts
        SET ${account_update.join(",")}
        WHERE account_id = ?
      `,
        [...account_update_value, account_id],
      );
    }

    await auditAction({
      action: "UPDATE",
      resource: "ACCOUNTS",
      entity_id: [account_id],
      performed_by: performer_id,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { account_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const createUser = async ({
  account_id,
  public_id,
  given_name,
  middle_name,
  last_name,
  department,
  course,
  year_level,
  connection = pool,
}) => {
  account_id = normalize(account_id);
  given_name = normalize(given_name) || "User";
  middle_name = normalize(middle_name);
  last_name = normalize(last_name);
  public_id = normalize(public_id);
  department = normalize(department);
  course = normalize(course);
  year_level = Number(year_level) || undefined;

  if (!account_id) {
    throw new AppError("BAD REQUEST!", 400, [
      "Account id cannot be empty and must be numeric!",
    ]);
  }

  await connection.query(
    `INSERT INTO users(account_id, public_id, given_name, middle_name, last_name, department_id, course, year_level) 
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account_id,
      public_id,
      given_name,
      middle_name,
      last_name,
      department,
      course,
      year_level,
    ],
  );

  return { success: true };
};

const getAccounts = async ({
  self_account_id,
  search,
  roles,
  archived,
  page,
  limit,
  connection = pool,
}) => {
  search = normalize(search)?.toLowerCase();
  roles = roles?.split(",").map(Number);
  archived = archived === "1" ? 1 : 0;
  limit = !isNaN(limit) ? Number(limit) : 10;
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  const offset = (page - 1) * limit;

  const conditions = ["accounts.role != ?"];
  const values = [ROLE.SUPER_ADMIN];

  if (roles !== undefined && roles.length > 0) {
    conditions.push(`role IN (${roles.map(() => "?").join(",")})`);
    values.push(...roles);
  }

  if (archived !== undefined) {
    conditions.push("accounts.is_archived = ?");
    values.push(archived ? archived : 0);
  }

  if (search !== undefined) {
    conditions.push(
      "(LOWER(accounts.account_id) LIKE ? OR LOWER(accounts.email) LIKE ?)",
    );
    values.push(`%${search}%`, `%${search}%`);
  }

  let sql = `
    SELECT users.given_name, users.middle_name, users.last_name, users.public_id AS user_id, accounts.account_id, users.department_id, users.course, users.year_level, users.public_id,
      accounts.role AS role_id, r.name AS role_name, accounts.email, accounts.is_archived, accounts.is_verified, accounts.is_disabled,
      COUNT(*) OVER() AS total_count
    FROM accounts
    JOIN users ON users.account_id = accounts.account_id
    JOIN roles AS r ON r.id = accounts.role
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY accounts.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await connection.query(sql, [...values, limit, offset]);

  const total = rows[0]?.total_count;
  const total_pages = Math.ceil(total / limit);

  return { data: rows, total_pages, total, page };
};

const getAccountData = async ({ account_id, connection = pool }) => {
  account_id = normalize(public_id);

  const validations = [
    { check: !account_id, message: "Account public id must be provided" },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  const [account_rows] = await connection.query(
    `
    SELECT accounts.email, accounts.role AS role_id, r.name AS role_name, accounts.is_archived, accounts.is_disabled, is_verified,
      users.given_name, users.middle_name, users.last_name, users.public_id
    FROM accounts
    JOIN roles AS r ON r.id = accounts.role
    JOIN users ON users.account_id = accounts.account_id
    LIMIT 1
  `,
    [],
  );

  const account = account_rows[0];

  return { data: account || {} };
};

const archiveAccount = async ({
  account_id,
  is_archived,
  performed_by,
  connection,
}) => {
  account_id = normalize(account_id);
  performed_by = normalize(performed_by);

  const validations = [
    { check: !account_id, message: "Account public id must be provided" },
    {
      check: typeof is_archived !== "boolean",
      message: "Archive flag must be provided and must be boolean",
    },
    {
      check: !performed_by,
      message: "Account ID of the performer must be provided.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  // Barrow a single connection from the pool for a transaction
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [account_update] = await connection.query(
      `
      UPDATE accounts 
      SET is_archived = ?
      WHERE accounts.account_id = ?
    `,
      [is_archived, account_id, true],
    );

    if (account_update.affectedRows === 0) {
      throw new AppError(
        "Could not archive the account. Please check the provided ID or try again.",
        400,
      );
    }

    await auditAction({
      action: is_archived ? "ARCHIVE" : "UNARCHIVE",
      resource: "ACCOUNTS",
      entity_id: [account_id],
      performed_by: performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { account_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const disableAccount = async ({
  account_id,
  is_disabled,
  performed_by,
  connection,
}) => {
  account_id = normalize(account_id);
  performed_by = normalize(performed_by);

  const validations = [
    { check: !account_id, message: "Account public id must be provided" },
    {
      check: typeof is_disabled !== "boolean",
      message: "Disable flag must be provided and must be boolean",
    },
    {
      check: !performed_by,
      message: "Account ID of the performer must be provided.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("BAD REQUEST!", 400, validation_errors);
  }

  // Barrow a single connection from the pool for a transaction
  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [account_update] = await connection.query(
      `
      UPDATE accounts 
      SET is_disabled = ?
      WHERE accounts.account_id = ?
    `,
      [is_disabled, account_id, true],
    );

    if (account_update.affectedRows === 0) {
      throw new AppError(
        "Could not disable the account. Please check the provided ID or try again.",
        400,
      );
    }

    await auditAction({
      action: is_disabled ? "DISABLE" : "ENABLE",
      resource: "ACCOUNT",
      entity_id: [account_id],
      performed_by: performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { account_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

module.exports = {
  createUser,
  registerAccount,
  createAccountWithGoogle,
  getAccounts,
  getAccountData,
  archiveAccount,
  updateAccount,
  disableAccount,
  batchRegisterAccounts,
  batchArchive,
};
