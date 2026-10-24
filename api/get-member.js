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
        member_id,
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

    const member = rows[0];
    let balanceTwd = 0;
    let pointsBalance = 0;
    let coupons = [];

    try {
      const [balanceRows] = await conn.execute(
        `
        SELECT balance
        FROM member_balances
        WHERE member_id = ?
        LIMIT 1
        `,
        [member.member_id]
      );

      if (balanceRows.length) {
        balanceTwd = Number(balanceRows[0].balance || 0);
      }
    } catch (err) {
      console.warn("member balance unavailable:", err.message);
    }

    try {
      const [pointRows] = await conn.execute(
        `
        SELECT balance
        FROM member_points
        WHERE member_id = ?
        LIMIT 1
        `,
        [member.member_id]
      );

      if (pointRows.length) {
        pointsBalance = Number(pointRows[0].balance || 0);
      }
    } catch (err) {
      console.warn("member points unavailable:", err.message);
    }

    try {
      const [couponRows] = await conn.execute(
        `
        SELECT
          mc.member_coupon_id,
          mc.issued_reason,
          mc.issued_at,
          mc.expires_at,
          ct.coupon_name,
          ct.description,
          ct.effect_type,
          ct.effect_value
        FROM member_coupons mc
        LEFT JOIN coupon_templates ct
          ON ct.coupon_id = mc.coupon_id
        WHERE mc.member_id = ?
          AND mc.status = 'unused'
          AND (
            mc.expires_at IS NULL
            OR mc.expires_at >= CURDATE()
          )
        ORDER BY
          CASE WHEN mc.expires_at IS NULL THEN 1 ELSE 0 END,
          mc.expires_at ASC,
          mc.issued_at DESC
        LIMIT 30
        `,
        [member.member_id]
      );

      coupons = couponRows;
    } catch (err) {
      console.warn("member coupons unavailable:", err.message);
    }

    return res.status(200).json({
      success: true,
      bound: true,
      member: {
        ...member,
        balance_twd: balanceTwd,
        points_balance: pointsBalance,
        available_coupon_count: coupons.length,
        coupons
      }
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
