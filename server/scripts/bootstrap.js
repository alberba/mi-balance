process.env.ALLOW_SIGNUP = "true";
const { auth, sqlite } = await import("../auth.js");
const { importSeed, initializeDataTables } = await import("../store.js");
const { promises: fs } = await import("node:fs");

initializeDataTables(sqlite);
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  console.log("Bootstrap: define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) para crear la cuenta inicial.");
  sqlite.close();
  process.exit(0);
}

let user = sqlite.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email);
if (!user) {
  await auth.api.signUpEmail({ body: { name: "Administrador", email, password } });
  user = sqlite.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email);
  console.log("Bootstrap: cuenta inicial creada.");
} else {
  console.log("Bootstrap: la cuenta ya existe; no se modifica la contraseña.");
}

if (user && process.env.SEED_FILE) {
  try {
    const seed = JSON.parse(await fs.readFile(process.env.SEED_FILE, "utf8"));
    importSeed(sqlite, user.id, seed);
    console.log("Bootstrap: historial inicial importado.");
  } catch (error) {
    console.warn("Bootstrap: seed omitido:", error.message);
  }
}
sqlite.close();
