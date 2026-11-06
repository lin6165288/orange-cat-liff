import mysql from "mysql2/promise";
import nodemailer from "nodemailer";

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

function taipeiTimeText() {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendReturnRequestNotification({
  requestId,
  customerName,
  selectedShippingBatch,
  deliveryMethod,
  totalCount,
  totalWeight,
  estimatedFee,
  orders
}) {
  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPassword = String(process.env.SMTP_PASSWORD || "").trim();
  const notifyEmail = String(
    process.env.NOTIFY_EMAIL || smtpUser
  ).trim();

  if (!smtpUser || !smtpPassword || !notifyEmail) {
    console.warn(
      "Return request email skipped: SMTP_USER / SMTP_PASSWORD / NOTIFY_EMAIL not configured."
    );
    return false;
  }

  const host = String(
    process.env.SMTP_HOST || "smtp.gmail.com"
  ).trim();

  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(
    process.env.SMTP_SECURE || (port === 465 ? "true" : "false")
  ).toLowerCase() === "true";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: smtpUser,
      pass: smtpPassword
    }
  });

  const rows = orders.map(order => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">#${escapeHtml(order.order_id)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(order.platform || "—")}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(order.tracking_number || "—")}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(order.weight_kg || 0).toFixed(2)} kg</td>
    </tr>
  `).join("");

  const subject =
    `[橘貓代購] 新運回申請 #${requestId}｜${customerName}`;

  const text = [
    `橘貓代購收到新的前台運回申請`,
    ``,
    `申請編號：#${requestId}`,
    `客戶：${customerName}`,
    `申請時間（台灣）：${taipeiTimeText()}`,
    `台灣端寄送：${deliveryMethod}`,
    `船班 / 時效：${selectedShippingBatch}`,
    `件數：${totalCount}`,
    `總重量：${Number(totalWeight || 0).toFixed(2)} kg`,
    `預估國際運費：NT$${Math.round(Number(estimatedFee || 0))}`,
    ``,
    `訂單：`,
    ...orders.map(
      order =>
        `#${order.order_id}｜${order.platform || "—"}｜${order.tracking_number || "—"}｜${Number(order.weight_kg || 0).toFixed(2)} kg`
    )
  ].join("\n");

  const html = `
    <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;color:#262626;line-height:1.6;">
      <h2 style="margin:0 0 16px;color:#f08300;">新的前台運回申請</h2>
      <table style="border-collapse:collapse;width:100%;max-width:680px;">
        <tr><td style="padding:6px 0;color:#888;width:150px;">申請編號</td><td><strong>#${requestId}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#888;">客戶</td><td>${escapeHtml(customerName)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">申請時間（台灣）</td><td>${escapeHtml(taipeiTimeText())}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">台灣端寄送</td><td>${escapeHtml(deliveryMethod)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">船班 / 時效</td><td>${escapeHtml(selectedShippingBatch)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">件數</td><td>${totalCount} 件</td></tr>
        <tr><td style="padding:6px 0;color:#888;">總重量</td><td>${Number(totalWeight || 0).toFixed(2)} kg</td></tr>
        <tr><td style="padding:6px 0;color:#888;">預估國際運費</td><td><strong>NT$${Math.round(Number(estimatedFee || 0))}</strong></td></tr>
      </table>

      <h3 style="margin:22px 0 8px;">申請包裹</h3>
      <table style="border-collapse:collapse;width:100%;max-width:680px;border:1px solid #eee;">
        <thead>
          <tr style="background:#fafafa;">
            <th style="padding:8px;text-align:left;">訂單</th>
            <th style="padding:8px;text-align:left;">平台</th>
            <th style="padding:8px;text-align:left;">快遞單號</th>
            <th style="padding:8px;text-align:right;">重量</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  await transporter.sendMail({
    from: `"橘貓代購" <${smtpUser}>`,
    to: notifyEmail,
    subject,
    text,
    html
  });

  return true;
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

  const rawBatchId = req.body?.shipping_batch_id;
  const batchId =
    rawBatchId === null || rawBatchId === undefined || rawBatchId === ""
      ? null
      : Number(rawBatchId);

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

  if (!["home_delivery", "shop_delivery"].includes(deliveryType)) {
    return res.status(400).json({
      success: false,
      error: "請選擇有效寄送方式"
    });
  }

  if (
    deliveryType === "shop_delivery" &&
    (!Number.isInteger(batchId) || batchId <= 0)
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

    let selectedShippingBatch = "宅配｜每日皆可申請｜預計 4–6 天到貨";

    if (deliveryType === "shop_delivery") {
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

      selectedShippingBatch = batch.batch_text;
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
        selectedShippingBatch,
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

    let notificationSent = false;

    try {
      notificationSent = await sendReturnRequestNotification({
        requestId,
        customerName,
        selectedShippingBatch,
        deliveryMethod: deliveryLabel(deliveryType),
        totalCount: orders.length,
        totalWeight,
        estimatedFee,
        orders
      });
    } catch (mailErr) {
      console.error("return request email notification failed:", mailErr);
    }

    return res.status(200).json({
      success: true,
      request_id: requestId,
      total_count: orders.length,
      total_weight: totalWeight,
      estimated_fee: estimatedFee,
      notification_sent: notificationSent
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
