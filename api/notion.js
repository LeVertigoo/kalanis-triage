const DB_ID = "309656bd751e80d2ba5cdba74a6d4fcf";
const THOMAS_USER_ID = "fc0ed860-5711-4ff7-894b-f62c75621643";
const LORIS_EMAIL = "loris.mourard@gmail.com";

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

// Récupère l'ID Notion de Loris via son email
async function getLorisId(token) {
  try {
    const data = await notionRequest("GET", "/users", null, token);
    const loris = data.results?.find(
      (u) => u.person?.email?.toLowerCase() === LORIS_EMAIL.toLowerCase()
    );
    return loris?.id ?? null;
  } catch {
    return null;
  }
}

// Cherche un contact existant par URL LinkedIn
async function findExistingPage(urlKey, profileUrl, token) {
  if (!urlKey || !profileUrl) return null;
  try {
    const result = await notionRequest("POST", `/databases/${DB_ID}/query`, {
      filter: { property: urlKey, url: { equals: profileUrl } },
      page_size: 1,
    }, token);
    return result.results?.[0] ?? null;
  } catch {
    return null;
  }
}

// Génère une icône initiales via UI Avatars
function getAvatarUrl(name) {
  const encoded = encodeURIComponent(name.trim());
  return `https://ui-avatars.com/api/?name=${encoded}&background=0A66C2&color=fff&bold=true&size=128&format=png`;
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

  // ── Assignation ─────────────────────────────
  if (schema["Assignation"]?.type === "people") {
    props["Assignation"] = { people: [{ object: "user", id: THOMAS_USER_ID }] };
  } else if (schema["Assignation"]?.type === "select") {
    props["Assignation"] = { select: { name: "Thomas" } };
  }

  // ── Source ─────────────────────────────────
  if (schema["Source"]?.type === "select") {
    props["Source"] = { select: { name: "Follow" } };
  } else if (schema["Source"]?.type === "multi_select") {
    props["Source"] = { multi_select: [{ name: "Follow" }] };
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

  return { props, dateKey, urlKey, statusKey };
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

    const today = new Date().toISOString().slice(0, 10);
    const [schema, lorisId] = await Promise.all([getSchema(token), getLorisId(token)]);
    const { props, dateKey, urlKey, statusKey } = buildProperties(schema, contact.name, statusValue, contact.url);

    // ── Cherche si contact déjà dans Notion ────
    const existing = await findExistingPage(urlKey, contact.url, token);

    if (existing) {
      // Vérifie si Loris est dans l'assignation
      const currentPeople = existing.properties?.["Assignation"]?.people ?? [];
      const lorisIsAssigned = lorisId && currentPeople.some((p) => p.id === lorisId);
      const thomasIsAssigned = currentPeople.some((p) => p.id === THOMAS_USER_ID);

      const updateProps = {};

      // Toujours mettre la date à jour
      if (dateKey) updateProps[dateKey] = { date: { start: today } };

      if (lorisIsAssigned && !thomasIsAssigned) {
        // Loris avait le prospect → on ajoute Thomas et on met à jour le status
        updateProps["Assignation"] = {
          people: [
            { object: "user", id: THOMAS_USER_ID },
            { object: "user", id: lorisId },
          ],
        };
        if (statusKey) {
          const t = schema[statusKey].type;
          if (t === "status") updateProps[statusKey] = { status: { name: statusValue } };
          else if (t === "select") updateProps[statusKey] = { select: { name: statusValue } };
        }
      }
      // Si Thomas est déjà assigné seul → juste la date (pas de changement de status)

      await notionRequest("PATCH", `/pages/${existing.id}`, {
        properties: updateProps,
      }, token);

      return res.status(200).json({
        ok: true,
        updated: true,
        lorisTransferred: lorisIsAssigned && !thomasIsAssigned,
        id: existing.id,
      });
    }

    // ── Nouvelle fiche ──────────────────────────
    const page = await notionRequest("POST", "/pages", {
      parent: { database_id: DB_ID },
      properties: props,
      icon: {
        type: "external",
        external: { url: getAvatarUrl(contact.name) },
      },
    }, token);

    return res.status(200).json({ ok: true, updated: false, id: page.id });
  } catch (err) {
    console.error("Notion error:", err.message);
    return res.status(400).json({ error: err.message });
  }
}
