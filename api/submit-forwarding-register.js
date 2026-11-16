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


async function sendForwardingNotification({
  registerId,
  customerName,
  trackingNumber,
  itemName,
  quantity,
  unitPrice,
  remarks
}) {
  const config = mailConfig();

  if (!config) {
    console.warn(
      "Forwarding email skipped: SMTP_USER / SMTP_PASSWORD / NOTIFY_EMAIL not configured."
    );
    return false;
  }

  const totalRmb = Number(unitPrice || 0) * Number(quantity || 0);

  const subject =
    `[橘貓代購] 新集運登記 #${registerId}｜${customerName}`;

  const text = [
    "橘貓代購收到新的前台集運登記",
    "",
    `登記編號：#${registerId}`,
    `會員：${customerName}`,
    `登記時間（台灣）：${taipeiTimeText()}`,
    `中國快遞單號：${trackingNumber}`,
    `內容物：${itemName}`,
    `數量：${quantity}`,
    `商品單價：¥${Number(unitPrice || 0).toFixed(2)}`,
    `商品小計：¥${totalRmb.toFixed(2)}`,
    `備註：${remarks || "—"}`
  ].join("\n");

  const html = `
    <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;color:#262626;line-height:1.7;">
      <h2 style="margin:0 0 16px;color:#f08300;">新的前台集運登記</h2>
      <table style="border-collapse:collapse;width:100%;max-width:680px;">
        <tr><td style="padding:6px 0;color:#888;width:140px;">登記編號</td><td><strong>#${registerId}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#888;">會員</td><td>${escapeHtml(customerName)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">登記時間（台灣）</td><td>${escapeHtml(taipeiTimeText())}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">中國快遞單號</td><td><strong>${escapeHtml(trackingNumber)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#888;">內容物</td><td>${escapeHtml(itemName)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">數量</td><td>${quantity}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">商品單價</td><td>¥${Number(unitPrice || 0).toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">商品小計</td><td>¥${totalRmb.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">備註</td><td>${escapeHtml(remarks || "—")}</td></tr>
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

  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const customerName =
    String(req.body?.customer_name || "").trim();

  const trackingNumber =
    String(req.body?.tracking_number || "").trim();

  const itemName =
    String(req.body?.item_name || "").trim();

  const quantity = Number(req.body?.quantity || 0);
  const unitPrice = Number(req.body?.unit_price_rmb || 0);
  const remarks = String(req.body?.remarks || "").trim();

  if (!customerName) {
    return res.status(400).json({
      success: false,
      error: "缺少會員姓名"
    });
  }

  if (!trackingNumber || trackingNumber.length > 255) {
    return res.status(400).json({
      success: false,
      error: "請輸入有效的中國快遞單號"
    });
  }

  if (!itemName || itemName.length > 255) {
    return res.status(400).json({
      success: false,
      error: "請輸入內容物"
    });
  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 999
  ) {
    return res.status(400).json({
      success: false,
      error: "數量請輸入 1～999 的整數"
    });
  }

  if (
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    unitPrice > 99999999
  ) {
    return res.status(400).json({
      success: false,
      error: "商品單價格式不正確"
    });
  }

  if (remarks.length > 1000) {
    return res.status(400).json({
      success: false,
      error: "備註內容過長"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());
    await conn.beginTransaction();

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS customer_forwarding_registers (
        register_id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        tracking_number VARCHAR(255) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        unit_price_rmb DECIMAL(10,2) NOT NULL DEFAULT 0,
        remarks TEXT NULL,
        status ENUM('pending','processed','cancelled') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_tracking_number (tracking_number)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    const [orderRows] = await conn.execute(
      `
      SELECT order_id
      FROM orders
      WHERE tracking_number = ?
      LIMIT 1
      `,
      [trackingNumber]
    );

    if (orderRows.length) {
      throw new Error(
        "這個快遞單號已經存在於訂單中，不需要重複登記"
      );
    }

    const [registerRows] = await conn.execute(
      `
      SELECT
        register_id,
        status
      FROM customer_forwarding_registers
      WHERE tracking_number = ?
      LIMIT 1
      FOR UPDATE
      `,
      [trackingNumber]
    );

    if (registerRows.length) {
      const statusLabel = {
        pending: "待處理",
        processed: "已處理",
        cancelled: "已取消"
      }[registerRows[0].status] || registerRows[0].status;

      throw new Error(
        `這個快遞單號已登記過，目前狀態：${statusLabel}`
      );
    }

    const [result] = await conn.execute(
      `
      INSERT INTO customer_forwarding_registers (
        customer_name,
        tracking_number,
        item_name,
        quantity,
        unit_price_rmb,
        remarks,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        customerName,
        trackingNumber,
        itemName,
        quantity,
        unitPrice.toFixed(2),
        remarks || null
      ]
    );

    await conn.commit();

    const registerId = Number(result.insertId);

    try {
      await sendForwardingNotification({
        registerId,
        customerName,
        trackingNumber,
        itemName,
        quantity,
        unitPrice,
        remarks
      });
    } catch (mailError) {
      console.error(
        "forwarding email notification failed:",
        mailError
      );
    }

    return res.status(200).json({
      success: true,
      register_id: registerId,
      status: "pending"
    });

  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }

    console.error("submit-forwarding-register error:", err);

    return res.status(400).json({
      success: false,
      error: err.message
    });
  } finally {
    if (conn) await conn.end();
  }
}
