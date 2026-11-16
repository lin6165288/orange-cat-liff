import mysql from "mysql2/promise";
import nodemailer from "nodemailer";

function dbConfig() {
  return {
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE
  };
}

function taipeiTimeText() {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mailConfig() {
  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPassword = String(process.env.SMTP_PASSWORD || "").trim();
  const notifyEmail = String(
    process.env.NOTIFY_EMAIL || smtpUser
  ).trim();

  if (!smtpUser || !smtpPassword || !notifyEmail) {
    return null;
  }

  const host = String(
    process.env.SMTP_HOST || "smtp.gmail.com"
  ).trim();

  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(
    process.env.SMTP_SECURE || (port === 465 ? "true" : "false")
  ).toLowerCase() === "true";

  return {
    smtpUser,
    notifyEmail,
    transporter: nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: smtpUser,
        pass: smtpPassword
      }
    })
  };
}


async function sendFeedbackNotification({
  feedbackId,
  content
}) {
  const config = mailConfig();

  if (!config) {
    console.warn(
      "Feedback email skipped: SMTP_USER / SMTP_PASSWORD / NOTIFY_EMAIL not configured."
    );
    return false;
  }

  const subject =
    `[橘貓代購] 新匿名回饋 #${feedbackId}`;

  const text = [
    "橘貓代購收到新的匿名回饋",
    "",
    `回饋編號：#${feedbackId}`,
    `回饋時間（台灣）：${taipeiTimeText()}`,
    "",
    "回饋內容：",
    content
  ].join("\n");

  const html = `
    <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;color:#262626;line-height:1.7;">
      <h2 style="margin:0 0 16px;color:#f08300;">新的匿名回饋</h2>
      <table style="border-collapse:collapse;width:100%;max-width:680px;">
        <tr><td style="padding:6px 0;color:#888;width:140px;">回饋編號</td><td><strong>#${feedbackId}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#888;">回饋時間（台灣）</td><td>${escapeHtml(taipeiTimeText())}</td></tr>
      </table>
      <div style="margin-top:18px;padding:14px 16px;border:1px solid #eee;border-radius:10px;background:#fafafa;white-space:pre-wrap;">${escapeHtml(content)}</div>
    </div>
  `;

  await config.transporter.sendMail({
    from: `"橘貓代購" <${config.smtpUser}>`,
    to: config.notifyEmail,
    subject,
    text,
    html
  });

  return true;
}

async function findFeedbackTable(conn) {
  const candidates = ["anonymous_feedbacks", "feedbacks"];
  const required = new Set([
    "id",
    "content",
    "status",
    "staff_note",
    "created_at"
  ]);

  const [tableRows] = await conn.execute(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('anonymous_feedbacks', 'feedbacks')
  `);

  const existing = new Set(
    tableRows.map(row => String(row.TABLE_NAME || row.table_name || ""))
  );

  for (const tableName of candidates) {
    if (!existing.has(tableName)) continue;

    const [columnRows] = await conn.execute(
      `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      `,
      [tableName]
    );

    const names = new Set(
      columnRows.map(row => String(row.COLUMN_NAME || row.column_name || ""))
    );

    if ([...required].every(name => names.has(name))) {
      return tableName;
    }
  }

  await conn.query(`
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

    const feedbackId = Number(result.insertId);

    try {
      await sendFeedbackNotification({
        feedbackId,
        content
      });
    } catch (mailError) {
      console.error(
        "feedback email notification failed:",
        mailError
      );
    }

    return res.status(200).json({
      success: true,
      feedback_id: feedbackId
    });

  } catch (err) {
    console.error("submit-feedback error:", err);

    const code = String(err?.code || "");
    const safeMessage =
      code === "ER_NO_SUCH_TABLE"
        ? "匿名回饋資料表尚未建立"
        : code === "ER_BAD_FIELD_ERROR"
          ? "匿名回饋資料表欄位不相容"
          : code === "ER_DBACCESS_DENIED_ERROR" || code === "ER_TABLEACCESS_DENIED_ERROR"
            ? "資料庫帳號沒有匿名回饋資料表權限"
            : "回饋送出失敗，請稍後再試";

    return res.status(500).json({
      success: false,
      error: safeMessage
    });
  } finally {
    if (conn) await conn.end();
  }
}
