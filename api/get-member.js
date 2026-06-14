import mysql from "mysql2/promise";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false });
  }

  let conn;

  try {
    const { line_user_id } = req.body;

    conn = await mysql.createConnection({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE
    });

    const [rows] = await conn.execute(
      `
      SELECT
        customer_name,
        member_level,
        line_name
      FROM members
      WHERE line_user_id = ?
      LIMIT 1
      `,
      [line_user_id]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        bound: false
      });
    }

    return res.status(200).json({
      success: true,
      bound: true,
      member: rows[0]
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
