import mysql from "mysql2/promise";

function dbConfig() {
  return {
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE
  };
}

async function findFeedbackTable(conn) {
  for (const tableName of ["anonymous_feedbacks", "feedbacks"]) {
    const [tables] = await conn.execute(
      "SHOW TABLES LIKE ?",
      [tableName]
    );

    if (!tables.length) continue;

    const [columns] = await conn.query(
      `SHOW COLUMNS FROM \`${tableName}\``
    );

    const names = new Set(
      columns.map(row => String(row.Field))
    );

    const required = [
      "id",
      "content",
      "status",
      "staff_note",
      "created_at"
    ];

    if (required.every(name => names.has(name))) {
      return tableName;
    }
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS anonymous_feedbacks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT '未處理',
      staff_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_feedback_status (status),
      INDEX idx_feedback_created_at (created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  return "anonymous_feedbacks";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const content =
    String(req.body?.content || "").trim();

  if (content.length < 2) {
    return res.status(400).json({
      success: false,
      error: "請輸入回饋內容"
    });
  }

  if (content.length > 2000) {
    return res.status(400).json({
      success: false,
      error: "回饋內容最多 2000 個字"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());

    const tableName = await findFeedbackTable(conn);

    const [result] = await conn.execute(
      `
      INSERT INTO \`${tableName}\`
        (content, status, staff_note)
      VALUES (?, '未處理', NULL)
      `,
      [content]
    );

    return res.status(200).json({
      success: true,
      feedback_id: result.insertId
    });

  } catch (err) {
    console.error("submit-feedback error:", err);

    return res.status(500).json({
      success: false,
      error: "回饋送出失敗，請稍後再試"
    });
  } finally {
    if (conn) await conn.end();
  }
}
