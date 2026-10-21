require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");
  if (!username || !password || password === "change-this-before-use" || password.length < 12) {
    throw new Error("Set ADMIN_USERNAME and a unique ADMIN_PASSWORD of at least 12 characters in .env first.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO staff_users (username, password_hash, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = TRUE`,
      [username, hash]
    );
    console.log(`Admin account configured for username: ${username}`);
  } finally { await pool.end(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
