import mysql from "mysql2/promise";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE
    });

    const [rows] = await conn.execute(`
      SELECT setting_key, setting_value
      FROM site_settings
      WHERE setting_key IN (
        'current_exchange_rate',
        'payment_exchange_rate',
        'orders_last_update_time'
      )
    `);

    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }

    let shippingBatches = [];

    try {
      const [batchRows] = await conn.execute(`
        SELECT
          batch_id,
          batch_text,
          delivery_type,
          sort_order
        FROM shipping_batches
        WHERE is_active = 1
        ORDER BY sort_order ASC, batch_id DESC
        LIMIT 12
      `);

      shippingBatches = batchRows;
    } catch (err) {
      console.warn("shipping batches unavailable:", err.message);
    }

    return res.status(200).json({
      success: true,
      exchange_rate: settings.current_exchange_rate ?? null,
      payment_exchange_rate:
        settings.payment_exchange_rate ?? settings.current_exchange_rate ?? null,
      orders_last_update_time:
        settings.orders_last_update_time ?? null,
      shipping_batches: shippingBatches,
      shipping_value:
        shippingBatches.length > 0
          ? shippingBatches[0].batch_text
          : null
    });

  } catch (err) {
    console.error("get-home-config error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });

  } finally {
    if (conn) {
      await conn.end();
    }
  }
}
