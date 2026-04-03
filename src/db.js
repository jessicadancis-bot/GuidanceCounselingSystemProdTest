const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.on("connection", async (conn) => {
  try {
    await conn.promise().query("SET time_zone = '+08:00'");

    await conn.promise().query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
  } catch (err) {
    console.error("Failed to set MySQL timezone:", err);
  }
});

module.exports = pool;
