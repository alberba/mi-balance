import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databasePath = process.env.DATABASE_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), "data/mi-balance.sqlite3");
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:4322";
const allowSignup = process.env.ALLOW_SIGNUP === "true";
const secret = process.env.BETTER_AUTH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET debe tener al menos 32 caracteres.");
}

mkdirSync(path.dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const auth = betterAuth({
  database: sqlite,
  baseURL,
  secret,
  trustedOrigins: [new URL(baseURL).origin],
  emailAndPassword: {
    enabled: true,
    disableSignUp: !allowSignup,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  plugins: [
    passkey({
      rpID: new URL(baseURL).hostname,
      rpName: "Mi balance",
      origin: new URL(baseURL).origin,
    }),
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
});
