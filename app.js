const money = paise => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(paise || 0) / 100);
const params = new URLSearchParams(location.search);
const tableNumber = (params.get("table") || "1").trim().slice(0, 12);
document.getElementById("tableLabel").textContent = `TABLE ${tableNumber.toUpperCase()}`;
let menu = [], cart = new Map(), activeCategory = "All", token = "", staffRole = "";
const socket = io();

const menuGrid = document.getElementById("menuGrid");
const filters = document.getElementById("categoryFilters");
const cartOverlay = document.getElementById("cartOverlay");

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function categoryIcon(category) {
  return ({ Coffee: "☕", Shakes: "🥤", Mastani: "🍫", "Ice Cream": "🍨", Snacks: "🍟" })[category] || "✦";
}
async function loadMenu() {
  try {
    menu = await api("/api/menu");
    const categories = ["All", ...new Set(menu.map(item => item.category))];
    filters.innerHTML = categories.map(category => `<button class="filter ${category === activeCategory ? "active" : ""}" data-category="${safeText(category)}">${safeText(category)}</button>`).join("");
    filters.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
      activeCategory = button.dataset.category; loadMenuCards();
      filters.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
    }));
    loadMenuCards();
  } catch (error) {
    menuGrid.innerHTML = `<div class="empty">Couldn't load the menu. Make sure the server and PostgreSQL database are running. ${safeText(error.message)}</div>`;
  }
}
function loadMenuCards() {
  const visible = activeCategory === "All" ? menu : menu.filter(item => item.category === activeCategory);
  menuGrid.innerHTML = visible.length ? visible.map(item => `<article class="menu-card">
    <div class="menu-icon" aria-hidden="true">${categoryIcon(item.category)}</div>
    <h3>${safeText(item.name)}</h3><p>${safeText(item.description || item.category)}</p>
    <div class="menu-bottom"><span>${money(item.price_paise)}</span><button class="add-button" aria-label="Add ${safeText(item.name)}" data-add="${item.id}">+</button></div>
  </article>`).join("") : `<div class="empty">No items in this category yet.</div>`;
  menuGrid.querySelectorAll("[data-add]").forEach(button => button.addEventListener("click", () => {
    const id = Number(button.dataset.add), existing = cart.get(id);
    cart.set(id, { item: menu.find(item => item.id === id), quantity: Math.min(20, (existing?.quantity || 0) + 1), note: "" });
    updateCartCount();
    button.textContent = "✓"; setTimeout(() => { if (button.isConnected) button.textContent = "+"; }, 500);
  }));
}
function updateCartCount() {
  document.getElementById("cartCount").textContent = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
}
function renderCart() {
  const target = document.getElementById("cartItems");
  const lines = [...cart.values()];
  target.innerHTML = lines.length ? lines.map(({ item, quantity }) => `<div class="cart-line">
    <div><strong>${safeText(item.name)}</strong><small>${money(item.price_paise)} each</small></div>
    <div class="qty-controls"><button data-qty="${item.id}" data-delta="-1" aria-label="Remove one">−</button><span>${quantity}</span><button data-qty="${item.id}" data-delta="1" aria-label="Add one">+</button></div>
  </div>`).join("") : `<p class="empty">Your cart is empty. A tragic but fixable situation.</p>`;
  target.querySelectorAll("[data-qty]").forEach(button => button.addEventListener("click", () => {
    const id = Number(button.dataset.qty), delta = Number(button.dataset.delta), line = cart.get(id);
    if (!line) return;
    line.quantity += delta;
    if (line.quantity <= 0) cart.delete(id);
    else line.quantity = Math.min(20, line.quantity);
    renderCart(); updateCartCount();
  }));
  const total = lines.reduce((sum, line) => sum + Number(line.item.price_paise) * line.quantity, 0);
  document.getElementById("cartTotal").textContent = money(total);
}
document.getElementById("cartOpen").addEventListener("click", () => { renderCart(); cartOverlay.hidden = false; });
document.getElementById("cartClose").addEventListener("click", () => cartOverlay.hidden = true);
cartOverlay.addEventListener("click", event => { if (event.target === cartOverlay) cartOverlay.hidden = true; });
document.getElementById("placeOrder").addEventListener("click", async event => {
  const button = event.currentTarget, message = document.getElementById("orderMessage");
  const items = [...cart.values()].map(({ item, quantity }) => ({ menuItemId: Number(item.id), quantity }));
  if (!items.length) { message.textContent = "Add something to your order first."; return; }
  button.disabled = true; message.textContent = "Sending your order…";
  try {
    const order = await api("/api/orders", { method: "POST", body: JSON.stringify({
      tableNumber, customerName: document.getElementById("customerName").value,
      notes: document.getElementById("orderNotes").value, items
    }) });
    cart.clear(); updateCartCount(); renderCart();
    message.textContent = `Order #${order.id} received. Please pay at the counter.`;
    button.textContent = "Order placed";
    setTimeout(() => { cartOverlay.hidden = true; button.textContent = "Place order"; message.textContent = ""; }, 2600);
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const message = document.getElementById("loginMessage");
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
    token = result.token; staffRole = result.user.role;
    socket.emit("join:kitchen", token);
    document.getElementById("staffPanel").hidden = false;
    document.getElementById("adminMenuPanel").hidden = staffRole !== "admin";
    message.textContent = `Signed in as ${staffRole}.`;
    await loadStaffOrders();
    if (staffRole === "admin") await loadAdminMenu();
  } catch (error) { message.textContent = error.message; }
});
async function loadStaffOrders() {
  const target = document.getElementById("staffOrders");
  try {
    const orders = await api("/api/staff/orders");
    target.innerHTML = orders.length ? orders.map(order => `<article class="staff-order">
      <div class="staff-order-head"><span>Order #${order.id} · Table ${safeText(order.table_number)}</span><span>${safeText(order.status)}</span></div>
      <ul>${order.items.map(item => `<li>${Number(item.quantity)} × ${safeText(item.name)}${item.note ? ` · ${safeText(item.note)}` : ""}</li>`).join("")}</ul>
      ${order.notes ? `<p class="muted">Note: ${safeText(order.notes)}</p>` : ""}
      <div class="staff-order-head"><span>${money(order.total_paise)}</span><span class="muted">${new Date(order.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</span></div>
      <div class="status-actions">${(order.status === "new" ? ["accepted", "cancelled"] : order.status === "accepted" ? ["preparing", "cancelled"] : order.status === "preparing" ? ["ready", "cancelled"] : ["completed"]).map(status => `<button data-status="${status}" data-order="${order.id}">${status[0].toUpperCase() + status.slice(1)}</button>`).join("")}</div>
    </article>`).join("") : `<div class="empty">No active orders.</div>`;
    target.querySelectorAll("[data-status]").forEach(button => button.addEventListener("click", async () => {
      try {
        await api(`/api/staff/orders/${button.dataset.order}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
        await loadStaffOrders();
      } catch (error) { alert(error.message); }
    }));
  } catch (error) { target.innerHTML = `<div class="empty">${safeText(error.message)}</div>`; }
}
document.getElementById("refreshOrders").addEventListener("click", loadStaffOrders);
socket.on("order:new", () => { if (token) loadStaffOrders(); });
socket.on("order:updated", () => { if (token) loadStaffOrders(); });

async function loadAdminMenu() {
  const target = document.getElementById("adminMenu");
  try {
    const items = await api("/api/staff/menu");
    target.innerHTML = items.map(item => `<div class="admin-item"><span>${safeText(item.name)} <small>${money(item.price_paise)}</small></span><button class="quiet-button" data-availability="${item.id}" data-value="${!item.is_available}">${item.is_available ? "Mark unavailable" : "Make available"}</button></div>`).join("");
    target.querySelectorAll("[data-availability]").forEach(button => button.addEventListener("click", async () => {
      try { await api(`/api/staff/menu/${button.dataset.availability}/availability`, { method: "PATCH", body: JSON.stringify({ isAvailable: button.dataset.value === "true" }) }); await loadAdminMenu(); await loadMenu(); }
      catch (error) { alert(error.message); }
    }));
  } catch (error) { target.textContent = error.message; }
}
document.getElementById("menuForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/staff/menu", { method: "POST", body: JSON.stringify({
      name: form.get("name"), category: form.get("category"), priceRupees: Number(form.get("priceRupees")), description: form.get("description"), isAvailable: true
    }) });
    event.currentTarget.reset(); await loadAdminMenu(); await loadMenu();
  } catch (error) { alert(error.message); }
});

loadMenu();
