import mysql from "mysql2/promise";

function dbConfig() {
  return {
    host: process.env.MYSQLHOST,
    port: Number(process.env.MYSQLPORT || 3306),
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    connectTimeout: 10000,
    charset: "utf8mb4"
  };
}

function hasDatabaseConfig() {
  return Boolean(
    process.env.MYSQLHOST &&
    process.env.MYSQLUSER &&
    process.env.MYSQLDATABASE
  );
}

async function safeClose(conn) {
  if (!conn) return;

  try {
    await conn.end();
  } catch (err) {
    console.warn(
      "get-member connection close warning:",
      err?.message || err
    );
  }
}

async function loadMemberExtras(conn, memberId) {
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
      [memberId]
    );

    if (balanceRows.length) {
      balanceTwd = Number(
        balanceRows[0].balance || 0
      );
    }
  } catch (err) {
    console.warn(
      "member balance unavailable:",
      err?.message || err
    );
  }

  try {
    const [pointRows] = await conn.execute(
      `
      SELECT balance
      FROM member_points
      WHERE member_id = ?
      LIMIT 1
      `,
      [memberId]
    );

    if (pointRows.length) {
      pointsBalance = Number(
        pointRows[0].balance || 0
      );
    }
  } catch (err) {
    console.warn(
      "member points unavailable:",
      err?.message || err
    );
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
        CASE
          WHEN mc.expires_at IS NULL THEN 1
          ELSE 0
        END,
        mc.expires_at ASC,
        mc.issued_at DESC
      LIMIT 30
      `,
      [memberId]
    );

    coupons = Array.isArray(couponRows)
      ? couponRows
      : [];
  } catch (err) {
    console.warn(
      "member coupons unavailable:",
      err?.message || err
    );
  }

  return {
    balanceTwd,
    pointsBalance,
    coupons
  };
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  if (!hasDatabaseConfig()) {
    console.error(
      "get-member: database environment variables are incomplete"
    );

    return res.status(500).json({
      success: false,
      error: "MEMBER_DB_CONFIG_MISSING"
    });
  }

  const lineUserId =
    typeof req.body?.line_user_id === "string"
      ? req.body.line_user_id.trim()
      : "";

  if (!lineUserId) {
    return res.status(400).json({
      success: false,
      error: "LINE_USER_ID_REQUIRED"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(
      dbConfig()
    );

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
      [lineUserId]
    );

    if (!rows.length) {
      return res.status(200).json({
        success: true,
        bound: false
      });
    }

    const member = rows[0];

    const {
      balanceTwd,
      pointsBalance,
      coupons
    } = await loadMemberExtras(
      conn,
      member.member_id
    );

    return res.status(200).json({
      success: true,
      bound: true,
      member: {
        member_id: member.member_id,
        customer_name:
          member.customer_name || "",
        member_level:
          member.member_level || "一般會員",
        line_name:
          member.line_name || "",
        balance_twd: balanceTwd,
        points_balance: pointsBalance,
        available_coupon_count:
          coupons.length,
        coupons
      }
    });

  } catch (err) {
    console.error(
      "get-member fatal error:",
      err
    );

    return res.status(500).json({
      success: false,
      error:
        err?.code ||
        err?.message ||
        "MEMBER_API_FAILED"
    });

  } finally {
    await safeClose(conn);
  }
}
