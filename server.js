require("dotenv").config();

const express = require("express");
const http = require("node:http");
const path = require("node:path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { z } = require("zod");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false })); // CSP is configured separately before production.
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const orderSchema = z.object({
  tableNumber: z.string().trim().min(1).max(12),
  customerName: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(300).optional().default(""),
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(20),
    note: z.string().trim().max(160).optional().default("")
  })).min(1).max(30)
});

const statusSchema = z.object({
  status: z.enum(["accepted", "preparing", "ready", "completed", "cancelled"])
});

function authRequired(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!JWT_SECRET) return res.status(503).json({ error: "Authentication is not configured. Set JWT_SECRET." });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sign in required." });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission for this action." });
    next();
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

app.get("/api/menu", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, description, category, price_paise, is_available FROM menu_items WHERE is_available = TRUE ORDER BY category, name"
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.post("/api/orders", async (req, res, next) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order details.", details: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { tableNumber, customerName, notes, items } = parsed.data;
    const ids = [...new Set(items.map(item => item.menuItemId))];
    const { rows: menuRows } = await client.query(
      "SELECT id, name, price_paise, is_available FROM menu_items WHERE id = ANY($1::int[]) FOR SHARE", [ids]
    );
    const byId = new Map(menuRows.map(item => [Number(item.id), item]));
    if (ids.some(id => !byId.has(id) || !byId.get(id).is_available)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "One or more items are unavailable. Refresh the menu and try again." });
    }

    let total = 0;
    const orderItems = items.map(item => {
      const menu = byId.get(item.menuItemId);
      const lineTotal = Number(menu.price_paise) * item.quantity;
      total += lineTotal;
      return { ...item, name: menu.name, unitPrice: Number(menu.price_paise), lineTotal };
    });

    const orderResult = await client.query(
      "INSERT INTO orders (table_number, customer_name, notes, total_paise, status) VALUES ($1, $2, $3, $4, 'new') RETURNING id, table_number, customer_name, notes, total_paise, status, created_at",
      [tableNumber, customerName, notes, total]
    );
    const order = orderResult.rows[0];
    for (const item of orderItems) {
      await client.query(
        "INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price_paise, note) VALUES ($1, $2, $3, $4, $5, $6)",
        [order.id, item.menuItemId, item.name, item.quantity, item.unitPrice, item.note]
      );
    }
    await client.query("COMMIT");
    io.to("kitchen").emit("order:new", { ...order, items: orderItems });
    res.status(201).json({ ...order, items: orderItems });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client.release(); }
});

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }), async (req, res, next) => {
  const schema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter username and password." });
  try {
    if (!JWT_SECRET || JWT_SECRET.length < 32) return res.status(503).json({ error: "Set a JWT_SECRET of at least 32 characters in .env." });
    const { rows } = await pool.query("SELECT id, username, password_hash, role FROM staff_users WHERE username = $1 AND is_active = TRUE", [parsed.data.username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "8h", issuer: "backyard-social" });
    await pool.query("INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES ($1, 'login', 'staff_user', $2)", [user.id, String(user.id)]);
    res.json({ token, user: { username: user.username, role: user.role }, expiresIn: "8h" });
  } catch (err) { next(err); }
});

app.get("/api/staff/orders", authRequired, roleRequired("admin", "kitchen"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.table_number, o.customer_name, o.notes, o.total_paise, o.status, o.created_at,
        COALESCE(json_agg(json_build_object('name', oi.item_name, 'quantity', oi.quantity, 'note', oi.note, 'unitPrice', oi.unit_price_paise))
        FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status <> 'completed' AND o.status <> 'cancelled'
      GROUP BY o.id ORDER BY o.created_at ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

app.patch("/api/staff/orders/:id/status", authRequired, roleRequired("admin", "kitchen"), async (req, res, next) => {
  const id = Number(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: "Invalid order ID or status." });
  try {
    const { rows } = await pool.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, table_number", [parsed.data.status, id]);
    if (!rows[0]) return res.status(404).json({ error: "Order not found." });
    await pool.query("INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'order', $3, $4)", [req.user.sub, "order_status_changed", String(id), JSON.stringify({ status: parsed.data.status })]);
    io.emit("order:updated", rows[0]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.get("/api/staff/menu", authRequired, roleRequired("admin"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, name, description, category, price_paise, is_available FROM menu_items ORDER BY category, name");
    res.json(rows);
  } catch (err) { next(err); }
});

app.post("/api/staff/menu", authRequired, roleRequired("admin"), async (req, res, next) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(300).default(""),
    category: z.string().trim().min(1).max(60),
    priceRupees: z.number().finite().min(1).max(100000),
    isAvailable: z.boolean().default(true)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid menu item.", details: parsed.error.flatten() });
  try {
    const d = parsed.data;
    const { rows } = await pool.query(
      "INSERT INTO menu_items (name, description, category, price_paise, is_available) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, category, price_paise, is_available",
      [d.name, d.description, d.category, Math.round(d.priceRupees * 100), d.isAvailable]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

app.patch("/api/staff/menu/:id/availability", authRequired, roleRequired("admin"), async (req, res, next) => {
  const id = Number(req.params.id);
  const parsed = z.object({ isAvailable: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: "Invalid menu item update." });
  try {
    const { rows } = await pool.query("UPDATE menu_items SET is_available = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_available", [parsed.data.isAvailable, id]);
    if (!rows[0]) return res.status(404).json({ error: "Menu item not found." });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

io.on("connection", socket => {
  // Kitchen clients join this room only after authenticating with the token.
  socket.on("join:kitchen", token => {
    try {
      if (!JWT_SECRET) return;
      const user = jwt.verify(token, JWT_SECRET);
      if (["admin", "kitchen"].includes(user.role)) socket.join("kitchen");
    } catch { /* Invalid token: do not join protected room. */ }
  });
});

app.use((err, _req, res, _next) => {
  console.error("Request failed:", err.message);
  res.status(500).json({ error: "Something went wrong. Check server logs." });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`The Backyard Social is running at http://localhost:${PORT}`));
}

module.exports = { app, server, pool, orderSchema };
