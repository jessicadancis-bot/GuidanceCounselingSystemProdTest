const { STATUS, ROLE } = require("../config/serverConstants");
const pool = require("../db");
const AppError = require("../utils/AppError");
const { DateTime } = require("luxon");
const { normalize } = require("../utils/DataHelper");
const { validateQuestionaire } = require("../utils/QuestionaireHelper");
const { auditAction } = require("./auditService");
const { SESSION_TIME_RANGE } = require("../config/applicationConfig");
const {
  generateReferenceID,
  generateCaseID,
  generateCaseSessionID,
} = require("../utils/randomizer");
const {
  requestCreated,
  sendNotificationPing,
  notifyCaseUpdate,
} = require("../websocket");
const { sendEmail } = require("../utils/emails");
const { encryptCaseField, decryptCaseField } = require("../utils/Encryptor");

const referClient = async ({
  referrer_name,
  referrer_contact,
  client_name,
  relation,
  reason,
  client_public_id,
  course,
  section,
  connection,
}) => {
  referrer_name = normalize(referrer_name);
  client_name = normalize(client_name);
  relation = normalize(relation);
  reason = normalize(reason);
  client_public_id = normalize(client_public_id);
  section = normalize(section);
  referrer_contact = normalize(referrer_contact);

  const validations = [
    {
      check: !referrer_name,
      message: "Referrer name must be provided",
    },
    {
      check: !referrer_contact,
      message: "Referrer contact must be provided",
    },
    {
      check: client_public_id && client_public_id.length > 45,
      message:
        "Student ID exceeded the maximum 45 char. Please make sure you have the correct student id.",
    },
    {
      check: !client_name,
      message: "Client name must be provided",
    },
    {
      check: !reason,
      message: "Reason for referral must be stated.",
    },
    {
      check: !course,
      message: "Course of the client being referred must be provided.",
    },
  ];

  const errors = validations.filter((v) => v.check).map((v) => v.message);
  if (errors.length > 0) throw new AppError("Validation errors", 400, errors);

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const to_insert = [
      "referrer_name",
      "client_name",
      "reason",
      "course",
      "referrer_contact",
    ];
    const to_insert_val = [
      referrer_name,
      client_name,
      reason,
      course,
      referrer_contact,
    ];

    if (client_public_id) {
      to_insert.push("student_id");
      to_insert_val.push(client_public_id);
    }

    if (relation) {
      to_insert.push("relation");
      to_insert_val.push(relation);
    }

    if (section) {
      to_insert.push("section");
      to_insert_val.push(section);
    }

    await connection.query(
      `
      INSERT INTO referrals (${to_insert.join(", ")})
      VALUES (${to_insert.map(() => "? ").join(", ")})
    `,
      [...to_insert_val],
    );

    if (self_conn) await connection.commit();
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getReferrals = async ({
  page,
  limit,
  search,
  status,
  account_id,
  connection = pool,
}) => {
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  limit = Number(limit) || 0;
  const offset = (page - 1) * limit;

  const where_cl = [];
  const where_cl_val = [];

  if (status) {
    const s = status
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n));
    if (s.length > 0) {
      const placeholders = s.map(() => "?").join(",");
      where_cl.push(`r.status IN (${placeholders})`);
      where_cl_val.push(...s);
    }
  }

  if (account_id) {
    where_cl.push("r.handler = ?");
    where_cl_val.push(account_id);
  }

  const [referral_rows] = await connection.query(
    `
    SELECT r.id, r.client_name, r.referrer_name, r.reason, r.relation, r.section, r.student_id, r.referrer_contact,
           c.id AS course_id, c.name AS course_name, COUNT(*) OVER() AS total_count
    FROM referrals AS r
    LEFT JOIN courses AS c 
      ON c.id = r.course
    ${where_cl.length > 0 ? `WHERE ${where_cl.join(" AND ")}` : ""}
    ${limit && limit > 0 ? "LIMIT ? OFFSET ?" : ""}
  `,
    [...where_cl_val, limit, offset],
  );

  const total = referral_rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  return { data: referral_rows, total, total_pages };
};

const handleReferral = async ({
  account_id,
  referral_id,
  connection = pool,
}) => {
  account_id = normalize(account_id);
  referral_id = normalize(referral_id);

  const validations = [
    {
      check: !account_id,
      message: "Could not proceed with your request",
    },
    {
      check: !referral_id,
      message:
        "Please provide the ID of the referral you are trying to handle.",
    },
  ];

  const errors = validations.filter((v) => v.check).map((v) => v.message);
  if (errors.length > 0) throw new AppError("Validation errors", 400, errors);

  const [results] = await connection.query(
    `
    UPDATE referrals SET status = ?, handler = ?
    WHERE status = ? AND id = ?
  `,
    [STATUS.ACCEPTED, account_id, STATUS.PENDING, referral_id],
  );
};

const closeReferral = async ({ referral_id, connection = pool }) => {
  const validations = [
    {
      check: !referral_id,
      message: "Referral ID must be provided.",
    },
  ];

  const errors = validations.filter((v) => v.check).map((v) => v.message);
  if (errors.length > 0) throw new AppError("Validation errors", 400, errors);

  const [res] = await connection.query(
    `
    UPDATE referrals SET status = ?
    WHERE id = ?
  `,
    [STATUS.TERMINATED, referral_id],
  );
};

const requestCounseling = async ({
  questionaire_answers,
  user_informations,
  account_id,
  counseling_type,
  preferred_date,
  preferred_time,
  type,
  connection,
}) => {
  counseling_type = Number(counseling_type);
  account_id = normalize(account_id);
  type = normalize(type);
  user_informations =
    typeof user_informations !== "object" ? {} : user_informations;
  questionaire_answers =
    typeof questionaire_answers !== "object" ? {} : questionaire_answers;

  const preferred_ph = DateTime.fromISO(`${preferred_date}T${preferred_time}`, {
    zone: "Asia/Manila",
  });

  if (!preferred_ph.isValid) {
    throw new AppError("Preferred date must be a valid datetime string.", 400);
  }

  const questionaire_filled = await validateQuestionaire({
    questionaire_answers,
  });

  const today_ph = DateTime.now().setZone("Asia/Manila");
  const max_allowed_ph = today_ph.plus({ days: 14 });
  const min_allowed_ph = today_ph.plus({ minutes: 30 });

  const validations = [
    {
      check: ![0, 30].includes(preferred_ph.minute),
      message: "Preferred time must be at the hour or half-hour (e.g., 8:00, 8:30)."
    },
    { check: !user_informations.section, message: "Section must be provided" },
    {
      check: !type,
      message: "Type of request must be provided",
    },
    {
      check: type && !["referred", "requested"].includes(type),
      message: "Type of request must be either 'referred' or 'requested'",
    },
    {
      check:
        user_informations.reason &&
        typeof user_informations.reason !== "string",
      message: "Reason must be text",
    },
    {
      check:
        preferred_ph &&
        (preferred_ph < min_allowed_ph || preferred_ph > max_allowed_ph),
      message:
        "Preferred date must be 30 min ahead of schedule and  within the next 14 days.",
    },
    {
      check:
        preferred_ph &&
        (preferred_ph.hour < SESSION_TIME_RANGE.from ||
          preferred_ph.hour > SESSION_TIME_RANGE.to),
      message: "Preferred time must be be between 8AM to 6PM",
    },
    { check: !account_id, message: "Account ID cannot be empty!" },
    {
      check: !counseling_type,
      message:
        "Counseling type cannot be empty! Allowed: [1=virtual,2=face_to_face]",
    },
    {
      check: !questionaire_filled.valid,
      message: "Please fill up all required questions.",
    },
  ];

  const errors = validations.filter((v) => v.check).map((v) => v.message);
  if (errors.length > 0) throw new AppError("Validation errors", 400, errors);

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [request_count] = await connection.query(
      `SELECT COUNT(*) AS total FROM counseling_requests WHERE client_id = ? AND status = ?`,
      [account_id, STATUS.PENDING],
    );

    if (request_count[0].total >= 3) {
      throw new AppError("Maximum pending requests reached (3).", 400);
    }

    const reference_id = await generateReferenceID({ account_id, connection });

    const columns = [
      "reference_id",
      "client_id",
      "preferred_counseling_type",
      "status",
      "preferred_date",
      "type",
    ];
    const values = [
      reference_id,
      account_id,
      counseling_type,
      STATUS.PENDING,
      preferred_ph.toFormat("yyyy-LL-dd HH:mm:ss"),
      type,
    ];

    const placeholders = columns.map(() => "?").join(",");
    await connection.query(
      `INSERT INTO counseling_requests (${columns.join(",")}) VALUES (${placeholders})`,
      values,
    );

    if (Object.keys(questionaire_filled.answer_map).length) {
      const crq_a_values = [];

      for (const [question_text, ans] of Object.entries(
        questionaire_filled.answer_map,
      )) {
        crq_a_values.push([reference_id, question_text, encryptCaseField(ans)]);
      }

      await connection.query(
        `INSERT INTO counseling_request_questionaire_answers (request_reference_id, question, answer)
        VALUES ${crq_a_values.map(() => "(?, ?, ?)").join(",")}`,
        crq_a_values.flat(),
      );
    }

    await connection.query(
      `INSERT INTO request_client_informations
       (request_reference_id, section, reason)
       VALUES (?, ?, ?)`,
      [
        reference_id,
        user_informations.section,
        encryptCaseField(user_informations.reason) || null,
      ],
    );

    if (self_conn) await connection.commit();

    requestCreated();

    return {
      data: {
        reference_id,
        preferred_date: preferred_ph.toFormat("yyyy-LL-dd HH:mm:ss"), // PH time preserved
        type: counseling_type,
        status_id: STATUS.PENDING,
        status_name: "pending",
      },
    };
  } catch (err) {
    if (self_conn) await connection.rollback();
    throw err;
  } finally {
    if (self_conn) connection.release();
  }
};

