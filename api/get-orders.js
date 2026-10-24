import mysql from "mysql2/promise";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false });
  }

  let conn;

  try {
    const { customer_name } = req.body;

    conn = await mysql.createConnection({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE
    });

    const [orders] = await conn.execute(
      `
      SELECT
        order_id,
        order_time,
        platform,
        tracking_number,
        amount_rmb,
        weight_kg,
        is_arrived,
        is_returned,
        is_early_returned,
        COALESCE(order_status, '正常') AS order_status
      FROM orders
      WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
        AND COALESCE(order_status, '正常') <> '取消'
      ORDER BY order_time DESC, order_id DESC
      `,
      [customer_name]
    );

    return res.status(200).json({
      success: true,
      orders
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (conn) await conn.end();
  }
}
