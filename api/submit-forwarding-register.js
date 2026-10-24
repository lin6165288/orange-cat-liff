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

    return res.status(200).json({
      success: true,
      register_id: result.insertId,
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
