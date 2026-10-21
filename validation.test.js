const test = require("node:test");
const assert = require("node:assert/strict");
const { orderSchema } = require("../server");

test("accepts a valid order payload", () => {
  const result = orderSchema.safeParse({
    tableNumber: "4",
    customerName: "Sam",
    notes: "",
    items: [{ menuItemId: 1, quantity: 2 }]
  });
  assert.equal(result.success, true);
});

test("rejects an order with no items", () => {
  const result = orderSchema.safeParse({ tableNumber: "4", items: [] });
  assert.equal(result.success, false);
});

test("rejects a quantity above the limit", () => {
  const result = orderSchema.safeParse({ tableNumber: "4", items: [{ menuItemId: 1, quantity: 99 }] });
  assert.equal(result.success, false);
});

test("rejects an oversized table identifier", () => {
  const result = orderSchema.safeParse({ tableNumber: "table-number-is-way-too-long", items: [{ menuItemId: 1, quantity: 1 }] });
  assert.equal(result.success, false);
});
