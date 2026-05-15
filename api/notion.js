const DB_ID = "309656bd751e80d2ba5cdba74a6d4fcf";
const THOMAS_USER_ID = "fc0ed860-5711-4ff7-894b-f62c75621643";
const LORIS_EMAIL = "loris.mourard@gmail.com";

// Noms exacts des propriétés (depuis /api/debug)
const PROPS = {
  title:      "Name",
  status:     "Status",
  assignation:"Assignation",
  source:     "Source",
  date:       "Date de contact",
  url:        "Lien du profil",
};

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

// Extrait le slug LinkedIn : "https://linkedin.com/in/john-doe?foo=bar" → "/in/john-doe"
function extractLinkedInSlug(url) {
  if (!url) return null;
  const match = url.match(/\/in\/([^/?#]+)/i);
  return match ? `/in/${match[1]}` : null;
}

// Cherche un contact existant via le slug de son URL LinkedIn
async function findExistingPage(profileUrl, token) {
  const slug = extractLinkedInSlug(profileUrl);
  if (!slug) return null;

  const result = await notionRequest("POST", `/databases/${DB_ID}/query`, {
    filter: {
      property: PROPS.url,
      url: { contains: slug },
    },
    page_size: 1,
  }, token);

  return result.results?.[0] ?? null;
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

// Icône initiales (bleu LinkedIn)
function getAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name.trim())}&background=0A66C2&color=fff&bold=true&size=128`;
}

function buildNewPageProps(name, statusValue, profileUrl) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    [PROPS.title]:      { title: [{ text: { content: name } }] },
    [PROPS.status]:     { status: { name: statusValue } },
    [PROPS.assignation]:{ people: [{ object: "user", id: THOMAS_USER_ID }] },
    [PROPS.source]:     { multi_select: [{ name: "Follow" }] },
    [PROPS.date]:       { date: { start: today } },
    [PROPS.url]:        { url: profileUrl || null },
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN non configuré" });

  try {
    const { contact, status: statusValue } = req.body;
    if (!contact || !statusValue) return res.status(400).json({ error: "contact et status requis" });

    const today = new Date().toISOString().slice(0, 10);

    // Recherche doublon + ID Loris en parallèle
    const [existing, lorisId] = await Promise.all([
      findExistingPage(contact.url, token),
      getLorisId(token),
    ]);

    if (existing) {
      const currentPeople = existing.properties?.[PROPS.assignation]?.people ?? [];
      const lorisAssigned = lorisId && currentPeople.some((p) => p.id === lorisId);
      const thomasAssigned = currentPeople.some((p) => p.id === THOMAS_USER_ID);

      const updateProps = {
        [PROPS.date]: { date: { start: today } },
      };

      if (lorisAssigned && !thomasAssigned) {
        // Prospect de Loris → on ajoute Thomas + on met à jour le status
        updateProps[PROPS.assignation] = {
          people: [
            { object: "user", id: THOMAS_USER_ID },
            { object: "user", id: lorisId },
          ],
        };
        updateProps[PROPS.status] = { status: { name: statusValue } };
      }

      await notionRequest("PATCH", `/pages/${existing.id}`, {
        properties: updateProps,
      }, token);

      return res.status(200).json({
        ok: true,
        updated: true,
        lorisTransferred: lorisAssigned && !thomasAssigned,
        id: existing.id,
      });
    }

    // Nouvelle fiche
    const page = await notionRequest("POST", "/pages", {
      parent: { database_id: DB_ID },
      properties: buildNewPageProps(contact.name, statusValue, contact.url),
      icon: { type: "external", external: { url: getAvatarUrl(contact.name) } },
    }, token);

    return res.status(200).json({ ok: true, updated: false, id: page.id });

  } catch (err) {
    console.error("Notion error:", err.message);
    return res.status(400).json({ error: err.message });
  }
}
