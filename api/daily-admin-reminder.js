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

function taipeiParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    dateSlash: `${values.year}/${values.month}/${values.day}`,
    dateDash: `${values.year}-${values.month}-${values.day}`,
    timeText: `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute}:${values.second}`
  };
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
    throw new Error(
      "SMTP_USER / SMTP_PASSWORD / NOTIFY_EMAIL 尚未完整設定"
    );
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

function authorizeCron(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();

  // 未設定時仍允許 Vercel Cron 執行；若有設定則強制驗證。
  if (!secret) return true;

  const auth = String(req.headers.authorization || "");
  return auth === `Bearer ${secret}`;
}

async function loadTodoSnapshot(conn) {
  const taipei = taipeiParts();

  let ordersLastUpdate = "尚未設定";
  let ordersUpdateDue = true;
  let pendingReturnRequests = 0;
  let pendingForwardingRegisters = 0;

  try {
    const [rows] = await conn.execute(`
      SELECT setting_value
      FROM site_settings
      WHERE setting_key = 'orders_last_update_time'
      LIMIT 1
    `);

    if (rows.length) {
      ordersLastUpdate = String(rows[0].setting_value || "").trim() || "尚未設定";
      ordersUpdateDue = !ordersLastUpdate.startsWith(taipei.dateSlash);
    }
  } catch (error) {
    console.warn("daily reminder: site_settings unavailable:", error.message);
  }

  try {
    const [rows] = await conn.execute(`
      SELECT COUNT(*) AS cnt
      FROM customer_return_requests
      WHERE status = 'pending'
    `);
    pendingReturnRequests = Number(rows?.[0]?.cnt || 0);
  } catch (error) {
    console.warn("daily reminder: return requests unavailable:", error.message);
  }

  try {
    const [rows] = await conn.execute(`
      SELECT COUNT(*) AS cnt
      FROM customer_forwarding_registers
      WHERE status = 'pending'
    `);
    pendingForwardingRegisters = Number(rows?.[0]?.cnt || 0);
  } catch (error) {
    console.warn("daily reminder: forwarding registers unavailable:", error.message);
  }

  const taskCount =
    (ordersUpdateDue ? 1 : 0) +
    pendingReturnRequests +
    pendingForwardingRegisters;

  return {
    ...taipei,
    ordersLastUpdate,
    ordersUpdateDue,
    pendingReturnRequests,
    pendingForwardingRegisters,
    taskCount
  };
}

async function sendDailyReminder(snapshot) {
  const config = mailConfig();

  const subject = snapshot.taskCount > 0
    ? `[橘貓代購] 今日待辦｜${snapshot.taskCount} 項待處理`
    : `[橘貓代購] 今日待辦｜目前無待處理事項`;

  const tasks = [];

  if (snapshot.ordersUpdateDue) {
    tasks.push(
      `【更新訂單資料】目前資料更新時間：${snapshot.ordersLastUpdate}`
    );
  }

  if (snapshot.pendingReturnRequests > 0) {
    tasks.push(
      `【前台運回申請】尚有 ${snapshot.pendingReturnRequests} 筆未處理`
    );
  }

  if (snapshot.pendingForwardingRegisters > 0) {
    tasks.push(
      `【集運登記】尚有 ${snapshot.pendingForwardingRegisters} 筆未處理`
    );
  }

  if (!tasks.length) {
    tasks.push("今日目前沒有待處理事項。");
  }

  const text = [
    `橘貓代購每日待辦提醒`,
    `日期：${snapshot.dateSlash}`,
    "",
    ...tasks.map((task, index) => `${index + 1}. ${task}`),
    "",
    `訂單資料更新時間：${snapshot.ordersLastUpdate}`,
    `待處理運回申請：${snapshot.pendingReturnRequests} 筆`,
    `待處理集運登記：${snapshot.pendingForwardingRegisters} 筆`
  ].join("\n");

  const taskHtml = tasks.map((task) => `
    <li style="margin:0 0 10px;padding:12px 14px;border:1px solid #eee;border-radius:10px;background:#fafafa;">
      ${escapeHtml(task)}
    </li>
  `).join("");

  const html = `
    <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;color:#262626;line-height:1.7;max-width:680px;">
      <h2 style="margin:0;color:#f08300;">橘貓代購｜今日待辦</h2>
      <p style="margin:4px 0 18px;color:#888;">${escapeHtml(snapshot.dateSlash)}</p>

      <ul style="list-style:none;padding:0;margin:0 0 18px;">
        ${taskHtml}
      </ul>

      <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;">
        <tr>
          <td style="padding:10px 0;color:#888;">訂單資料更新時間</td>
          <td style="padding:10px 0;text-align:right;font-weight:700;">${escapeHtml(snapshot.ordersLastUpdate)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#888;">待處理運回申請</td>
          <td style="padding:10px 0;text-align:right;font-weight:700;">${snapshot.pendingReturnRequests} 筆</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#888;">待處理集運登記</td>
          <td style="padding:10px 0;text-align:right;font-weight:700;">${snapshot.pendingForwardingRegisters} 筆</td>
        </tr>
      </table>
    </div>
  `;

  await config.transporter.sendMail({
    from: `"橘貓代購" <${config.smtpUser}>`,
    to: config.notifyEmail,
    subject,
    text,
    html
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  if (!authorizeCron(req)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());

    const snapshot = await loadTodoSnapshot(conn);

    await sendDailyReminder(snapshot);

    console.log(
      `daily admin reminder sent: ${snapshot.dateSlash}, tasks=${snapshot.taskCount}`
    );

    return res.status(200).json({
      success: true,
      date: snapshot.dateSlash,
      task_count: snapshot.taskCount,
      pending_return_requests: snapshot.pendingReturnRequests,
      pending_forwarding_registers: snapshot.pendingForwardingRegisters,
      orders_update_due: snapshot.ordersUpdateDue
    });
  } catch (error) {
    console.error("daily admin reminder failed:", error);

    return res.status(500).json({
      success: false,
      message: "每日待辦提醒寄送失敗"
    });
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {}
    }
  }
}
