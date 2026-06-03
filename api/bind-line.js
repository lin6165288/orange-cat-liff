import mysql from "mysql2/promise";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {

    const { phone, line_user_id, line_name } = req.body;

    const connection = await mysql.createConnection({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE
    });

    await connection.execute(
      `
      UPDATE members
      SET
        line_user_id = ?,
        line_name = ?
      WHERE customer_name = ?
      `,
      [
        line_user_id,
        line_name,
        phone
      ]
    );

    await connection.end();

    return res.status(200).json({
      success: true
    });

  } catch (err) {

    return res.status(500).json({
      success: false,
      error: err.message
    });

  }

}
