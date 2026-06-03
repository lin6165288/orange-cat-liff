export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    message: "API 測試成功"
  });
}