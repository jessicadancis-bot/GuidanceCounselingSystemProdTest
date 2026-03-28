const pool = require("../db");
const AppError = require("../utils/AppError");
const { normalize } = require("../utils/DataHelper");
const { randomUUID } = require("crypto");
const {
  addConversationListener,
  addConversationToMap,
} = require("../websocket");
const { generateRandomID } = require("../utils/randomizer");

const insertToConversation = async ({
  conversation_id,
  sender_id,
  content,
  connection = pool,
}) => {
  content = normalize(content);

  const validations = [
    { check: !content, message: "Message content must be provided." },
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

  const [conv_rows] = await connection.query(
    `
    SELECT 1 FROM conversations AS c
    LEFT JOIN conversation_participants AS cp ON cp.conversation_id = c.id
    WHERE c.id = ? AND cp.user_id = ?
    LIMIT 1
  `,
    [conversation_id, sender_id],
  );

  if (conv_rows.length === 0) {
    throw new AppError(
      "Could not send message to this conversation. Make sure the conversation exist",
    );
  }

  const [user_rows] = await connection.query(
    `
    SELECT 1 FROM accounts
    WHERE account_id = ?
    LIMIT 1
  `,
    [sender_id],
  );

  if (user_rows.length === 0) {
    throw new AppError(
      "Insertion failed. Please make sure that the sender exist.",
    );
  }

  await connection.query(
    `
    INSERT INTO messages (conversation_id, sender_id, content)
    VALUES (?, ?, ?)
  `,
    [conversation_id, sender_id, content],
  );
};

const createConversation = async ({ creator_id, recipient_id, connection }) => {
  creator_id = normalize(creator_id);
  recipient_id = normalize(recipient_id);
  const type = "private";

  const validations = [
    {
      check: !recipient_id,
      message: "The recipient must be provided.",
    },
    {
      check: !creator_id,
      message: "Creator id must be provided",
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
    const [participant_rows] = await connection.query(
      `
        SELECT account_id, public_id AS user_id, CONCAT(given_name, ' ', last_name) AS user_name
        FROM users
        WHERE public_id = ?
        LIMIT 1
      `,
      [recipient_id],
    );

    if (participant_rows.length === 0) {
      throw new AppError(
        "Could not find the user you are trying to send message to.",
      );
    }

    const recipient_account_id = participant_rows[0].account_id;

    const [conversation_rows] = await connection.query(
      `
        SELECT c.id
        FROM conversation_participants AS cp1
        JOIN conversation_participants AS cp2 ON cp1.conversation_id = cp2.conversation_id
        JOIN conversations AS c ON c.id = cp1.conversation_id
        WHERE cp1.user_id = ?
          AND cp2.user_id = ?
            AND c.type = ?
        GROUP by c.id
      `,
      [recipient_account_id, creator_id, type],
    );

    if (conversation_rows.length > 0) {
      return {
        data: {
          conversation_id: conversation_rows[0].id,
          existing: true,
          participants: [
            {
              user_id: participant_rows[0].user_id,
              user_name: participant_rows[0].user_name,
            },
          ],
        },
      };
    }

    const conversation_id = randomUUID();

    // Create a new conversation
    await connection.query(
      `
        INSERT INTO conversations (id, type)
        VALUES (?, ?)
      `,
      [conversation_id, type],
    );

    await connection.query(
      `
        INSERT INTO conversation_participants (id, conversation_id, user_id)
        VALUES (?, ?), (?, ?)
      `,
      [conversation_id, creator_id, conversation_id, recipient_account_id],
    );

    const participant_ids = [creator_id, recipient_account_id];
    addConversationToMap({ room_id: conversation_id });
    addConversationListener({ room_id: conversation_id, participant_ids });

    if (self_conn) await connection.commit();

    return {
      data: {
        conversation_id,
        type: type,
        participants: [
          {
            user_id: participant_rows[0].user_id,
            user_name: participant_rows[0].user_name,
          },
        ],
      },
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) connection.release();
  }
};

const findOrCreateConversation = async ({
  sender,
  recipient_public_id,
  connection = pool,
}) => {
  sender = normalize(sender);
  recipient_public_id = normalize(recipient_public_id);

  let self_conn = false;
  if (!connection) {
    connection = await pool.getConnection();
    self_conn = true;
    await connection.beginTransaction();
  }

  try {
    let is_new = false;

    const [account_rows] = await connection.query(
      `
      SELECT account_id FROM users
      WHERE public_id = ?
      LIMIT 1
    `,
      [recipient_public_id],
    );

    const recipient = account_rows[0];

    if (!recipient)
      throw new AppError(
        "Could not find the user you are trying to send this message to.",
        400,
      );

    const [conversation_rows] = await connection.query(
      `
      SELECT cp1.conversation_id
      FROM conversation_participants cp1
      JOIN conversation_participants cp2
      ON cp1.conversation_id = cp2.conversation_id
      WHERE cp1.user_id = ?
        AND cp2.user_id = ?
      LIMIT 1;
    `,
      [sender, recipient.account_id],
    );

    const conversation = conversation_rows[0];
    let conversation_id = conversation?.conversation_id;

    if (!conversation_id) {
      is_new = true;
      conversation_id = generateRandomID({});

      await connection.query(
        `
        INSERT INTO conversations (id, type)
        VALUES (?, ?)
      `,
        [conversation_id, "private"],
      );

      await connection.query(
        `
        INSERT INTO conversation_participants (conversation_id, user_id)
        VALUES (?, ?), (?, ?)
      `,
        [conversation_id, sender, conversation_id, recipient.account_id],
      );
    }

    if (self_conn) await connection.commit();

    return {
      data: { conversation_id, recipient_id: recipient.account_id },
      is_new,
    };
  } catch (e) {
    if (self_conn) await connection.rollback();
    throw e;
  } finally {
    if (self_conn) await connection.release();
  }
};

const getMyConversations = async ({ account_id, limit, page, connection = pool }) => {
  account_id = normalize(account_id);
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  limit = Number(limit) || 0;
  const offset = (page - 1) * limit;

  const [conversation_rows] = await connection.query(
    `
    SELECT c.id, c.name, DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, c.type,
      DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS last_updated, m.content AS last_message,
      COUNT(*) OVER() AS total_count
    FROM conversations AS c
    LEFT JOIN conversation_participants AS cp ON cp.conversation_id = c.id
    LEFT JOIN messages AS m ON m.conversation_id = c.id
      AND m.created_at = (SELECT MAX(m2.created_at) FROM messages AS m2 WHERE m2.conversation_id = c.id)
    WHERE cp.user_id = ?
    ORDER BY last_updated DESC
    ${limit && limit > 0 ? 'LIMIT ? OFFSET ?' : ''}
  `,
    [account_id, limit, offset],
  );

  if (conversation_rows.length === 0) {
    return { data: [] };
  }

  const conversation_ids = conversation_rows.map((c) => c.id);

  const [messages_rows] = await connection.query(
    `
    SELECT *
      FROM (
          SELECT 
              m.id, 
              u.public_id AS user_id,
              CONCAT(u.given_name, ' ', u.last_name) AS user_name,
              m.content, 
              m.created_at, 
              m.conversation_id,
              ROW_NUMBER() OVER (
                  PARTITION BY m.conversation_id 
                  ORDER BY m.created_at DESC, m.id DESC
              ) AS rn
          FROM messages m
          JOIN users u ON u.account_id = m.sender_id
          WHERE m.conversation_id IN (?)
      ) AS sub
      WHERE rn <= 20
      ORDER BY conversation_id, rn ASC;
    `,
    [conversation_ids],
  );

  const message_map = {};
  messages_rows.forEach((msg) => {
    if (!message_map[msg.conversation_id])
      message_map[msg.conversation_id] = [];
    message_map[msg.conversation_id].push(msg);
  });

  Object.keys(message_map).forEach((cid) => {
    message_map[cid].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    );
  });

  const [participant_rows] = await connection.query(
    `
    SELECT c.conversation_id, u.public_id AS user_id, c.role, c.joined_at, c.user_id AS account_id, u.status,
      CONCAT(u.given_name, ' ', u.last_name) AS user_name
    FROM conversation_participants AS c
    JOIN users AS u ON u.account_id = c.user_id
    WHERE c.conversation_id IN (${conversation_ids.map((q) => "?").join(", ")})
    ORDER by c.joined_at
    `,
    [...conversation_ids],
  );

  const participants_map = {};
  participant_rows.forEach((prt) => {
    if (!participants_map[prt.conversation_id])
      participants_map[prt.conversation_id] = [];

    participants_map[prt.conversation_id].push(prt);
  });

  const conversation_data = [];

  conversation_rows.forEach((cnv) => {
    const cnv_messages = message_map[cnv.id] || [];
    const cnv_participants = participants_map[cnv.id];
    const cnv_type = cnv.type;

    if (cnv_type === "private") {
      const other_participant = cnv_participants.find(
        (p) => p.account_id !== account_id,
      );

      cnv.name = other_participant ? other_participant.user_name : "User";
    }

    const participants_for_return = cnv_participants.map(
      ({ account_id, ...rest }) => rest,
    );

    conversation_data.push({
      ...cnv,
      messages: cnv_messages,
      participants: participants_for_return,
    });
  });

  const total = conversation_rows[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  return { data: conversation_data, total_pages, total };
};

const getMyConversationData = async ({
  account_id,
  conversation_id,
  connection = pool,
}) => {
  const [account_rows] = await connection.query(
    `SELECT public_id FROM users WHERE account_id = ? LIMIT 1`,
    [account_id],
  );

  const public_id = account_rows[0]?.public_id;
  if (!public_id) return null;

  const [participants] = await connection.query(
    `
    SELECT u.public_id, CONCAT(u.given_name, ' ', u.last_name) AS user_name, u.given_name, u.last_name, cp.user_id AS account_id
    FROM conversation_participants cp
    JOIN users u ON cp.user_id = u.account_id
    WHERE cp.conversation_id = ?
    `,
    [conversation_id],
  );

  const [messages] = await connection.query(
    `
    SELECT m.id AS message_id, u.public_id AS user_id, CONCAT(u.given_name, ' ', u.last_name) AS user_name,
      m.content, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM messages AS m
    JOIN users AS u ON u.account_id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 10
    `,
    [conversation_id],
  );

  const [conversation_info] = await connection.query(
    `
    SELECT id AS id, name, type, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM conversations
    WHERE id = ?
    LIMIT 1
    `,
    [conversation_id],
  );

  if (!conversation_info.length) return null;

  const last_message = messages.length
    ? messages[messages.length - 1].content
    : null;

  if (conversation_info[0].type === "private") {
    const other_participant = participants.find(
      (p) => p.public_id !== public_id,
    );
    conversation_info[0].name = other_participant
      ? other_participant.user_name
      : "Unknown";
  }

  return {
    data: {
      ...conversation_info[0],
      last_message,
      messages: messages.reverse(),
      participants: participants.map((p) => ({ ...p, account_id: undefined })),
    },
  };
};

const loadConversationMessages = async ({
  account_id,
  conversation_id,
  limit = 10,
  before_id = null,
  connection = pool,
}) => {
  account_id = normalize(account_id);
  conversation_id = normalize(conversation_id);
  limit = Number(limit);

  const [conversation_participants_rows] = await connection.query(
    `
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = ? AND user_id = ?
  `,
    [conversation_id, account_id],
  );

  if (conversation_participants_rows.length === 0) {
    return { data: [] };
  }

  let query = `
        SELECT m.id, u.public_id AS user_id, CONCAT(u.given_name, ' ', u.last_name) AS user_name,
          m.content, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, m.conversation_id
        FROM messages AS m
        JOIN users AS u ON u.account_id = m.sender_id
        WHERE m.conversation_id = ?
  `;
  const params = [conversation_id];

  if (before_id) {
    query += ` AND m.id < ? `;
    params.push(before_id);
  }

  query += ` ORDER BY m.id DESC LIMIT ?`;
  params.push(limit);

  const [messages_rows] = await connection.query(query, params);

  messages_rows.reverse();

  return { data: messages_rows };
};

const getConversationParticipants = async ({
  conversation_id,
  connection = pool,
}) => {
  const [conversation_rows] = await connection.query(
    `
    SELECT user_id FROM conversation_participants
    WHERE conversation_id = ?
  `,
    [conversation_id],
  );

  return { data: conversation_rows };
};

module.exports = {
  loadConversationMessages,
  getMyConversationData,
  getMyConversations,
  createConversation,
  insertToConversation,
  getConversationParticipants,
  findOrCreateConversation,
};
