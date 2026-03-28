const pool = require("../db");
const { normalize } = require("../utils/DataHelper");

const getUsers = async ({
  search,
  account_id,
  roles,
  page,
  limit,
  connection = pool,
}) => {
  roles = Array.isArray(roles) ? roles : [];
  search = normalize(search)?.toLowerCase() || undefined;
  account_id = normalize(account_id);
  limit = !isNaN(limit) ? Number(limit) : 100;
  limit = Math.min(limit, 100);
  page = Math.max(1, !isNaN(page) ? Number(page) : 1);
  const offset = (page - 1) * limit;

  const user_rows_where = ["a.is_archived = ?"];
  const user_rows_value = [false];

  if (account_id) {
    user_rows_where.push("a.account_id != ?");
    user_rows_value.push(account_id);
  }

  if (roles.length > 0) {
    const placeholders = roles.map(() => "?").join(", ");
    user_rows_where.push(`a.role IN (${placeholders})`);
    user_rows_value.push(...roles);
  }

  if (search && search.trim() !== "") {
    const terms = search.trim().toLowerCase().split(/\s+/);

    for (const term of terms) {
      user_rows_where.push(`
      (LOWER(CONCAT(
        LOWER(u.given_name), ' ',
        COALESCE(CONCAT(LOWER(u.middle_name), ' '), ''),
        LOWER(u.last_name)
      )) LIKE ? OR u.public_id LIKE ?)
    `);
      user_rows_value.push(`%${term}%`, `%${term}%`);
    }
  }

  const [users] = await connection.query(
    `
  SELECT 
    u.public_id AS user_id,
    COUNT(*) OVER()AS total_count,
    u.given_name,
    u.middle_name, 
    u.last_name, 
    u.account_id,
    dp.name AS department,
    crs.name AS course
  FROM accounts AS a
  JOIN users AS u ON a.account_id = u.account_id
  LEFT JOIN departments AS dp ON dp.id = u.department_id
  LEFT JOIN courses AS crs ON crs.id = u.course
  ${user_rows_where.length ? "WHERE " + user_rows_where.join(" AND ") : ""}
  LIMIT ?
  OFFSET ?
  `,
    [...user_rows_value, limit, offset],
  );

  if (!users.length) return { data: [] };

  const search_user_ids = users.map((u) => u.account_id);

  const [convos] = await connection.query(
    `
    SELECT cp1.user_id AS other_user_id, cp1.conversation_id
    FROM conversation_participants AS cp1
    JOIN conversation_participants AS cp2
      ON cp1.conversation_id = cp2.conversation_id
    WHERE cp2.user_id = ? AND cp1.user_id IN (?)
    `,
    [account_id, search_user_ids],
  );

  const convo_map = new Map();
  for (const c of convos) {
    convo_map.set(c.other_user_id, c.conversation_id);
  }

  const total = users[0]?.total_count;
  const total_pages = limit ? Math.ceil(total / limit) : 1;

  const data = users.map((u) => ({
    ...u,
    conversation_id: convo_map.get(u.account_id) || null,
  }));

  return { data, total, total_pages };
};

module.exports = { getUsers };
