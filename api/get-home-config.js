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
        'orders_last_update_time'
      )
    `);

    const settings = {};

    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }

    return res.status(200).json({
      success: true,
      exchange_rate: settings.current_exchange_rate ?? null,
      orders_last_update_time:
        settings.orders_last_update_time ?? null
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
