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

function billableWeight(weight, kind) {
  const n = Math.max(0, Number(weight || 0));

  if (n <= 0) return 0;

  const rounded = Math.ceil(n / 0.5) * 0.5;

  return kind === "forwarding"
    ? Math.max(1, rounded)
    : Math.max(0.5, rounded);
}

function calculateFee(orders) {
  let forwardingWeight = 0;
  let purchaseWeight = 0;

  for (const order of orders) {
    const weight = Math.max(0, Number(order.weight_kg || 0));

    if (order.platform === "集運") {
      forwardingWeight += weight;
    } else {
      purchaseWeight += weight;
    }
  }

  const forwardingBill =
    billableWeight(forwardingWeight, "forwarding");
  const purchaseBill =
    billableWeight(purchaseWeight, "purchase");

  return Math.round(
    forwardingBill * 90 +
    purchaseBill * 70
  );
}

function deliveryLabel(value) {
  return value === "shop_delivery" ? "賣貨便" : "宅配";
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

  const orderIds = Array.isArray(req.body?.order_ids)
    ? [...new Set(
        req.body.order_ids
          .map(value => Number(value))
          .filter(value => Number.isInteger(value) && value > 0)
      )]
    : [];

  const batchId = Number(req.body?.shipping_batch_id || 0);
  const deliveryType =
    String(req.body?.delivery_type || "").trim();

  if (!customerName) {
    return res.status(400).json({
      success: false,
      error: "缺少會員姓名"
    });
  }

  if (!orderIds.length) {
    return res.status(400).json({
      success: false,
      error: "請至少選擇一筆包裹"
    });
  }

  if (
    !Number.isInteger(batchId) ||
    batchId <= 0 ||
    !["home_delivery", "shop_delivery"].includes(deliveryType)
  ) {
    return res.status(400).json({
      success: false,
      error: "請選擇有效船班"
    });
  }

  let conn;

  try {
    conn = await mysql.createConnection(dbConfig());
    await conn.beginTransaction();

    const [batchRows] = await conn.execute(
      `
      SELECT
        batch_id,
        batch_text,
        delivery_type
      FROM shipping_batches
      WHERE batch_id = ?
        AND is_active = 1
      LIMIT 1
      FOR UPDATE
      `,
      [batchId]
    );

    if (!batchRows.length) {
      throw new Error("所選船班目前已停用，請重新選擇");
    }

    const batch = batchRows[0];

    if (batch.delivery_type !== deliveryType) {
      throw new Error("船班與台灣端寄送方式不一致");
    }

    const placeholders =
      orderIds.map(() => "?").join(",");

    const [orders] = await conn.execute(
      `
      SELECT
        o.order_id,
        o.platform,
        o.tracking_number,
        o.weight_kg
      FROM orders o
      WHERE o.order_id IN (${placeholders})
        AND LOWER(TRIM(o.customer_name)) = LOWER(TRIM(?))
        AND COALESCE(o.is_returned, 0) = 0
        AND COALESCE(o.order_status, '正常') <> '取消'
        AND COALESCE(o.is_arrived, 0) = 1
        AND (
          COALESCE(o.is_early_returned, 0) = 1
          OR NOT EXISTS (
            SELECT 1
            FROM orders pending
            WHERE LOWER(TRIM(pending.customer_name))
                  = LOWER(TRIM(o.customer_name))
              AND COALESCE(pending.is_arrived, 0) = 0
              AND COALESCE(pending.is_returned, 0) = 0
              AND COALESCE(pending.order_status, '正常') <> '取消'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM customer_return_request_items ri
          INNER JOIN customer_return_requests rr
            ON rr.request_id = ri.request_id
          WHERE ri.order_id = o.order_id
            AND rr.status = 'pending'
        )
      FOR UPDATE
      `,
      [...orderIds, customerName]
    );

    if (orders.length !== orderIds.length) {
      throw new Error(
        "部分包裹已不符合運回條件，請重新整理後再申請"
      );
    }

    const totalWeight = orders.reduce(
      (sum, order) =>
        sum + Math.max(0, Number(order.weight_kg || 0)),
      0
    );

    const estimatedFee = calculateFee(orders);

    const [insertResult] = await conn.execute(
      `
      INSERT INTO customer_return_requests (
        customer_name,
        selected_shipping_batch,
        delivery_method,
        total_count,
        total_weight,
        estimated_fee,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        customerName,
        batch.batch_text,
        deliveryLabel(deliveryType),
        orders.length,
        totalWeight.toFixed(3),
        estimatedFee
      ]
    );

    const requestId = insertResult.insertId;

    for (const order of orders) {
      await conn.execute(
        `
        INSERT INTO customer_return_request_items (
          request_id,
          order_id,
          tracking_number,
          platform,
          weight_kg
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          requestId,
          order.order_id,
          order.tracking_number || null,
          order.platform || null,
          Number(order.weight_kg || 0)
        ]
      );
    }

    await conn.commit();

    return res.status(200).json({
      success: true,
      request_id: requestId,
      total_count: orders.length,
      total_weight: totalWeight,
      estimated_fee: estimatedFee
    });

  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }

    console.error("submit-return-request error:", err);

    return res.status(400).json({
      success: false,
      error: err.message
    });
  } finally {
    if (conn) await conn.end();
  }
}
