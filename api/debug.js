export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "Pas de NOTION_TOKEN" });

  const DB_ID = "309656bd751e80d2ba5cdba74a6d4fcf";

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    const db = await r.json();

    // Retourne tous les noms + types de propriétés
    const schema = Object.entries(db.properties || {}).map(([name, info]) => ({
      name,
      type: info.type,
    }));

    return res.status(200).json({ schema });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
