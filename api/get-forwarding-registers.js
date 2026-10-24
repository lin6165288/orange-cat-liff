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

  if (!customerName) {
    return res.status(400).json({
      success: false,
      error: "缺少會員姓名"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());

    const [rows] = await conn.execute(
      `
      SELECT
        register_id,
        tracking_number,
        item_name,
        quantity,
        unit_price_rmb,
        remarks,
        status,
        created_at,
        updated_at
      FROM customer_forwarding_registers
      WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
      ORDER BY created_at DESC, register_id DESC
      LIMIT 100
      `,
      [customerName]
    );

    return res.status(200).json({
      success: true,
      registers: rows
    });

  } catch (err) {
    console.error("get-forwarding-registers error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (conn) await conn.end();
  }
}
