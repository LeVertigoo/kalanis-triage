const DB_ID = "309656bd751e80d2ba5cdba74a6d4fcf";
const THOMAS_USER_ID = "fc0ed860-5711-4ff7-894b-f62c75621643";

async function notionRequest(method, path, body, token) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || JSON.stringify(data));
  return data;
}

async function getSchema(token) {
  const db = await notionRequest("GET", `/databases/${DB_ID}`, null, token);
  return db.properties || {};
}

function buildProperties(schema, name, statusValue, profileUrl) {
  const today = new Date().toISOString().slice(0, 10);
  const props = {};

  // ── Titre ──────────────────────────────────
  const titleKey = Object.keys(schema).find((k) => schema[k].type === "title") || "Name";
  props[titleKey] = { title: [{ text: { content: name } }] };

  // ── Status ─────────────────────────────────
  const statusKey = Object.keys(schema).find((k) =>
    ["status", "statut"].includes(k.toLowerCase())
  );
  if (statusKey) {
    const t = schema[statusKey].type;
    if (t === "status") props[statusKey] = { status: { name: statusValue } };
    else if (t === "select") props[statusKey] = { select: { name: statusValue } };
  }

  // ── Assignation (People) ────────────────────
  if (schema["Assignation"]) {
    const t = schema["Assignation"].type;
    if (t === "people") {
      props["Assignation"] = { people: [{ object: "user", id: THOMAS_USER_ID }] };
    } else if (t === "select") {
      props["Assignation"] = { select: { name: "Thomas" } };
    }
  }

  // ── Source ─────────────────────────────────
  if (schema["Source"]) {
    const t = schema["Source"].type;
    if (t === "select") {
      props["Source"] = { select: { name: "Follow" } };
    } else if (t === "multi_select") {
      props["Source"] = { multi_select: [{ name: "Follow" }] };
    }
  }

  // ── Date de contact ────────────────────────
  const dateKey = Object.keys(schema).find(
    (k) => schema[k].type === "date" && (
      k.toLowerCase().includes("date") || k.toLowerCase().includes("contact")
    )
  );
  if (dateKey) props[dateKey] = { date: { start: today } };

  // ── Lien du profil ─────────────────────────
  const urlKey = Object.keys(schema).find(
    (k) => schema[k].type === "url" && (
      k.toLowerCase().includes("lien") ||
      k.toLowerCase().includes("profil") ||
      k.toLowerCase().includes("linkedin") ||
      k.toLowerCase().includes("url")
    )
  );
  if (urlKey) props[urlKey] = { url: profileUrl || null };

  return props;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN non configuré dans Vercel" });

  try {
    const { contact, status: statusValue } = req.body;
    if (!contact || !statusValue) return res.status(400).json({ error: "contact et status requis" });

    const schema = await getSchema(token);
    const props = buildProperties(schema, contact.name, statusValue, contact.url);

    const page = await notionRequest("POST", "/pages", {
      parent: { database_id: DB_ID },
      properties: props,
    }, token);

    return res.status(200).json({ ok: true, id: page.id, url: page.url });
  } catch (err) {
    console.error("Notion error:", err.message);
    return res.status(400).json({ error: err.message });
  }
}
