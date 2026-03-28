const { STATUS } = require("../config/serverConstants");
const pool = require("../db");
const AppError = require("../utils/AppError");
const { DateTime } = require("luxon");
const { normalize } = require("../utils/DataHelper");
const { randomUUID } = require("crypto");

const createVirtualRoom = async ({
  case_id,
  session_id,
  account_id,
  connection,
}) => {
  case_id = normalize(case_id);
  session_id = normalize(session_id);
  account_id = normalize(account_id);

  const validations = [
    {
      check: !case_id,
      message: "The case id of the session must be provided.",
    },
    {
      check: !session_id,
      message:
        "The id of the session you are trying to create a room to must be provided.",
    },
    {
      check: !account_id,
      message: "The account id of the case owner must be provided",
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
    const [rows] = await connection.query(
      `
        SELECT 1
        FROM counseling_cases AS cc
        JOIN counseling_case_sessions AS cs
        JOIN counseling_requests AS cr ON cr.reference_id = cc.request_reference_id
        WHERE 
          cs.session_id = ? 
          AND cc.case_id = ?
        LIMIT 1
      `,
      [session_id, case_id],
    );

    if (rows.length === 0) {
      throw new AppError(
        "Could not find the case and session related to the account you are trying to create the virtual room.",
        400,
      );
    }

    const room_id = randomUUID();

    await connection.query(`
        INSERT INTO video_call_rooms (id, session_id) 
        VALUES (?, ?)
      `,
      [room_id, session_id],
    );

    await addVirtualRoomParticipants({
      participants: [{user_id: account_id, role: "admin"}],
      room_id,
      connection,
    });

    if (self_conn) await connection.commit();

    return { data: { room_id } };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const getVirtualRoomData = async ({
  room_id,
  connection = pool,
}) => {
  const [room_rows] = await connection.query(`
    SELECT vcr.id AS room_id, vcr.session_id, ccs.case_id
    FROM video_call_rooms AS vcr
    JOIN counseling_case_sessions AS ccs ON ccs.session_id = vcr.session_id
    WHERE vcr.id = ?
    LIMIT 1
  `, [room_id]);

  const virtual_room_data = room_rows[0];

  return { data: virtual_room_data[0] };
};

const updateVirtualRoom = async ({
  account_id,
  room_id,
  is_open,
  connection = pool,
}) => {
  room_id = normalize(room_id);
  account_id = normalize(account_id);

  const validations = [
    {
      check: is_open && typeof is_open !== "boolean",
      message: "The is_open field must be a boolean value.",
    },
    {
      check: !room_id,
      message: "The id of the room must be provided.",
    },
    ,
    {
      check: !account_id,
      message: "The account id must be provided.",
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

  const to_update = [];
  const to_update_values = [];

  if (is_open !== undefined || is_open !== null) {
    to_update.push("is_open = ?");
    to_update_values.push(is_open);
  }

  if (to_update.length === 0) {
    throw new AppError(
      "No valid fields to update. Please provide at least one field to update.",
      400,
    );
  }

  await connection.query(
    `
    UPDATE video_call_rooms
    SET ${to_update.join(", ")}
    WHERE id = ?
  `,
    [...to_update_values, room_id],
  );

  return { data: { is_open } };
};

const addVirtualRoomParticipants = async ({
  participants = [],
  room_id,
  connection,
}) => {
  room_id = normalize(room_id);
  participants = Array.isArray(participants) ? participants : [];

  const validations = [
    { check: !room_id, message: "The id of the room must be provided." },
    {
      check: participants.length === 0,
      message: "At least one participant must be provided to add to the room.",
    },
    {
      check: participants.some(
        (p) => !p || !p.user_id || !p.role
      ),
      message: "Each participant must contain user_id and role.",
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
    const insert_values = participants.map((p) => [
      randomUUID(),
      p.user_id,
      room_id,
      p.role,
    ]);

    await connection.query(
      `
      INSERT INTO video_call_room_participants
        (id, user_id, room_id, user_chat_role)
      VALUES ?
      `,
      [insert_values],
    );

    if (self_conn) await connection.commit();

    return { data: {} };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const verifyRoomParticipation = async ({
  room_id,
  account_id,
  connection = pool,
}) => {
  room_id = normalize(room_id);
  account_id = normalize(account_id);

  const validations = [
    {
      check: !room_id,
      message: "The id of the room you are trying to join to must be provided.",
    },
    {
      check: room_id && room_id.length > 36,
      message: "Could not enter the room. Make sure the room id is correct.",
    },
    { check: !account_id, message: "Account id must be provided" },
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

  const [vcr_rows] = await connection.query(
    `
    SELECT vcr.id AS room_id
    FROM video_call_room_participants AS vp
    JOIN video_call_rooms AS vcr ON vcr.id = vp.room_id
    WHERE vp.user_id = ? AND vp.room_id = ? AND vcr.is_open = 1
    LIMIT 1
  `,
    [account_id, room_id],
  );

  if (vcr_rows.length === 0) {
    throw new AppError(
      "Could not join the room. Please make sure the that the room id is correct.",
    );
  }

  return { data: vcr_rows[0] };
};

const checkVirtualRoom = async ({ room_id, account_id, connection = pool }) => {
  const [room_rows] = await connection.query(`
    SELECT DATE_FORMAT(ccs.\`from\`, '%Y-%m-%d %H:%i:%s') AS open_date, DATE_FORMAT(ccs.\`to\`, '%Y-%m-%d %H:%i:%s') AS closed_date
    FROM video_call_rooms AS vcr
    JOIN video_call_room_participants AS vcp ON vcp.room_id = vcr.id
    JOIN counseling_case_sessions AS ccs ON ccs.session_id = vcr.session_id
    WHERE vcr.id = ? AND vcp.user_id = ?
    LIMIT 1
  `, [room_id, account_id]);

  const room = room_rows[0];

  if (!room) {
    return false;
  }

  const today_ph = DateTime.now().setZone("Asia/Manila");
  const open_date = DateTime.fromSQL(room.open_date, {
    zone: "Asia/Manila",
  });
  const closed_date = DateTime.fromSQL(room.closed_date, {
    zone: "Asia/Manila",
  });

  if (today_ph < open_date || today_ph > closed_date) {
    return false;
  }

  return true;
}

const leaveVirtualRoom = async ({ room_id, account_id, connection = pool }) => {
  room_id = normalize(room_id);
  account_id = normalize(account_id);

  const validations = [
    {
      check: !room_id,
      message:
        "The id of the room you are trying to leave to must be provided.",
    },
    { checl: !account_id, message: "Account id must be provided" },
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

  const [joined] = await connection.query(
    `
    SELECT 1 FROM video_call_room_participants
    WHERE user_id = ? AND room_id = ? AND left_at IS NULL
  `,
    [account_id, room_id],
  );

  if (joined.length === 0) {
    throw new AppError("You are not currently in the virtual room");
  }

  await connection.query(
    `
    UPDATE video_call_room_participants
    SET left_at = NOW()
    WHERE user_id = ? AND room_id = ?
  `,
    [account_id, room_id],
  );

  return { success: true };
};

const getCallParticipants = async ({ room_id, connection = pool }) => {
  room_id = normalize(room_id);

  const validations = [
    {
      check: !room_id,
      message: "The room id must be provided to fetch the participants.",
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

  const [participants] = await connection.query(
    `
    SELECT user_id
    FROM video_call_room_participants
    WHERE room_id = ? AND left_at IS NULL
  `,
    [room_id],
  );

  return { data: participants };
};

const getRoomParticipantData = async ({ room_id, account_id, connection = pool }) => {
  const [participant_row] = await connection.query(`
    SELECT vcp.user_chat_role AS chat_role, vcp.joined_at
    FROM video_call_room_participants AS vcp
    WHERE vcp.room_id = ? AND vcp.user_id = ?
    LIMIT 1
  `, [room_id, account_id]);

  const participant = participant_row[0];
  
  return { data: participant };
};

const getRoomParticipants = async ({ room_id, connection = pool}) => {
  const [participant_rows] = await connection.query(`
    SELECT vcp.user_id, vcp.user_chat_role AS chat_role, vcp.joined_at
    FROM video_call_room_participants AS vcp
    WHERE vcp.room_id = ? AND vcp.left_at IS NULL
  `, [room_id]);

  return { data: participant_rows };
};

module.exports = {
    leaveVirtualRoom,
    verifyRoomParticipation,
    addVirtualRoomParticipants,
    getCallParticipants,
    updateVirtualRoom,
    getVirtualRoomData,
    createVirtualRoom,
    checkVirtualRoom,
    getRoomParticipantData,
    getRoomParticipants
}