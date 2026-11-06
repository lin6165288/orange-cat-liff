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

function safeText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
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

async function ensureIssueReportTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS system_issue_reports (
      report_id INT AUTO_INCREMENT PRIMARY KEY,
      issue_type VARCHAR(50) NOT NULL,
      page_name VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      customer_name VARCHAR(255) NULL,
      line_user_id VARCHAR(255) NULL,
      frontend_version VARCHAR(50) NULL,
      page_path VARCHAR(255) NULL,
      status VARCHAR(20) NOT NULL DEFAULT '待處理',
      staff_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_issue_status (status),
      INDEX idx_issue_created_at (created_at),
      INDEX idx_issue_customer (customer_name)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

async function sendIssueNotification(report) {
  const smtpUser = safeText(process.env.SMTP_USER, 255);
  const smtpPassword = safeText(process.env.SMTP_PASSWORD, 255);
  const notifyEmail = safeText(
    process.env.NOTIFY_EMAIL || smtpUser,
    255
  );

  if (!smtpUser || !smtpPassword || !notifyEmail) {
    console.warn(
      "Issue report email skipped: SMTP_USER / SMTP_PASSWORD / NOTIFY_EMAIL not configured."
    );
    return false;
  }

  const host = safeText(
    process.env.SMTP_HOST || "smtp.gmail.com",
    255
  );

  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(
    process.env.SMTP_SECURE || (port === 465 ? "true" : "false")
  ).toLowerCase() === "true";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: smtpUser,
      pass: smtpPassword
    }
  });

  const subject =
    `[橘貓代購] 系統問題回報 #${report.reportId}｜${report.issueType}`;

  const identity = report.customerName
    ? `${report.customerName}${report.lineUserId ? ` / ${report.lineUserId}` : ""}`
    : (report.lineUserId || "未綁定會員");

  const text = [
    "橘貓代購收到新的系統問題回報",
    "",
    `回報編號：#${report.reportId}`,
    `問題類型：${report.issueType}`,
    `發生頁面：${report.pageName}`,
    `會員：${identity}`,
    `前台版本：${report.frontendVersion || "—"}`,
    `頁面路徑：${report.pagePath || "—"}`,
    `回報時間（台灣）：${taipeiTimeText()}`,
    "",
    "問題描述：",
    report.description
  ].join("\n");

  const html = `
    <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;color:#262626;line-height:1.7;">
      <h2 style="margin:0 0 16px;color:#f08300;">新的系統問題回報</h2>
      <table style="border-collapse:collapse;width:100%;max-width:680px;">
        <tr><td style="padding:5px 0;color:#888;width:130px;">回報編號</td><td><strong>#${report.reportId}</strong></td></tr>
        <tr><td style="padding:5px 0;color:#888;">問題類型</td><td>${escapeHtml(report.issueType)}</td></tr>
        <tr><td style="padding:5px 0;color:#888;">發生頁面</td><td>${escapeHtml(report.pageName)}</td></tr>
        <tr><td style="padding:5px 0;color:#888;">會員</td><td>${escapeHtml(identity)}</td></tr>
        <tr><td style="padding:5px 0;color:#888;">前台版本</td><td>${escapeHtml(report.frontendVersion || "—")}</td></tr>
        <tr><td style="padding:5px 0;color:#888;">頁面路徑</td><td>${escapeHtml(report.pagePath || "—")}</td></tr>
        <tr><td style="padding:5px 0;color:#888;">回報時間（台灣）</td><td>${escapeHtml(taipeiTimeText())}</td></tr>
      </table>
      <div style="margin-top:18px;padding:14px 16px;border:1px solid #eee;border-radius:10px;background:#fafafa;white-space:pre-wrap;">${escapeHtml(report.description)}</div>
    </div>
  `;

  await transporter.sendMail({
    from: `"橘貓代購" <${smtpUser}>`,
    to: notifyEmail,
    subject,
    text,
    html
  });

  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const allowedTypes = new Set([
    "頁面無法操作",
    "資料顯示異常",
    "訂單資料問題",
    "付款或金額問題",
    "會員資料問題",
    "其他"
  ]);

  const issueType = safeText(req.body?.issue_type, 50);
  const pageName = safeText(req.body?.page_name, 100);
  const description = safeText(req.body?.description, 2000);
  const customerName = safeText(req.body?.customer_name, 255);
  const lineUserId = safeText(req.body?.line_user_id, 255);
  const frontendVersion = safeText(req.body?.frontend_version, 50);
  const pagePath = safeText(req.body?.page_path, 255);

  if (!allowedTypes.has(issueType)) {
    return res.status(400).json({
      success: false,
      error: "問題類型不正確"
    });
  }

  if (!pageName) {
    return res.status(400).json({
      success: false,
      error: "請選擇發生頁面"
    });
  }

  if (description.length < 5) {
    return res.status(400).json({
      success: false,
      error: "請再描述詳細一點"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());
    await ensureIssueReportTable(conn);

    const [result] = await conn.execute(
      `
      INSERT INTO system_issue_reports (
        issue_type,
        page_name,
        description,
        customer_name,
        line_user_id,
        frontend_version,
        page_path,
        status,
        staff_note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, '待處理', NULL)
      `,
      [
        issueType,
        pageName,
        description,
        customerName || null,
        lineUserId || null,
        frontendVersion || null,
        pagePath || null
      ]
    );

    const reportId = Number(result.insertId);

    try {
      await sendIssueNotification({
        reportId,
        issueType,
        pageName,
        description,
        customerName,
        lineUserId,
        frontendVersion,
        pagePath
      });
    } catch (mailError) {
      console.error(
        "issue report email notification failed:",
        mailError
      );
    }

    return res.status(200).json({
      success: true,
      report_id: reportId
    });

  } catch (err) {
    console.error("submit-issue-report error:", err);

    return res.status(500).json({
      success: false,
      error: "問題回報送出失敗，請稍後再試"
    });
  } finally {
    if (conn) await conn.end();
  }
}
