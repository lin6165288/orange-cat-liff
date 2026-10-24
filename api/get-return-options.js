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

  const customerName = String(req.body?.customer_name || "").trim();

  if (!customerName) {
    return res.status(400).json({
      success: false,
      error: "缺少會員姓名"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());

    const [batches] = await conn.execute(`
      SELECT
        batch_id,
        batch_text,
        delivery_type,
        sort_order
      FROM shipping_batches
      WHERE is_active = 1
      ORDER BY
        delivery_type ASC,
        sort_order ASC,
        batch_id DESC
    `);

    const [orders] = await conn.execute(
      `
      SELECT
        o.order_id,
        o.order_time,
        o.platform,
        o.tracking_number,
        o.weight_kg,
        o.is_early_returned
      FROM orders o
      WHERE LOWER(TRIM(o.customer_name)) = LOWER(TRIM(?))
        AND COALESCE(o.is_returned, 0) = 0
        AND COALESCE(o.order_status, '正常') <> '取消'
        AND COALESCE(o.is_arrived, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM customer_return_request_items ri
          INNER JOIN customer_return_requests rr
            ON rr.request_id = ri.request_id
          WHERE ri.order_id = o.order_id
            AND rr.status = 'pending'
        )
      ORDER BY o.order_id DESC
      LIMIT 300
      `,
      [customerName]
    );

    const [pendingRequests] = await conn.execute(
      `
      SELECT
        request_id,
        selected_shipping_batch,
        delivery_method,
        total_count,
        total_weight,
        estimated_fee,
        created_at
      FROM customer_return_requests
      WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
        AND status = 'pending'
      ORDER BY created_at DESC, request_id DESC
      LIMIT 20
      `,
      [customerName]
    );

    return res.status(200).json({
      success: true,
      batches,
      orders,
      pending_requests: pendingRequests
    });

  } catch (err) {
    console.error("get-return-options error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (conn) await conn.end();
  }
}
