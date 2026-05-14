export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(200).json({ connected: false, error: "NOTION_TOKEN manquant" });

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/309656bd751e80d2ba5cdba74a6d4fcf`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (r.ok) {
      const db = await r.json();
      const schema = {};
      for (const [name, info] of Object.entries(db.properties || {})) {
        schema[name] = info.type;
      }
      return res.status(200).json({ connected: true, schema });
    } else {
      const err = await r.json();
      return res.status(200).json({ connected: false, error: err.message });
    }
  } catch (e) {
    return res.status(200).json({ connected: false, error: e.message });
  }
}