const cancelCounselingRequest = async ({
  reference_id,
  account_id,
  connection,
}) => {
  reference_id = normalize(reference_id);
  account_id = normalize(account_id);

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [results] = await connection.query(
      `
        UPDATE counseling_requests 
        SET status = ?
        WHERE reference_id = ? AND client_id = ? AND status = ?
      `,
      [STATUS.CANCELED, reference_id, account_id, STATUS.PENDING],
    );

    if (results.affectedRows === 0) {
      throw new AppError(
        "Could not find the request that you are trying to cancel.",
        400,
      );
    }

    if (self_conn) await connection.commit();

    return { data: { reference_id, success: true } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getClientCounselingRequests = async ({
  client_id,
  status,
  request_reference_id,
  connection = pool,
}) => {
  client_id = normalize(client_id);
  request_reference_id = normalize(request_reference_id);
  status = status?.split(",") || [];

  const validations = [
    {
      check: !client_id,
      message: "Account id of the one requesting it must be provided!",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0)
    throw new AppError("BAD REQUEST", 400, validation_errors);

  const where_claus = [];
  const value = [];

  if (status?.length > 0) {
    where_claus.push("cs.status IN (?)");
    value.push(status);
  }

  if (request_reference_id) {
    where_claus.push("cs.reference_id = ?");
    value.push(request_reference_id);
  }

  const [rows] = await connection.query(
    `
      SELECT 
        cs.reference_id, 
        DATE_FORMAT(cs.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(cs.preferred_date, '%Y-%m-%d %H:%i:%s') AS preferred_date,
        s.name AS status_name, s.id AS status_id, ct.name AS type
      FROM counseling_requests AS cs
      JOIN status AS s ON s.id = cs.status
      JOIN counseling_type AS ct ON ct.id = cs.preferred_counseling_type
      WHERE cs.client_id = ? ${
        where_claus.length > 0 ? "AND " + where_claus.join(" AND ") : ""
      }
      ORDER BY created_at DESC
    `,
    [client_id, ...value],
  );

  return { data: rows };
};

const getCases = async ({
  counselor_id,
  client_id,
  client_public_id,
  case_id,
  status,
  search,
  page,
  limit,
  connection = pool,
}) => {
  counselor_id = normalize(counselor_id);
  case_id = normalize(case_id);
  status = status?.split(",").map(Number);
  search = normalize(search)?.toLowerCase();
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  limit = Number(limit) || 0;
  const offset = (page - 1) * limit;

  const condition = [];
  const value = [];

  if (counselor_id) {
    condition.push("ccl.counselor_id = ?");
    value.push(counselor_id);
  }

  if (client_id) {
    condition.push("client.account_id = ?");
    value.push(client_id);
  }

  if (client_public_id) {
    condition.push("client.public_id = ?");
    value.push(client_public_id);
  }

  if (status !== undefined && status.length > 0) {
    condition.push(`cc.status IN (${status.map(() => "?").join(",")})`);
    value.push(...status);
  }

  if (search !== undefined) {
    condition.push(
      `(LOWER(cc.case_id) LIKE ? OR LOWER(client.public_id) LIKE ?)`,
    );
    value.push(`%${search}%`, `%${search}%`);
  }

  if (case_id) {
    condition.push("cc.case_id = ?");
    value.push(case_id);
  }

  const [case_rows] = await connection.query(
    `
    SELECT
      COUNT(*) OVER() AS total_count,

      cc.case_id,
      cc.request_reference_id,

      request.type AS request_type,
      request.referred_by,

      DATE_FORMAT(cc.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      DATE_FORMAT(cc.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,

      rci.section,
      c.name AS course,
      rci.reason,

      cst.id AS counseling_type_id,
      cst.name AS counseling_type_name,

      cc.assessment,
      cc.notes,
      cc.outcome,
      cc.severity_level,
      sl.name AS severity_name,

      s.name AS status_name,
      s.id AS status_id,

      client.public_id AS client_id,
      client.given_name AS client_given_name,
      client.middle_name AS client_middle_name,
      client.last_name AS client_last_name,
      client.year_level,

      CONCAT(
          counselor.given_name, ' ',
          COALESCE(counselor.middle_name, ''),
          '',
          counselor.last_name
      ) AS counselor_name,

      CONCAT(
          client.given_name, ' ',
          COALESCE(client.middle_name, ''),
          ' ',
          client.last_name
      ) AS client_name,

      DATE_FORMAT(cs_next.next_meeting_date, '%Y-%m-%d %H:%i:%s') AS next_meeting,
      DATE_FORMAT(cs_next.next_meeting_end, '%Y-%m-%d %H:%i:%s') AS next_meeting_end,
      cs_next.room_id,
      cs_next.session_id,
      (
        SELECT COUNT(*)
        FROM case_collaborators AS cc_count
        WHERE cc_count.case_id = cc.case_id
      ) AS collaborator_count
      ${counselor_id ? ", ccl.role AS case_role" : ""}

    FROM counseling_cases AS cc
    ${
      counselor_id
        ? `JOIN case_collaborators AS ccl 
        ON ccl.case_id = cc.case_id`
        : ""
    }
    LEFT JOIN counseling_requests AS request
      ON request.reference_id = cc.request_reference_id
    LEFT JOIN request_client_informations AS rci
      ON rci.request_reference_id = request.reference_id
    JOIN status AS s
      ON s.id = cc.status
    JOIN users AS client
      ON client.account_id = request.client_id
    LEFT JOIN courses AS c
      ON c.id = client.course
    LEFT JOIN severity_levels AS sl
      ON sl.id = cc.severity_level
    LEFT JOIN counseling_type AS cst 
      ON cst.id = request.preferred_counseling_type
    LEFT JOIN (
      SELECT counselor_id, case_id
      FROM case_collaborators
      WHERE role = 'head'
    ) AS collaborator
      ON collaborator.case_id = cc.case_id
    LEFT JOIN users AS counselor 
      ON counselor.account_id = collaborator.counselor_id

    LEFT JOIN (
      SELECT
        ccs.case_id,
        ccs.session_id,
        ccs.\`from\` AS next_meeting_date,
        ccs.\`to\` AS next_meeting_end,
        svr.room_id AS room_id
      FROM counseling_case_sessions AS ccs
      LEFT JOIN (
        SELECT svr_inner.*
        FROM session_virtual_rooms AS svr_inner
        ORDER BY svr_inner.expires_at ASC
      ) AS svr
        ON svr.session_id = ccs.session_id
      LEFT JOIN (
          SELECT
            case_id,
            MIN(\`from\`) AS min_from
          FROM counseling_case_sessions
          WHERE status = 3
          GROUP BY case_id
      ) AS min_ccs
        ON ccs.case_id = min_ccs.case_id
      AND ccs.\`from\` = min_ccs.min_from
      WHERE ccs.status = 3
    ) AS cs_next
      ON cs_next.case_id = cc.case_id

    ${condition.length > 0 ? "WHERE " + condition.join(" AND ") : ""}

    ORDER BY
      cc.severity_level DESC,
      (cs_next.next_meeting_date IS NULL),
      cs_next.next_meeting_date ASC,
      cc.created_at DESC

    ${limit && limit > 0 ? "LIMIT ? OFFSET ?" : ""}
    `,
    [...value, limit, offset],
  );

  const total = case_rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  const data = case_rows?.map((c) => {
    return {
      ...c,
      outcome: decryptCaseField(c.outcome),
      notes: decryptCaseField(c.notes),
      assessment: decryptCaseField(c.assessment),
      reason: decryptCaseField(c.reason)
    };
  });

  return { data, total, total_pages, page };
};

const terminateCounselorCase = async ({
  account_id,
  outcome,
  case_id,
  connection,
}) => {
  account_id = normalize(account_id);
  outcome = normalize(outcome);
  case_id = normalize(case_id);

  const validations = [
    {
      check: !account_id,
      message: "Account ID must be provided.",
    },
    {
      check: !outcome,
      message: "Outcome of the case must be stated.",
    },
    {
      check: !case_id,
      message:
        "Case ID of the one you are trying to terminate must be provided.",
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
    const [collaborator_rows] = await connection.query(
      `
      SELECT 1 FROM case_collaborators
      WHERE counselor_id = ? AND case_id = ?
    `,
      [account_id, case_id],
    );

    if (collaborator_rows.length === 0) {
      throw new AppError(
        "Update failed. Make sure you have the right case.",
        400,
      );
    }

    const [sessions] = await connection.query(
      `
      SELECT 1 FROM counseling_case_sessions AS cs
      JOIN counseling_cases AS cc ON cc.case_id = cs.case_id
      WHERE cc.case_id = ? AND cs.status = ?
    `,
      [case_id, STATUS.ONGOING],
    );

    if (sessions.length > 0) {
      throw new AppError(
        "Please make sure that all the case session is resolved before proceeding.",
        400,
      );
    }

    await connection.query(
      `
        UPDATE counseling_cases
        SET status = ?, outcome = ?
        WHERE case_id = ? AND status = ?
      `,
      [
        STATUS.TERMINATED,
        encryptCaseField(outcome || ""),
        case_id,
        STATUS.ONGOING,
      ],
    );

    if (self_conn) await connection.commit();

    return { data: { case_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const terminateCounselorCaseSession = async ({
  account_id,
  session_id,
  case_id,
  outcome,
  connection,
}) => {
  account_id = normalize(account_id);
  session_id = normalize(session_id);
  case_id = normalize(case_id);

  const validations = [
    {
      check: !account_id,
      message: "Account ID must be provided.",
    },
    {
      check: !session_id,
      message: "ID of the session you are trying to wrap must be provided.",
    },
    {
      check: !case_id,
      message: "Case ID of the one you are trying to wrap must be provided.",
    },
    {
      check: !outcome,
      message: "Outcome must be provided.",
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
    const [case_rows] = await connection.query(
      `
      SELECT 1 FROM case_collaborators
      WHERE counselor_id = ? AND case_id = ?
    `,
      [account_id, case_id],
    );

    if (case_rows.length === 0) {
      throw new AppError(
        "Update failed. Make sure you have the right case session.",
        400,
      );
    }

    await connection.query(
      `
      UPDATE counseling_case_sessions AS s
      JOIN counseling_cases AS c ON s.case_id = c.case_id
      SET 
          s.status = ?,
          s.outcome = ?,
          s.updated_at = NOW(),
          c.updated_at = NOW()
      WHERE s.case_id = ? AND s.session_id = ? AND s.status = ?;
      `,
      [STATUS.TERMINATED, encryptCaseField(outcome), case_id, session_id, STATUS.ONGOING],
    );

    if (self_conn) await connection.commit();

    return { data: { case_id, session_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getIntakeForm = async ({ request_reference_id, connection = pool }) => {
  request_reference_id = normalize(request_reference_id);

  const validations = [
    {
      check: !request_reference_id,
      message: "Request reference id must be provided.",
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

  const [question_rows] = await connection.query(
    `
      SELECT qa.question, qa.answer
      FROM counseling_request_questionaire_answers AS qa
      WHERE qa.request_reference_id = ?
    `,
    [request_reference_id],
  );

  const [user_rows] = await connection.query(
    `
    SELECT client.given_name, client.middle_name, client.last_name
    FROM counseling_requests AS cr
    JOIN users AS client ON client.account_id = cr.client_id
    WHERE cr.reference_id = ?
    LIMIT 1
    `,
    [request_reference_id],
  );

  const question_data = question_rows?.map((q) => {
    return { ...q, answer: decryptCaseField(q.answer) };
  });
  const data = { questions: question_data, client: user_rows[0] };

  return { data: data };
};

const getCounselingRequests = async ({
  account_id,
  search,
  page,
  limit,
  status,
  request_reference_id,
  connection = pool,
}) => {
  search = normalize(search)?.toLowerCase() || undefined;
  request_reference_id = normalize(request_reference_id);

  limit = Number(limit) || 0;
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  const offset = (page - 1) * limit;

  const validations = [];

  const errors = validations.filter((v) => v.check).map((v) => v.message);
  if (errors.length) {
    throw new AppError("BAD REQUEST", 400, errors);
  }

  const query = [];
  const values = [];

  if (status) {
    query.push("cs.status = ?");
    values.push(status);
  }

  if (search) {
    query.push(`(LOWER(cs.reference_id) LIKE ? OR LOWER(u.public_id) LIKE ?)`);
    values.push(`%${search}%`, `%${search}%`);
  }

  if (request_reference_id) {
    query.push(`cs.reference_id = ?`);
    values.push(request_reference_id);
  }

  const [user_rows] = await connection.query(
    `
    SELECT department_id FROM users
    WHERE account_id = ?
    `,
    [account_id],
  );

  const account = user_rows[0] || "";

  const [rows] = await connection.query(
    `
    SELECT 
      u.given_name AS client_given_name,
      u.last_name AS client_last_name,
      u.public_id AS client_id,
      cs.reference_id,
      rci.reason,
      DATE_FORMAT(cs.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      DATE_FORMAT(cs.preferred_date, '%Y-%m-%d %H:%i:%s') AS preferred_date,
      cs.preferred_counseling_type AS type_id,
      ct.name AS type,
      s.name AS status_name,
      s.id AS status_id,
      dpt.name AS department_name, dpt.id AS department_id,
      COUNT(*) OVER() AS total_count
    FROM counseling_requests AS cs
    JOIN users AS u 
      ON u.account_id = cs.client_id
    LEFT JOIN departments AS dpt
      ON dpt.id = u.department_id
    LEFT JOIN request_client_informations AS rci 
      ON rci.request_reference_id = cs.reference_id
    LEFT JOIN status AS s 
      ON s.id = cs.status
    LEFT JOIN counseling_type AS ct 
      ON ct.id = cs.preferred_counseling_type
    ${query.length > 0 ? "WHERE " + query.join(" AND ") : ""}
    ORDER BY 
      CASE WHEN u.department_id = ? THEN 0 ELSE 1 END,
      cs.created_at ASC
    ${limit && limit > 0 ? "LIMIT ? OFFSET ?" : ""}
    `,
    [...values, account.department_id, limit, offset],
  );

  const total = rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  const data = rows.map((c) => ({
    ...c,
    reason: c.reason ? decryptCaseField(c.reason) : "",
  }));

  return { data, total, page, limit, total_pages };
};

const acceptCounselingRequest = async ({
  request_reference_id,
  counselor_id,
  connection,
}) => {
  request_reference_id = normalize(request_reference_id);
  counselor_id = normalize(counselor_id);

  const validations = [
    {
      check: !request_reference_id,
      message: "Request reference ID must be provided!",
    },
    { check: !counselor_id, message: "Counselor ID must be provided!" },
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
    const [request_rows] = await connection.query(
      `SELECT DATE_FORMAT(preferred_date, '%Y-%m-%d %H:%i:%s') AS preferred_date, 
              client_id, reference_id, preferred_counseling_type
       FROM counseling_requests
       WHERE reference_id = ? AND status = ?
       LIMIT 1
       FOR UPDATE
       `,
      [request_reference_id, STATUS.PENDING],
    );

    const request = request_rows[0];
    if (!request) {
      throw new AppError(
        "Accepting case failed. Case does not exist or is not pending.",
        400,
      );
    }

    const session_start_ph = DateTime.fromSQL(request.preferred_date, {
      zone: "Asia/Manila",
    });

    const case_id = await generateCaseID({
      reference_id: request.reference_id,
      connection,
    });

    await connection.query(
      `INSERT INTO counseling_cases (case_id, request_reference_id, status)
       VALUES (?, ?, ?)`,
      [case_id, request_reference_id, STATUS.ONGOING],
    );

    await connection.query(
      `
      INSERT INTO case_collaborators (case_id, counselor_id, role)
      VALUES (?, ?, ?)  
    `,
      [case_id, counselor_id, "head"],
    );

    await connection.query(
      `UPDATE counseling_requests
       SET status = ?, updated_at = NOW()
       WHERE reference_id = ?`,
      [STATUS.APPROVED, request_reference_id],
    );

    if (session_start_ph.isValid) {
      const meeting_date = session_start_ph.toFormat("yyyy-LL-dd");
      const meeting_time = session_start_ph.toFormat("HH:mm");

      await createCounselingCaseSession({
        case_id,
        counselor_id,
        meeting_date: meeting_date,
        meeting_time: meeting_time,
        mode: request.preferred_counseling_type,
        connection,
      });
    }

    if (self_conn) await connection.commit();

    return { data: { reference_id: request_reference_id } };
  } catch (err) {
    if (self_conn) await connection.rollback();
    throw err;
  } finally {
    if (self_conn) connection.release();
  }
};

const createCounselingCaseSession = async ({
  case_id,
  counselor_id,
  meeting_date,
  meeting_time,
  notes,
  mode,
  connection,
}) => {
  case_id = normalize(case_id);
  counselor_id = normalize(counselor_id);
  notes = normalize(notes);
  mode = Number(mode);

  const meeting_date_ph = DateTime.fromISO(`${meeting_date}T${meeting_time}`, {
    zone: "Asia/Manila",
  });

  if (!meeting_date_ph.isValid) {
    throw new AppError("Meeting date or time is invalid.", 400);
  }

  const today_ph = DateTime.now().setZone("Asia/Manila");
  const max_allowed_ph = today_ph.plus({ days: 14 });
  const session_end_ph = meeting_date_ph.plus({ hours: 1 });

  const validations = [
    {
      check: !mode,
      message: "Session mode must be provided, Either virtual or face to face",
    },
    { check: !case_id, message: "case id must be provided!" },
    { check: !counselor_id, message: "counselor id must be provided!" },
    {
      check: meeting_date_ph && meeting_date_ph > max_allowed_ph,
      message: "Preferred date and time must be within the next 14 days.",
    },
    {
      check:
        meeting_date_ph &&
        (meeting_date_ph.hour < SESSION_TIME_RANGE.from ||
          meeting_date_ph.hour > SESSION_TIME_RANGE.to),
      message: "Preferred time must be between 8 AM and 6 PM PH time.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("Validation errors", 400, validation_errors);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [case_collaborators] = await connection.query(
      `
      SELECT counselor_id FROM case_collaborators
      WHERE case_id = ? AND counselor_id = ?
      LIMIT 1
    `,
      [case_id, counselor_id],
    );

    if (case_collaborators.length === 0) {
      throw new AppError(
        "Could not create a session. Please make sure you have the right case.",
        400,
      );
    }

    const [case_rows] = await connection.query(
      `SELECT cr.client_id
       FROM counseling_cases AS cc
       LEFT JOIN counseling_requests AS cr ON cr.reference_id = cc.request_reference_id
       WHERE cc.case_id = ?
       LIMIT 1
       FOR UPDATE
       `,
      [case_id],
    );

    const case_data = case_rows[0];

    if (!case_data) {
      throw new AppError(
        "Couldn't find the case you're trying to create the session for.",
      );
    }

    const [session_rows] = await connection.query(
      `
      SELECT 1 FROM counseling_case_sessions
      WHERE case_id = ? AND status = ?
    `,
      [case_id, STATUS.ONGOING],
    );

    if (session_rows.length >= 1) {
      throw new AppError(
        "Could not create another session. Please make sure that there are no active session in this case.",
      );
    }

    const [session_row_count] = await connection.query(
      `
      SELECT COUNT(*) AS total_session
      FROM counseling_case_sessions
      WHERE case_id = ?
      LIMIT 2
    `,
      [case_id],
    );


    const total_session = session_row_count?.[0]?.total_session || 0;

    const meeting_date_db = meeting_date_ph.toFormat("yyyy-LL-dd HH:mm:ss");
    const session_end_db = session_end_ph.toFormat("yyyy-LL-dd HH:mm:ss");

    const session_id = await generateCaseSessionID({ case_id, connection });
    await connection.query(
      `INSERT INTO counseling_case_sessions
       (session_id, case_id, notes, status, \`from\`, \`to\`, session_type, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session_id,
        case_id,
        notes,
        STATUS.ONGOING,
        meeting_date_db,
        session_end_db,
        total_session >= 1 ? "follow_up" : "initial",
        mode,
      ],
    );

    await connection.query(
      `
        INSERT INTO schedules (schedule_time, reminder_sent, case_id)
        VALUES (?, ?, ?)
      `,
      [meeting_date_db, false, case_id],
    );

    if (self_conn) await connection.commit();

    return {
      data: {
        session_id,
        case_id,
        notes,
        status_id: STATUS.ONGOING,
        status_name: "ongoing",
        meeting_date,
        meeting_time,
      },
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getSeverityLevels = async ({ connection = pool }) => {
  const [severity_level_rows] = await connection.query(`
    SELECT id, name, description FROM severity_levels  
  `);

  return { data: severity_level_rows };
};

const updateCounselorCase = async ({
  account_id,
  case_id,
  severity_level,
  notes,
  assessment,
  connection,
}) => {
  account_id = normalize(account_id);
  case_id = normalize(case_id);
  notes = normalize(notes);
  severity_level = Number(severity_level) || undefined;
  assessment = normalize(assessment);

  const validations = [
    { check: !account_id, message: "Account id must be provided." },
    { check: !case_id, message: "Case id must be provided" },
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

  const to_update = [];
  const to_update_value = [];

  if (notes !== undefined) {
    to_update.push("cc.notes = ?");
    to_update_value.push(encryptCaseField(notes) || null);
  }

  if (assessment !== undefined) {
    to_update.push("cc.assessment = ?");
    to_update_value.push(encryptCaseField(assessment) || null);
  }

  if (severity_level !== undefined) {
    to_update.push("cc.severity_level = ?");
    to_update_value.push(severity_level);
  }

  if (to_update.length === 0) {
    throw new AppError("Nothing to update.", 400);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    let severity_name;
    if (severity_level !== undefined) {
      const [severity_level_rows] = await connection.query(
        `
        SELECT name FROM severity_levels
        WHERE id = ?
      `,
        [severity_level],
      );

      if (severity_level_rows.length === 0) {
        throw new AppError("Invalid severity level. Please try again");
      }

      severity_name = severity_level_rows[0].name;
    }

    await connection.query(
      `
      UPDATE counseling_cases AS cc
      JOIN case_collaborators AS ccl ON ccl.case_id = cc.case_id
      SET ${to_update.map((v) => v).join(", ")}
      WHERE ccl.counselor_id = ? AND cc.case_id = ? AND cc.status = ?
    `,
      [...to_update_value, account_id, case_id, STATUS.ONGOING],
    );

    if (self_conn) await connection.commit();

    return { data: { notes, severity_level, severity_name, assessment } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const updateCounselorCaseSession = async ({
  account_id,
  case_id,
  session_id,
  new_preferred_date,
  new_preferred_time,
  notes,
  assessment,
  intervention_plan,
  connection,
}) => {
  account_id = normalize(account_id);
  case_id = normalize(case_id);
  session_id = normalize(session_id);
  notes = normalize(notes);
  new_preferred_date = normalize(new_preferred_date) || undefined;
  new_preferred_time = normalize(new_preferred_time) || undefined;
  assessment = normalize(assessment);
  intervention_plan = normalize(intervention_plan);

  let preferred_dt;
  if (new_preferred_date && new_preferred_time) {
    preferred_dt = DateTime.fromISO(
      `${new_preferred_date}T${new_preferred_time}`,
      {
        zone: "Asia/Manila",
      },
    );

    if (!preferred_dt.isValid) {
      throw new AppError(
        "Preferred date must be a valid datetime string.",
        400,
      );
    }
  }

  const now_ph = DateTime.now().setZone("Asia/Manila");
  const max_allowed_ph = now_ph.plus({ days: 14 });

  const validations = [
    { check: !account_id, message: "Account ID must be provided." },
    { check: !case_id, message: "Case ID must be provided." },
    { check: !session_id, message: "Session ID must be provided." },
    {
      check:
        preferred_dt &&
        (preferred_dt < now_ph || preferred_dt > max_allowed_ph),
      message:
        "Preferred date and time must be within the next 14 days and cannot be in the past.",
    },
    {
      check:
        preferred_dt &&
        (preferred_dt.hour < SESSION_TIME_RANGE.from ||
          preferred_dt.hour > SESSION_TIME_RANGE.to),
      message: "Preferred time must be between 7 AM and 7 PM PH time.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("Validation errors", 400, validation_errors);
  }

  const to_update = [];
  const to_update_values = [];

  if (notes !== undefined) {
    to_update.push("notes = ?");
    to_update_values.push(encryptCaseField(notes));
  }

  if (assessment !== undefined) {
    to_update.push("assessment = ?");
    to_update_values.push(encryptCaseField(assessment));
  }

  if (intervention_plan !== undefined) {
    to_update.push("intervention_plan = ?");
    to_update_values.push(encryptCaseField(intervention_plan));
  }

  if (preferred_dt) {
    const session_end = preferred_dt.plus({ hours: 1 });
    to_update.push("`from` = ?, `to` = ?");
    to_update_values.push(
      preferred_dt.toFormat("yyyy-LL-dd HH:mm:ss"),
      session_end.toFormat("yyyy-LL-dd HH:mm:ss"),
    );
  }

  if (to_update.length === 0) {
    throw new AppError("Nothing to update.", 400);
  }

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [case_rows] = await connection.query(
      `
      SELECT 1 FROM case_collaborators
      WHERE
        counselor_id = ? 
        AND case_id = ? 
      LIMIT 1  
      `,
      [account_id, case_id, STATUS.ONGOING],
    );

    if (!case_rows.length) {
      throw new AppError(
        "Could not find the session you are trying to update.",
        400,
      );
    }

    await connection.query(
      `UPDATE counseling_case_sessions
       SET ${to_update.join(", ")}
       WHERE case_id = ? AND session_id = ? AND status = ?`,
      [...to_update_values, case_id, session_id, STATUS.ONGOING],
    );

    const [client_rows] = await connection.query(
      `
        SELECT client.email, client.account_id FROM counseling_cases AS cc
        LEFT JOIN counseling_requests AS cr ON cr.reference_id = cc.request_reference_id
        JOIN accounts AS client ON client.account_id = cr.client_id
        WHERE cc.case_id = ?
        LIMIT 1
      `,
      [case_id],
    );

    const client = client_rows[0];

    if (preferred_dt) {
      await connection.query(
        `
          UPDATE schedules
          SET schedule_time = ?, reminder_sent = FALSE
          WHERE case_id = ?
        `,
        [preferred_dt.toFormat("yyyy-LL-dd HH:mm:ss"), case_id],
      );
    }

    if (new_preferred_date || new_preferred_time) {
      const formatted_date = new_preferred_date
        ? DateTime.fromISO(new_preferred_date)
            .setZone("Asia/Manila")
            .toFormat("cccc, LLLL dd, yyyy")
        : "Unchanged";

      const formatted_time = new_preferred_time
        ? DateTime.fromISO(`1970-01-01T${new_preferred_time}`).toFormat(
            "hh:mm a",
          )
        : "Unchanged";

      const html_body = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
          <h2>Session Reschedule Notification</h2>
          <p>Dear Student,</p>
          <p>Your counseling session has been updated with the following details:</p>
          <ul>
            <li><strong>Case ID:</strong> ${case_id}</li>
            <li><strong>Session ID:</strong> ${session_id}</li>
            <li><strong>Date:</strong> ${formatted_date || "Unchanged"}</li>
            <li><strong>Time:</strong> ${formatted_time || "Unchanged"}</li>
          </ul>
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ""}
          <p>Please make sure to be available at the updated time.</p>
          <br/>
          <p>Best regards,<br/>Guidance Counseling System</p>
        </div>
      `;

      sendEmail(client.email, "Session Rescheduled", html_body);

      const message = `Your CASE ${case_id} SESSION ${session_id} has been rescheduled to ${formatted_date} ${formatted_time}`;

      await connection.query(
        `INSERT INTO notifications (account_id, message, type)
         VALUES (?, ?, ?)`,
        [client.account_id, message, "reschedule"],
      );
    }

    if (self_conn) await connection.commit();

    sendNotificationPing({ client_id: client.account_id });

    return {
      data: {
        notes,
        assessment,
        intervention_plan,
        meeting_date: preferred_dt?.toFormat("yyyy-LL-dd HH:mm:ss"),
      },
    };
  } catch (err) {
    if (self_conn) await connection.rollback();
    throw err;
  } finally {
    if (self_conn) connection.release();
  }
};

const getCaseSessions = async ({
  account_id,
  case_id,
  session_id,
  status,
  connection = pool,
}) => {
  account_id = normalize(account_id);
  case_id = normalize(case_id);
  session_id = normalize(session_id);
  const status_num = Number(status);
  status = !isNaN(status_num) ? status_num : undefined;

  const validations = [
    { check: !account_id, message: "Account ID must be provided!" },
    { check: !case_id, message: "Case ID must be provided!" },
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

  const where_condition = ["ccs.case_id = ?"];
  const wc_value = [case_id];

  if (status !== undefined) {
    where_condition.push("ccs.status = ?");
    wc_value.push(status);
  }

  if (session_id) {
    where_condition.push("ccs.session_id = ?");
    wc_value.push(session_id);
  }

  const [rows] = await connection.query(
    `
    SELECT ccs.session_id,  DATE_FORMAT(ccs.created_at, '%Y-%m-%d %H:%i:%s') as created_at, ctp.name AS mode_name, ctp.id AS mode_id,
      ccs.assessment, ccs.intervention_plan,
      s.name AS status_name, s.id AS status_id, DATE_FORMAT(ccs.\`from\`, '%Y-%m-%d %H:%i:%s') AS meeting_date,
      ccs.notes, ccs.outcome, 
      DATE_FORMAT(ccs.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at, ccs.case_id,
      svr.room_id
    FROM counseling_case_sessions AS ccs
    LEFT JOIN counseling_type AS ctp ON ctp.id = ccs.mode
    JOIN status AS s 
      ON s.id = ccs.status
    LEFT JOIN (
      SELECT svr_inner.*
      FROM session_virtual_rooms AS svr_inner
      WHERE svr_inner.expires_at > NOW()
      ORDER BY svr_inner.expires_at ASC
    ) AS svr
      ON svr.session_id = ccs.session_id
    ${
      where_condition.length > 0
        ? "WHERE " + where_condition.map((v) => v).join(" AND ")
        : ""
    }
    ORDER BY
      CASE
        WHEN s.id = ? THEN 0
        ELSE 1
      END,
      ccs.\`from\` DESC
  `,
    [...wc_value, STATUS.ONGOING],
  );

  const data = rows?.map((s) => {
    return {
      ...s,
      notes: decryptCaseField(s.notes),
      assessment: decryptCaseField(s.assessment),
      outcome: decryptCaseField(s.outcome),
      intervention_plan: decryptCaseField(s.intervention_plan)
    };
  });

  return { data };
};

const addCounselingQuestion = async ({
  question,
  performed_by,
  connection,
}) => {
  question = normalize(question);
  performed_by = normalize(performed_by);

  const validations = [
    { check: !question, message: "Question must be provided." },
    {
      check: question && typeof question !== "string",
      message: "Question must be provided as a string type.",
    },
    {
      check: question && question.length > 145,
      message: "Question must not exceed 145 in characters.",
    },
    {
      check: !performed_by,
      message: "The performer of the action must be identified.",
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
    const [question_in] = await connection.query(
      `
      INSERT INTO counseling_request_questions (question)
      VALUES (?)
    `,
      [question],
    );

    await auditAction({
      action: "CREATE",
      resource: "COUNSELING_QUESTIONS",
      entity_id: [question_in.insertId],
      performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { question } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const updateCounselingQuestion = async ({
  question_id,
  new_question,
  performed_by,
  connection,
}) => {
  new_question =
    new_question !== undefined ? normalize(new_question) : undefined;
  question_id = normalize(question_id);
  performed_by = normalize(performed_by);

  const validations = [
    {
      check: new_question !== undefined && new_question.length > 145,
      message: "New question must not exceed 145 characters",
    },
    {
      check: !question_id,
      message:
        "The id of the question you're trying to modify must be provided",
    },
    {
      check: !performed_by,
      message: "The performer of the action must be identified.",
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
    const [question_update] = await connection.query(
      `
      UPDATE counseling_request_questions
      SET question = ?, updated_at = NOW()
      WHERE id = ? AND is_archived != ?
    `,
      [new_question, question_id, true],
    );

    if (question_update.affectedRows === 0) {
      throw new AppError(
        "No quetion was updated. Please make sure that the id of of the question is valid",
        400,
      );
    }

    await auditAction({
      action: "UPDATE",
      resource: "COUNSELING_QUESTIONS",
      entity_id: [question_id],
      performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { success: true, data: { id: question_id, new_question } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) await connection.release();
  }
};

const archiveCounselingQuestion = async ({
  is_archived,
  question_id,
  performed_by,
  connection,
}) => {
  question_id = normalize(question_id);
  performed_by = normalize(performed_by);

  const validations = [
    {
      check: typeof is_archived !== "boolean",
      message: "Archive value must be set to either true or false",
    },
    {
      check: !question_id,
      message:
        "The id of the question you're trying to modify must be provided",
    },
    {
      check: !performed_by,
      message: "The performer of the action must be identified.",
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
    const [question_update] = await connection.query(
      `
      UPDATE counseling_request_questions
      SET is_archived = ?
      WHERE id = ?
    `,
      [is_archived, question_id],
    );

    if (question_update.affectedRows === 0) {
      throw new AppError(
        "No quetion was archived. Please make sure that the id of of the question is valid",
        400,
      );
    }

    await auditAction({
      action: is_archived ? "ARCHIVE" : "UNARCHIVE",
      resource: "COUNSELING_QUESTIONS",
      entity_id: [question_id],
      performed_by,
      connection,
    });

    if (self_conn) await connection.commit();

    return { success: true, data: { id: question_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) await connection.release();
  }
};

const getCounselingQuestions = async ({
  search,
  is_archived,
  limit,
  page,
  connection = pool,
}) => {
  search = normalize(search)?.toLowerCase() || undefined;
  const archive_num = Number(is_archived);
  is_archived = !isNaN(is_archived) ? archive_num : undefined;

  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  limit = Number(limit) || 0;
  const offset = (page - 1) * limit;

  const conditions = [];
  const condition_values = [];

  if (search !== undefined) {
    conditions.push("(LOWER(crq.id) LIKE ? OR LOWER(crq.question) LIKE ?)");
    condition_values.push(`%${search}%`, `%${search}%`);
  }

  if (is_archived !== undefined) {
    conditions.push("crq.is_archived = ?");
    condition_values.push(is_archived);
  }

  let query = `
    SELECT crq.id, crq.question, crq.is_archived,
           COUNT(*) OVER() AS total_count
    FROM counseling_request_questions AS crq
    ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""}
    ORDER BY crq.created_at DESC
  `;

  if (limit && limit > 0) {
    query += ` LIMIT ? OFFSET ?`;
    condition_values.push(limit, offset);
  }

  const [question_rows] = await connection.query(query, [...condition_values]);

  const total = question_rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  return { data: question_rows, total_pages, page, total };
};

const getCounselingQuestionaire = async ({ connection = pool }) => {
  const query = `
    SELECT id, question
    FROM counseling_request_questions
    WHERE is_archived != ?
    ORDER BY created_at DESC
  `;
  const [quetion_rows] = await connection.query(query, [true]);

  return { data: quetion_rows };
};

const getCounselingType = async ({ connection = pool }) => {
  const [type_rows] = await connection.query(`
    SELECT *
    FROM counseling_type
  `);

  return { data: type_rows };
};

const getCaseRecords = async ({
  search,
  limit,
  page,
  client_public_id,
  connection = pool,
}) => {
  client_public_id = normalize(client_public_id) ?? "";
  search = normalize(search)?.toLowerCase();
  limit = !isNaN(limit) ? Number(limit) : 100;
  limit = Math.min(limit, 100);
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  const offset = (page - 1) * limit;

  const validations = [];

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

  const case_rows_where = [];
  const case_rows_values = [];

  if (client_public_id) {
    case_rows_where.push("client.public_id = ?");
    case_rows_values.push(client_public_id);
  }

  if (search !== undefined) {
    case_rows_where.push(`
      client.public_id LIKE ?
      `);
    case_rows_values.push(`%${term}%`);
  }

  const [case_rows] = await connection.query(
    `
   SELECT
        rci.section, 
        c.name AS course, 
        rci.reason,
        cc.case_id,
        cc.request_reference_id,
        cc.notes,
        cc.outcome,
        DATE_FORMAT(cc.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(cc.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
        s.name AS status_name,
        s.id AS status_id,
        client.given_name AS client_given_name,
        client.middle_name AS client_middle_name,
        client.last_name AS client_last_name,
        client.public_id AS client_id,
        sl.id AS severity_level,
        sl.name AS severity_name
      FROM counseling_cases AS cc
      LEFT JOIN counseling_requests AS request
        ON request.reference_id = cc.request_reference_id
      LEFT JOIN request_client_informations AS rci ON rci.request_reference_id = request.reference_id
      JOIN status AS s ON s.id = cc.status
      LEFT JOIN severity_levels AS sl ON sl.id = cc.severity_level
      LEFT JOIN users AS client
        ON client.account_id = request.client_id
      LEFT JOIN courses AS c ON c.id = client.course
      ${case_rows_where.length > 0 ? `WHERE ${case_rows_where.join(" AND ")}` : ""}
      ORDER BY cc.created_at DESC
      LIMIT ?
      OFFSET ?
  `,
    [...case_rows_values, limit, offset],
  );

  return { data: case_rows };
};

const removeCaseCollaborator = async ({
  case_id,
  account_id,
  collaborator_public_id,
  connection = pool,
}) => {
  const validations = [
    { check: !account_id, message: "Performer must identify itself" },
    { check: !case_id, message: "Please provide the case ID" },
    {
      check: !collaborator_public_id,
      message:
        "Please provide the public ID of the collaborator you want to remove",
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

  const [account_rows] = await connection.query(
    `
    SELECT a.account_id FROM accounts AS a
    JOIN users AS u ON u.account_id = a.account_id
    WHERE u.public_id = ?
    LIMIT 1
    `,
    [collaborator_public_id],
  );

  const collaborator = account_rows[0];

  if (!collaborator) {
    throw new AppError(
      "Could not find the collaborator you are trying to remove.",
    );
  }

  if (collaborator.account_id === account_id) {
    throw new AppError(
      "You cannot remove yourself from the case. Please assign another head if needed.",
      400,
    );
  }

  const [case_collaborators] = await connection.query(
    `
    SELECT * FROM case_collaborators
    WHERE case_id = ?
    `,
    [case_id],
  );

  const self_data = case_collaborators.find(
    (c) => c.counselor_id === account_id,
  );
  const is_collaborator = case_collaborators.find(
    (c) => c.counselor_id === collaborator.account_id,
  );

  if (!self_data || self_data.role !== "head") {
    throw new AppError(
      "You cannot perform this action. Please contact the Case head member to remove a collaborator",
    );
  }

  if (!is_collaborator) {
    throw new AppError(
      "The collaborator you are trying to remove is not part of this case.",
    );
  }

  await connection.query(
    `
    DELETE FROM case_collaborators
    WHERE case_id = ? AND counselor_id = ?
    `,
    [case_id, collaborator.account_id],
  );

  return;
};

const addCaseCollaborator = async ({
  account_id,
  case_id,
  collaborator_public_id,
  role,
  connection = pool,
}) => {
  const validations = [
    { check: !account_id, message: "Performer must identify itself" },
    {
      check: !case_id,
      message:
        "Please provide the id of the case you are trying to perform this action",
    },
    { check: !role, message: "Please provide a role to the collaborator" },
    {
      check: !collaborator_public_id,
      message:
        "Please provide the public ID of the collaborator you are trying to add",
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

  const [account_rows] = await connection.query(
    `
    SELECT a.account_id FROM accounts AS a
    JOIN users AS u ON u.account_id = a.account_id
    WHERE u.public_id = ? AND role = ?
    LIMIT 1
  `,
    [collaborator_public_id, ROLE.COUNSELOR],
  );

  const collaborator = account_rows[0];

  if (collaborator.length === 0) {
    throw new AppError(
      "Could not find the collaborator you are trying to add.",
    );
  }

  const [case_collaborators] = await connection.query(
    `
    SELECT * FROM case_collaborators
    WHERE case_id = ?
  `,
    [case_id],
  );

  const self_data = case_collaborators.find(
    (c) => c.counselor_id === account_id,
  );
  const is_collaborator = case_collaborators.find(
    (c) => c.counselor_id === collaborator.account_id,
  );

  if (self_data.role !== "head")
    throw new AppError(
      "You cannot perform this action. Please contact the Case head member to add a collaborator",
    );

  if (is_collaborator)
    throw new AppError(
      "The collaborator you are trying to add is already a collaborator",
    );

  await connection.query(
    `
    INSERT INTO case_collaborators (case_id, counselor_id, role)
    VALUES (?, ?, ?)
  `,
    [case_id, collaborator.account_id, role],
  );

  return;
};

const getCaseCollaborators = async ({ case_id, connection = pool }) => {
  const validations = [
    {
      check: !case_id,
      message: "Please provide the case id",
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

  const [collaborator_rows] = await connection.query(
    `
    SELECT * FROM case_collaborators AS ccl
    JOIN users AS u ON u.account_id = ccl.counselor_id
    WHERE ccl.case_id = ?
  `,
    [case_id],
  );

  return { data: collaborator_rows };
};

const getCaseAnalytics = async ({ connection = pool }) => {
  const now = DateTime.now({ zone: "Asia/Manila" });
  const start_of_month = now.startOf("month");
  const start_of_year = now.startOf("year");

  const [case_rows] = await connection.query(
    `
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        COUNT(CASE WHEN status = ? THEN 1 END) AS ongoing_total,
        COUNT(CASE WHEN status = ? AND updated_at >= ? THEN 1 END) AS terminated_total,
        (SELECT COUNT(*) 
        FROM counseling_cases
        WHERE created_at >= ?) AS year_total
      FROM counseling_cases
      GROUP BY month
      ORDER BY month ASC
          `,
    [
      STATUS.ONGOING,
      STATUS.TERMINATED,
      start_of_month.toFormat("yyyy-MM-dd HH:mm:ss"),
      start_of_year.toFormat("yyyy-MM-dd HH:mm:ss"),
    ],
  );

  const [request_rows] = await connection.query(
    `
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        COUNT(*) AS requests_in_month
      FROM counseling_requests
      WHERE created_at >= ?
      GROUP BY month
      ORDER BY month ASC
      `,
    [start_of_year.toFormat("yyyy-MM-dd HH:mm:ss")],
  );

  return { data: { cases: case_rows, requests: request_rows } };
};

const addSessionAttachment = async ({
  account_id,
  session_id,
  link,
  connection = pool,
}) => {
  session_id = normalize(session_id);
  link = normalize(link);

  const validations = [
    {
      check: !session_id,
      message: "Please provide a session id to attach the link",
    },
    {
      check: !link,
      message: "Please provide the link you wish to attach",
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

  const [session_rows] = await connection.query(
    `
    SELECT cs.case_id
    FROM counseling_case_sessions AS ccs
    JOIN counseling_cases AS cs ON cs.case_id = ccs.case_id
    WHERE ccs.session_id = ?
    LIMIT 1
  `,
    [session_id],
  );

  const session = session_rows[0];

  if (session.length === 0) {
    throw new AppError(
      "Could not find the case you are trying to perfrom the action to.",
    );
  }

  const [case_collaborators_rows] = await connection.query(
    `
    SELECT counselor_id
    FROM case_collaborators
    WHERE case_id = ?
  `,
    [session.case_id],
  );

  const is_collaborator = case_collaborators_rows.some(
    (c) => c.counselor_id === account_id,
  );

  if (!is_collaborator) {
    throw new AppError("Could not process your request.");
  }

  await connection.query(
    `
    INSERT INTO session_attachments (session_id, link)
    VALUES (?, ?)
  `,
    [session_id, link],
  );
};

const removeSessionAttachment = async ({
  account_id,
  session_id,
  attachment_id,
  connection = pool,
}) => {
  session_id = normalize(session_id);
  attachment_id = normalize(attachment_id);

  const validations = [
    {
      check: !session_id,
      message: "Please provide a session id to attach the virtual room.",
    },
    {
      check: !attachment_id,
      message: "Please provide the attachment id to remove.",
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

  const [session_rows] = await connection.query(
    `
    SELECT cs.case_id
    FROM counseling_case_sessions AS ccs
    JOIN counseling_cases AS cs ON cs.case_id = ccs.case_id
    WHERE ccs.session_id = ?
    LIMIT 1
  `,
    [session_id],
  );

  const session = session_rows[0];

  if (session.length === 0) {
    throw new AppError(
      "Could not find the case you are trying to perfrom the action to.",
    );
  }

  const [case_collaborators_rows] = await connection.query(
    `
    SELECT counselor_id
    FROM case_collaborators
    WHERE case_id = ?
  `,
    [session.case_id],
  );

  const is_collaborator = case_collaborators_rows.some(
    (c) => c.counselor_id === account_id,
  );

  if (!is_collaborator) {
    throw new AppError("Could not process your request.");
  }

  await connection.query(
    `
      DELETE FROM session_attachments
      WHERE session_id = ? AND id =?
    `,
    [session_id, attachment_id],
  );
};

const getSessionAttachments = async ({
  account_id,
  session_id,
  connection = pool,
}) => {
  session_id = normalize(session_id);

  const validations = [
    { check: !session_id, message: "Please provide a session id" },
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

  const [session_rows] = await connection.query(
    `
    SELECT cs.case_id
    FROM counseling_case_sessions AS ccs
    JOIN counseling_cases AS cs ON cs.case_id = ccs.case_id
    WHERE ccs.session_id = ?
    LIMIT 1
  `,
    [session_id],
  );

  if (session_rows.length === 0) {
    throw new AppError(
      "Could not find the case you are trying to perfrom the action to.",
    );
  }

  // const [case_collaborators_rows] = await connection.query(
  //   `
  //   SELECT counselor_id
  //   FROM case_collaborators
  //   WHERE case_id = ?
  // `,
  //   [session.case_id],
  // );

  // const is_collaborator = case_collaborators_rows.some(
  //   (c) => c.counselor_id === account_id,
  // );

  // if (!is_collaborator) {
  //   throw new AppError("Could not process your request.");
  // }

  const [session_attachment_rows] = await connection.query(
    `
    SELECT * FROM session_attachments
    WHERE session_id = ?
  `,
    [session_id],
  );

  return { data: session_attachment_rows };
};

const attachVirtualRoomToSession = async ({
  account_id,
  session_id,
  case_id,
  room_id,
  connection = pool,
}) => {
  session_id = normalize(session_id);
  case_id = normalize(case_id);
  room_id = normalize(room_id);

  const validations = [
    {
      check: !session_id,
      message: "Please provide a session id to attach the virtual room.",
    },
    {
      check: !room_id,
      message: "Please provide the room id you wish to attach",
    },
    {
      check: !case_id,
      message:
        "Please provide the id of the case you are trying to perform this action.",
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

  const [case_collaborators_rows] = await connection.query(
    `
    SELECT counselor_id
    FROM case_collaborators
    WHERE case_id = ?
  `,
    [case_id],
  );

  const is_collaborator = case_collaborators_rows.some(
    (c) => c.counselor_id === account_id,
  );

  if (!is_collaborator) {
    throw new AppError("Could not process your request.");
  }

  const [session_virtual_rooms_rows] = await connection.query(
    `
    SELECT 1 FROM session_virtual_rooms
    WHERE session_id = ?
  `,
    [session_id],
  );

  if (session_virtual_rooms_rows.length > 0) {
    throw new AppError("Session have an existing attached room.");
  }

  const expires_at = DateTime.now({ zone: "Asia/Manila" })
    .plus({ hours: 1 })
    .toFormat("yyyy-MM-dd HH:mm:ss");

  await connection.query(
    `
    INSERT INTO session_virtual_rooms (session_id, room_id, expires_at)
    VALUES (?, ?, ?)
  `,
    [session_id, room_id, expires_at],
  );

  notifyCaseUpdate({ case_id, sender: account_id });
};

const removeAttachedVirtualRoom = async ({
  account_id,
  session_id,
  case_id,
  connection = pool,
}) => {
  session_id = normalize(session_id);
  case_id = normalize(case_id);

  const validations = [
    {
      check: !session_id,
      message:
        "Please provide a session id to remove the attached virtual room.",
    },
    {
      check: !case_id,
      message: "Please provide the case id",
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

  const [case_collaborators_rows] = await connection.query(
    `
    SELECT counselor_id
    FROM case_collaborators
    WHERE case_id = ?
  `,
    [case_id],
  );

  const is_collaborator = case_collaborators_rows.some(
    (c) => c.counselor_id === account_id,
  );

  if (!is_collaborator) {
    throw new AppError("Could not process your request.");
  }

  await connection.query(
    `
      DELETE FROM session_virtual_rooms
      WHERE session_id = ?
    `,
    [session_id],
  );

  notifyCaseUpdate({ case_id, sender: account_id });
};

const getSessionAttachedVirtualRooms = async ({
  account_id,
  session_id,
  connection = pool,
}) => {
  session_id = normalize(session_id);

  const validations = [
    { check: !session_id, message: "Please provide a session id" },
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

  const [session_rows] = await connection.query(
    `
    SELECT cs.case_id
    FROM counseling_case_sessions AS ccs
    JOIN counseling_cases AS cs ON cs.case_id = ccs.case_id
    WHERE ccs.session_id = ?
    LIMIT 1
  `,
    [session_id],
  );

  if (session_rows.length === 0) {
    throw new AppError(
      "Could not find the case you are trying to perfrom the action to.",
    );
  }

  const session = session_rows[0];

  // const [case_collaborators_rows] = await connection.query(
  //   `
  //   SELECT counselor_id
  //   FROM case_collaborators
  //   WHERE case_id = ?
  // `,
  //   [session.case_id],
  // );

  // const is_collaborator = case_collaborators_rows.some(
  //   (c) => c.counselor_id === account_id,
  // );

  // if (!is_collaborator) {
  //   throw new AppError("Could not process your request.");
  // }

  const [session_virtual_rooms_rows] = await connection.query(
    `
    SELECT * FROM session_virtual_rooms
    WHERE session_id = ?
  `,
    [session_id],
  );

  return { data: session_virtual_rooms_rows };
};

const getCounselingSchedules = async ({ account_id, connection = pool }) => {
  account_id = normalize(account_id);

  const validations = [
    { check: !account_id, message: "Please provide the account id" },
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

  const [session_rows] = await connection.query(
    `
    SELECT ccs.session_id, DATE_FORMAT(ccs.from, '%Y-%m-%d %H:%i:%s') AS \`from\`, DATE_FORMAT(ccs.to, '%Y-%m-%d %H:%i:%s') AS \`to\`
    FROM case_collaborators AS cclb
    LEFT JOIN counseling_case_sessions AS ccs ON ccs.case_id = cclb.case_id
    WHERE cclb.counselor_id = ? AND ccs.status = ?
  `,
    [account_id, STATUS.ONGOING],
  );

  return { data: session_rows };
};

const createCaseFor = async ({
  account_id,
  client_id,
  start_date,
  start_time,
  counseling_type,
  reason,
  type,
  referred_by,
  connection,
}) => {
  reason = normalize(reason);
  client_id = normalize(client_id);
  account_id = normalize(account_id);
  counseling_type = Number(counseling_type);
  referred_by = normalize(referred_by);
  type = normalize(type);

  const meeting_date_ph = DateTime.fromISO(`${start_date}T${start_time}`, {
    zone: "Asia/Manila",
  });

  if (!meeting_date_ph.isValid) {
    throw new AppError("Meeting date or time is invalid.", 400);
  }

  const today_ph = DateTime.now().setZone("Asia/Manila");
  const max_allowed_ph = today_ph.plus({ days: 14 });

  const validations = [
    {
      check: !client_id,
      message: "Client id must be provided",
    },
    {
      check: type === "referred" && !referred_by,
      message: "Referrer name must be provided",
    },
    {
      check: !type,
      message: "Type of counseling must be provided",
    },
    {
      check: type && !["referred", "requested"].includes(type),
      message: "Type of request must be either 'referred' or 'requested'",
    },
    {
      check: !counseling_type,
      message: "Counseling type must be provided",
    },
    { check: !account_id, message: "Counselor id must be provided!" },
    {
      check: meeting_date_ph && (meeting_date_ph < today_ph || meeting_date_ph > max_allowed_ph),
      message: "Preferred date and time must be within the next 14 days.",
    },
    {
      check:
        meeting_date_ph &&
        (meeting_date_ph.hour < SESSION_TIME_RANGE.from ||
          meeting_date_ph.hour > SESSION_TIME_RANGE.to),
      message: "Preferred time must be between 8 AM and 6 PM PH time.",
    },
  ];

  const errors = validations.filter((v) => v.check).map((v) => v.message);
  if (errors.length > 0) throw new AppError("Validation errors", 400, errors);

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    const [user_rows] = await connection.query(
      `
      SELECT a.role, a.account_id FROM users AS u
      JOIN accounts AS a ON a.account_id = u.account_id
      WHERE u.public_id = ?
      LIMIT 1
    `,
      [client_id],
    );

    if (user_rows?.length === 0) {
      throw new AppError("Could not proceed with your request.");
    }

    const user = user_rows[0];

    if (user.role !== ROLE.CLIENT) {
      throw new AppError("Could not proceed with your request");
    }

    const reference_id = await generateReferenceID({
      account_id: user.account_id,
    });

    const meeting_date_db = meeting_date_ph.toFormat("yyyy-LL-dd HH:mm:ss");

    await connection.query(
      `
        INSERT INTO counseling_requests (reference_id, client_id, status, preferred_date, preferred_counseling_type, type, referred_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        reference_id,
        user.account_id,
        STATUS.PENDING,
        meeting_date_db,
        counseling_type,
        type,
        referred_by ?? null,
      ],
    );

    await connection.query(
      `INSERT INTO request_client_informations
       (request_reference_id, reason)
       VALUES (?, ?)`,
      [reference_id, encryptCaseField(reason)],
    );

    await acceptCounselingRequest({
      request_reference_id: reference_id,
      counselor_id: account_id,
      connection
    });

    if (self_conn) await connection.commit();

    return;
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

module.exports = {
  requestCounseling,
  cancelCounselingRequest,
  getClientCounselingRequests,
  getCases,
  createCounselingCaseSession,
  getCaseSessions,
  addCounselingQuestion,
  updateCounselingQuestion,
  getCounselingQuestions,
  archiveCounselingQuestion,
  getCounselingQuestionaire,
  acceptCounselingRequest,
  getCounselingRequests,
  terminateCounselorCaseSession,
  terminateCounselorCase,
  updateCounselorCase,
  updateCounselorCaseSession,
  getCounselingType,
  getIntakeForm,
  getCaseRecords,
  getSeverityLevels,
  referClient,
  getReferrals,
  handleReferral,
  closeReferral,
  addCaseCollaborator,
  getCaseCollaborators,
  getCaseAnalytics,
  addSessionAttachment,
  removeSessionAttachment,
  getSessionAttachments,
  attachVirtualRoomToSession,
  getSessionAttachedVirtualRooms,
  removeAttachedVirtualRoom,
  getCounselingSchedules,
  createCaseFor,
  removeCaseCollaborator,
};
