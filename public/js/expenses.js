const EXPENSES_KEY = "shop-expenses-log-v1";
const INVOICES_KEY = "purchase-invoices-v1";
const PRODUCTS_KEY = "inventory-manager-products-v1";

function load(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Could not load", key, e);
    return [];
  }
}
function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Could not save", key, e);
    return false;
  }
}
const loadExpenses = () => load(EXPENSES_KEY);
const saveExpenses = (d) => save(EXPENSES_KEY, d);
const loadInvoices = () => load(INVOICES_KEY);
const saveInvoices = (d) => save(INVOICES_KEY, d);
const loadProducts = () => load(PRODUCTS_KEY);
const saveProducts = (d) => save(PRODUCTS_KEY, d);

const norm = (s) => String(s).trim().toLowerCase();
const typeOf = (e) => (e.sourceInvoiceId ? "purchase" : e.type || "purchase");
const TYPE_LABEL = { operating: "Operating", purchase: "Purchasing" };
const fmt = (n) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

// Iran dates (Solar Hijri, Tehran time)
const TZ = "Asia/Tehran";
const faDate = (iso) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
const faDateShort = (iso) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const notice = document.getElementById("notice");
function showNotice(message, type = "success") {
  notice.textContent = message;
  notice.className = `notice show ${type}`;
  clearTimeout(showNotice.t);
  showNotice.t = setTimeout(() => (notice.className = "notice"), 2500);
}

/* =========================================================
         MANUAL EXPENSES (unchanged behaviour, plus invoice tagging)
         ========================================================= */
const form = document.getElementById("expenseForm");
const itemInput = document.getElementById("expItem");
const costInput = document.getElementById("expCost");
const shipInput = document.getElementById("expShipping");
const notesInput = document.getElementById("expNotes");
const totalPreview = document.getElementById("expTotalPreview");
const body = document.getElementById("expBody");
const emptyState = document.getElementById("emptyState");

function dayStart(date) {
  const g = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const p = {};
  for (const part of g.formatToParts(date))
    if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day);
}
function weekStart(date) {
  const day = dayStart(date);
  const sinceSaturday = (new Date(day).getUTCDay() + 1) % 7;
  return day - sinceSaturday * 86400000;
}
const jalaliFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
function monthKey(date) {
  const out = {};
  for (const p of jalaliFmt.formatToParts(date))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return out.year * 100 + out.month;
}

function updateTotalPreview() {
  const cost = Number(costInput.value) || 0;
  const ship = Number(shipInput.value) || 0;
  totalPreview.textContent = `${fmt(cost + ship)} Toman`;
}
costInput.addEventListener("input", updateTotalPreview);
shipInput.addEventListener("input", updateTotalPreview);

function shrinkImage(file, maxSide = 720, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image."));
    };
    img.src = url;
  });
}

let pendingImage = null;
let imageBusy = false;
const expPhoto = document.getElementById("expPhoto");
const photoPreview = document.getElementById("photoPreview");
const photoImg = document.getElementById("photoImg");

async function setImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  imageBusy = true;
  try {
    pendingImage = await shrinkImage(file);
    photoImg.src = pendingImage;
    photoPreview.classList.add("show");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    imageBusy = false;
  }
}
function clearImage() {
  pendingImage = null;
  expPhoto.value = "";
  photoImg.removeAttribute("src");
  photoPreview.classList.remove("show");
}
expPhoto.addEventListener("change", () => setImage(expPhoto.files[0]));
document.getElementById("photoRemove").addEventListener("click", clearImage);
notesInput.addEventListener("paste", (event) => {
  const file = [...event.clipboardData.files].find((f) =>
    f.type.startsWith("image/"),
  );
  if (file) {
    event.preventDefault();
    setImage(file);
  }
});

let editPendingImage = undefined;
let editImageBusy = false;
const editPhoto = document.getElementById("editPhoto");
const editPhotoPreview = document.getElementById("editPhotoPreview");
const editPhotoImg = document.getElementById("editPhotoImg");

async function setEditImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  editImageBusy = true;
  try {
    editPendingImage = await shrinkImage(file);
    editPhotoImg.src = editPendingImage;
    editPhotoPreview.classList.add("show");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    editImageBusy = false;
  }
}
function clearEditImage() {
  editPendingImage = null;
  editPhoto.value = "";
  editPhotoImg.removeAttribute("src");
  editPhotoPreview.classList.remove("show");
}
editPhoto.addEventListener("change", () => setEditImage(editPhoto.files[0]));
document
  .getElementById("editPhotoRemove")
  .addEventListener("click", clearEditImage);

const lightbox = document.createElement("div");
lightbox.className = "lightbox";
lightbox.innerHTML = '<img alt="Photo" />';
document.body.appendChild(lightbox);
lightbox.addEventListener("click", () => lightbox.classList.remove("show"));
function openLightbox(src) {
  lightbox.firstChild.src = src;
  lightbox.classList.add("show");
}
body.addEventListener("click", (event) => {
  const thumb = event.target.closest(".thumb");
  if (!thumb) return;
  event.stopPropagation();
  openLightbox(thumb.src);
});

function setStat(name, list) {
  const total = list.reduce(
    (sum, e) => sum + Number(e.cost) + Number(e.shipping),
    0,
  );
  document.getElementById("spent" + name).textContent = fmt(total);
  document.getElementById("count" + name).textContent =
    `${list.length} ${list.length === 1 ? "entry" : "entries"}`;
}
function renderStats(expenses) {
  const now = new Date();
  const today = dayStart(now);
  const thisWeek = weekStart(now);
  const thisMonth = monthKey(now);
  setStat(
    "Today",
    expenses.filter((e) => dayStart(new Date(e.date)) === today),
  );
  setStat(
    "Week",
    expenses.filter((e) => weekStart(new Date(e.date)) === thisWeek),
  );
  setStat(
    "Month",
    expenses.filter((e) => monthKey(new Date(e.date)) === thisMonth),
  );
  setStat("Total", expenses);
}

function render() {
  const expenses = loadExpenses();
  body.innerHTML = expenses
    .map((e) => {
      const fromInvoice = Boolean(e.sourceInvoiceId);
      const actionsHtml = fromInvoice
        ? `<button class="button button-secondary button-small" type="button" data-manage-invoice="${e.sourceInvoiceId}">Manage Invoice</button>`
        : `<button class="button button-secondary button-small" type="button" data-open="${e.id}">Details</button>
                 <button class="button button-danger button-small" type="button" data-id="${e.id}">Delete</button>`;
      return `
          <tr>
            <td>${faDate(e.date)}</td>
            <td>
              <div class="item-cell" ${fromInvoice ? "" : `data-open="${e.id}"`}>
                ${e.image ? `<img class="thumb" src="${e.image}" alt="Receipt photo" />` : ""}
                <div>
                  <div class="item-name">${escapeHtml(e.item)}${
                    e.history && e.history.length
                      ? '<span class="tag tag-edited">Edited</span>'
                      : ""
                  }${fromInvoice ? '<span class="tag tag-invoice">From Invoice</span>' : ""} <span class="tag tag-${typeOf(e)}">${TYPE_LABEL[typeOf(e)]}</span></div>
                  ${e.notes ? `<div class="item-notes">${escapeHtml(e.notes)}</div>` : ""}
                </div>
              </div>
            </td>
            <td class="num">${fmt(e.cost)}</td>
            <td class="num">${fmt(e.shipping)}</td>
            <td class="num">${fmt(Number(e.cost) + Number(e.shipping))} Toman</td>
            <td><div class="actions">${actionsHtml}</div></td>
          </tr>`;
    })
    .join("");
  emptyState.style.display = expenses.length ? "none" : "block";
  renderStats(expenses);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const item = itemInput.value.trim();
  const cost = Number(costInput.value);
  const shipping = Number(shipInput.value) || 0;
  const notesVal = notesInput.value.trim();

  if (!item) return showNotice("Enter what was bought.", "error");
  if (!Number.isFinite(cost) || cost < 0)
    return showNotice("Enter a valid cost.", "error");
  if (!Number.isFinite(shipping) || shipping < 0)
    return showNotice("Enter a valid shipping cost.", "error");
  if (imageBusy)
    return showNotice(
      "The photo is still processing. Try again in a second.",
      "error",
    );

  const expenses = loadExpenses();
  expenses.unshift({
    id: newId(),
    item,
    cost,
    shipping,
    notes: notesVal,
    image: pendingImage,
    date: new Date().toISOString(),
    history: [],
    sourceInvoiceId: null,
    type: document.getElementById("expType").value,
  });

  if (!saveExpenses(expenses))
    return showNotice(
      "Browser storage is full. Try without a photo, or delete old entries.",
      "error",
    );

  form.reset();
  clearImage();
  updateTotalPreview();
  render();
  showNotice("Expense added.");
  itemInput.focus();
});

body.addEventListener("click", (event) => {
  const manageBtn = event.target.closest("[data-manage-invoice]");
  if (manageBtn) {
    openInvoiceModal(manageBtn.dataset.manageInvoice);
    return;
  }
  const delBtn = event.target.closest("[data-id]");
  if (delBtn) {
    const expenses = loadExpenses();
    const exp = expenses.find((e) => e.id === delBtn.dataset.id);
    if (!exp) return;
    if (exp.sourceInvoiceId) {
      showNotice(
        "This expense comes from a purchase invoice — manage it from there.",
        "error",
      );
      return;
    }
    if (!confirm(`Delete this expense for "${exp.item}"?`)) return;
    saveExpenses(expenses.filter((e) => e.id !== exp.id));
    render();
  }
});

// ---- Details + Edit modals (manual expenses only) ----
let activeId = null;
const detailBackdrop = document.getElementById("detailBackdrop");
const detailBody = document.getElementById("detailBody");
const editBackdrop = document.getElementById("editBackdrop");
const editForm = document.getElementById("editForm");

function fieldLabel(field) {
  return (
    {
      type: "Type",
      item: "Item",
      cost: "Cost",
      shipping: "Shipping",
      notes: "Notes",
      image: "Photo",
    }[field] || field
  );
}
function fieldDisplay(field, value) {
  if (field === "cost" || field === "shipping") return `${fmt(value)} Toman`;
  if (field === "image") return value ? "(new photo)" : "(removed)";
  if (!value) return "(empty)";
  if (field === "type") return TYPE_LABEL[value] || value;
  return escapeHtml(value);
}

function renderDetail(exp) {
  const history = exp.history || [];
  let html = `
          <div class="detail-row"><span class="k">Item</span><span class="v">${escapeHtml(exp.item)}</span></div>
          <div class="detail-row"><span class="k">Type</span><span class="v">${TYPE_LABEL[typeOf(exp)]}</span></div>
          <div class="detail-row"><span class="k">Cost</span><span class="v">${fmt(exp.cost)} Toman</span></div>
          <div class="detail-row"><span class="k">Shipping</span><span class="v">${fmt(exp.shipping)} Toman</span></div>
          <div class="detail-row"><span class="k">Total</span><span class="v">${fmt(Number(exp.cost) + Number(exp.shipping))} Toman</span></div>
          <div class="detail-row"><span class="k">Notes</span><span class="v">${exp.notes ? escapeHtml(exp.notes) : "(none)"}</span></div>
          <div class="detail-row"><span class="k">Published</span><span class="v">${faDate(exp.date)}</span></div>
        `;
  if (exp.image)
    html += `<div class="detail-photo"><img src="${exp.image}" alt="Receipt photo" /></div>`;
  if (history.length) {
    html += `<div class="history-log"><h3>Edit history (${history.length})</h3>`;
    for (const entry of [...history].reverse()) {
      html += `<div class="history-entry"><div class="when">Edited ${faDate(entry.at)}</div>`;
      for (const field of Object.keys(entry.changes)) {
        const c = entry.changes[field];
        if (field === "image") {
          html += `<div class="history-change"><span class="field">Photo:</span> ${c.after ? "replaced" : "removed"}</div>`;
        } else {
          html += `<div class="history-change"><span class="field">${fieldLabel(field)}:</span> <span class="before">${fieldDisplay(field, c.before)}</span> → <span class="after">${fieldDisplay(field, c.after)}</span></div>`;
        }
      }
      html += `</div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="history-log"><h3>Edit history</h3><p class="hint">No edits yet — still as originally published.</p></div>`;
  }
  detailBody.innerHTML = html;
  const photoEl = detailBody.querySelector(".detail-photo img");
  if (photoEl)
    photoEl.addEventListener("click", () => openLightbox(photoEl.src));
}

function openDetail(id) {
  const exp = loadExpenses().find((e) => e.id === id);
  if (!exp) return;
  if (exp.sourceInvoiceId) return openInvoiceModal(exp.sourceInvoiceId);
  activeId = id;
  renderDetail(exp);
  detailBackdrop.classList.add("show");
}
function closeDetail() {
  detailBackdrop.classList.remove("show");
}

function openEdit(id) {
  const exp = loadExpenses().find((e) => e.id === id);
  if (!exp || exp.sourceInvoiceId) return;
  activeId = id;
  document.getElementById("editItem").value = exp.item;
  document.getElementById("editCost").value = exp.cost;
  document.getElementById("editShipping").value = exp.shipping;
  document.getElementById("editNotes").value = exp.notes || "";
  document.getElementById("editType").value = typeOf(exp);
  editPendingImage = undefined;
  editPhoto.value = "";
  if (exp.image) {
    editPhotoImg.src = exp.image;
    editPhotoPreview.classList.add("show");
  } else {
    editPhotoImg.removeAttribute("src");
    editPhotoPreview.classList.remove("show");
  }
  closeDetail();
  editBackdrop.classList.add("show");
}
function closeEdit() {
  editBackdrop.classList.remove("show");
}

body.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open]");
  if (!opener) return;
  openDetail(opener.dataset.open);
});

document.getElementById("detailClose").addEventListener("click", closeDetail);
document.getElementById("detailOk").addEventListener("click", closeDetail);
detailBackdrop.addEventListener("click", (event) => {
  if (event.target === detailBackdrop) closeDetail();
});
document
  .getElementById("detailEditBtn")
  .addEventListener("click", () => openEdit(activeId));

document.getElementById("editClose").addEventListener("click", closeEdit);
document.getElementById("editCancel").addEventListener("click", closeEdit);
editBackdrop.addEventListener("click", (event) => {
  if (event.target === editBackdrop) closeEdit();
});

editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (editImageBusy)
    return showNotice(
      "The photo is still processing. Try again in a second.",
      "error",
    );

  const expenses = loadExpenses();
  const exp = expenses.find((e) => e.id === activeId);
  if (!exp) return closeEdit();

  const newItem = document.getElementById("editItem").value.trim();
  const newCost = Number(document.getElementById("editCost").value);
  const newShipping = Number(document.getElementById("editShipping").value);
  const newNotes = document.getElementById("editNotes").value.trim();
  const newType = document.getElementById("editType").value;

  if (!newItem) return showNotice("Enter what was bought.", "error");
  if (!Number.isFinite(newCost) || newCost < 0)
    return showNotice("Enter a valid cost.", "error");
  if (!Number.isFinite(newShipping) || newShipping < 0)
    return showNotice("Enter a valid shipping cost.", "error");

  const changes = {};
  if (newItem !== exp.item) changes.item = { before: exp.item, after: newItem };
  if (newCost !== Number(exp.cost))
    changes.cost = { before: exp.cost, after: newCost };
  if (newShipping !== Number(exp.shipping))
    changes.shipping = { before: exp.shipping, after: newShipping };
  if (newNotes !== (exp.notes || ""))
    changes.notes = { before: exp.notes || "", after: newNotes };
  if (
    editPendingImage !== undefined &&
    editPendingImage !== (exp.image || null)
  ) {
    changes.image = {
      before: exp.image || null,
      after: editPendingImage,
    };
  }
  if (newType !== typeOf(exp))
    changes.type = { before: typeOf(exp), after: newType };
  if (Object.keys(changes).length === 0) {
    closeEdit();
    return;
  }

  exp.item = newItem;
  exp.cost = newCost;
  exp.shipping = newShipping;
  exp.notes = newNotes;
  exp.type = newType;

  if (editPendingImage !== undefined) exp.image = editPendingImage;
  exp.history = exp.history || [];
  exp.history.push({ at: new Date().toISOString(), changes });

  if (!saveExpenses(expenses))
    return showNotice("Browser storage is full.", "error");
  closeEdit();
  render();
  showNotice("Expense updated.");
});

window.addEventListener("storage", () => {
  render();
  renderInvoicesList();
});

/* =========================================================
         PURCHASE INVOICES
         ========================================================= */
const invoicesBody = document.getElementById("invoicesBody");
const invoicesEmptyState = document.getElementById("invoicesEmptyState");
const invoiceBackdrop = document.getElementById("invoiceBackdrop");
const invoiceModalTitle = document.getElementById("invoiceModalTitle");
const invoiceStatusRow = document.getElementById("invoiceStatusRow");
const invoiceStatusBadge = document.getElementById("invoiceStatusBadge");
const invSupplier = document.getElementById("invSupplier");
const invNumber = document.getElementById("invNumber");
const invDate = document.getElementById("invDate");
const invShipping = document.getElementById("invShipping");
const invNotes = document.getElementById("invNotes");
const invoiceItemsTable = document.getElementById("invoiceItemsTable");
const invoiceItemsBody = document.getElementById("invoiceItemsBody");
const productsDatalist = document.getElementById("productsDatalist");
const invGoodsPreview = document.getElementById("invGoodsPreview");
const invShippingPreview = document.getElementById("invShippingPreview");
const invTotalPreview = document.getElementById("invTotalPreview");
const invoiceNotice = document.getElementById("invoiceNotice");
const receiveAllBtn = document.getElementById("receiveAllBtn");

let invoiceMode = "create"; // 'create' | 'manage'
let activeInvoiceId = null;
let invoiceItems = []; // working array of row objects while modal is open

function showInvoiceNotice(message, type = "error") {
  invoiceNotice.textContent = message;
  invoiceNotice.className = `notice show ${type}`;
  clearTimeout(showInvoiceNotice.t);
  showInvoiceNotice.t = setTimeout(
    () => (invoiceNotice.className = "notice"),
    3000,
  );
}

const STATUS_LABEL = {
  awaiting_delivery: "Awaiting Delivery",
  partially_received: "Partially Received",
  inventory_added: "Received — Inventory Updated",
};
function computeInvoiceStatus(items) {
  const totalOrdered = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const totalAdded = items.reduce(
    (s, it) => s + Number(it.addedQuantity || 0),
    0,
  );
  if (totalAdded <= 0) return "awaiting_delivery";
  if (totalAdded < totalOrdered) return "partially_received";
  return "inventory_added";
}
function statusBadgeHtml(status) {
  return `<span class="status-badge status-${status}">${STATUS_LABEL[status] || status}</span>`;
}
function updateInvoiceStatusBadge() {
  const status = computeInvoiceStatus(invoiceItems);
  invoiceStatusBadge.className = `status-badge status-${status}`;
  invoiceStatusBadge.textContent = STATUS_LABEL[status] || status;
}

function refreshProductsDatalist() {
  const products = loadProducts();
  productsDatalist.innerHTML = products
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

function findProductByName(name) {
  return loadProducts().find((p) => norm(p.name) === norm(name));
}

function blankInvoiceItem() {
  return {
    rowId: newId(),
    productId: null,
    name: "",
    quantity: 1,
    receivedQuantity: 0,
    addedQuantity: 0,
    purchasePrice: 0,
    customerPrice: 0,
    partnerPrice: 0,
  };
}

function recomputeInvoiceTotals() {
  const goods = invoiceItems.reduce(
    (s, it) => s + Number(it.quantity || 0) * Number(it.purchasePrice || 0),
    0,
  );
  const shipping = Number(invShipping.value) || 0;
  invGoodsPreview.textContent = `${fmt(goods)} Toman`;
  invShippingPreview.textContent = `${fmt(shipping)} Toman`;
  invTotalPreview.textContent = `${fmt(goods + shipping)} Toman`;
  return { goods, shipping, total: goods + shipping };
}
invShipping.addEventListener("input", recomputeInvoiceTotals);

function renderInvoiceItemsTable() {
  invoiceItemsTable.classList.toggle("manage-mode", invoiceMode === "manage");
  invoiceItemsBody.innerHTML = invoiceItems
    .map((it) => {
      const isNewProduct = !it.productId;
      const canAdd =
        Number(it.receivedQuantity || 0) > Number(it.addedQuantity || 0);
      const canRemove = Number(it.addedQuantity || 0) === 0;
      return `
            <tr data-row-id="${it.rowId}">
              <td>
                <input type="text" list="productsDatalist" data-field="name" value="${escapeHtml(it.name)}" placeholder="Search or type new product" />
                ${isNewProduct && it.name ? '<div class="new-product-tag">New product</div>' : ""}
              </td>
              <td class="qty-col"><input type="number" min="1" step="1" data-field="quantity" value="${it.quantity}" /></td>
              <td class="price-col"><input type="number" min="0" step="any" data-field="purchasePrice" value="${it.purchasePrice}" /></td>
              <td class="price-col"><input type="number" min="0" step="any" data-field="customerPrice" value="${it.customerPrice}" /></td>
              <td class="price-col"><input type="number" min="0" step="any" data-field="partnerPrice" value="${it.partnerPrice}" /></td>
              <td class="receive-col qty-col"><input type="number" min="0" step="1" data-field="receivedQuantity" value="${it.receivedQuantity}" /></td>
              <td class="receive-col"><span class="added-count">${it.addedQuantity} / ${it.quantity}</span></td>
              <td class="receive-col">
                <button type="button" class="button button-secondary button-small" data-receive-row="${it.rowId}" ${canAdd ? "" : "disabled"}>Add to inventory</button>
              </td>
              <td>
                <button type="button" class="button button-danger button-small" data-remove-row="${it.rowId}" ${canRemove ? "" : "disabled"} title="${canRemove ? "Remove item" : "Already partly received — cannot remove"}">Remove</button>
              </td>
            </tr>`;
    })
    .join("");
  recomputeInvoiceTotals();
  updateInvoiceStatusBadge();
  receiveAllBtn.style.display =
    invoiceMode === "manage" &&
    invoiceItems.some(
      (it) => Number(it.receivedQuantity || 0) < Number(it.quantity || 0),
    )
      ? "inline-block"
      : "none";
}

document.getElementById("addInvoiceItemBtn").addEventListener("click", () => {
  invoiceItems.push(blankInvoiceItem());
  renderInvoiceItemsTable();
});

invoiceItemsBody.addEventListener("input", (event) => {
  const row = event.target.closest("tr[data-row-id]");
  if (!row) return;
  const rowId = row.dataset.rowId;
  const it = invoiceItems.find((x) => x.rowId === rowId);
  if (!it) return;
  const field = event.target.dataset.field;
  if (!field) return;

  if (field === "name") {
    it.name = event.target.value;
    const match = findProductByName(it.name);
    if (match) {
      it.productId = match.id;
      // Prefill prices only if this row hasn't had anything entered yet,
      // so we never silently overwrite a value the user already typed.
      const rowEl = row;
      if (
        Number(it.purchasePrice) === 0 &&
        Number(it.customerPrice) === 0 &&
        Number(it.partnerPrice) === 0
      ) {
        it.purchasePrice = Number.isFinite(Number(match.purchasePrice))
          ? Number(match.purchasePrice)
          : 0;
        it.customerPrice = Number.isFinite(Number(match.customerPrice))
          ? Number(match.customerPrice)
          : Number(match.price) || 0;
        it.partnerPrice = Number.isFinite(Number(match.partnerPrice))
          ? Number(match.partnerPrice)
          : 0;
        rowEl.querySelector('[data-field="purchasePrice"]').value =
          it.purchasePrice;
        rowEl.querySelector('[data-field="customerPrice"]').value =
          it.customerPrice;
        rowEl.querySelector('[data-field="partnerPrice"]').value =
          it.partnerPrice;
      }
      const tag = rowEl.querySelector(".new-product-tag");
      if (tag) tag.remove();
    } else {
      it.productId = null;
      let tag = row.querySelector(".new-product-tag");
      if (it.name && !tag) {
        tag = document.createElement("div");
        tag.className = "new-product-tag";
        tag.textContent = "New product";
        row.querySelector("td").appendChild(tag);
      } else if (!it.name && tag) {
        tag.remove();
      }
    }
    return;
  }

  const numeric = Number(event.target.value);
  it[field] = Number.isFinite(numeric) ? numeric : 0;
  recomputeInvoiceTotals();
});

invoiceItemsBody.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-remove-row]");
  if (removeBtn && !removeBtn.disabled) {
    invoiceItems = invoiceItems.filter(
      (it) => it.rowId !== removeBtn.dataset.removeRow,
    );
    renderInvoiceItemsTable();
    return;
  }
  const receiveBtn = event.target.closest("[data-receive-row]");
  if (receiveBtn && !receiveBtn.disabled) {
    receiveInvoiceItem(receiveBtn.dataset.receiveRow);
  }
});

function persistInvoiceItemsToStore() {
  const invoices = loadInvoices();
  const invoice = invoices.find((inv) => inv.id === activeInvoiceId);
  if (!invoice) return null;
  invoice.items = invoiceItems.map((it) => ({ ...it }));
  invoice.status = computeInvoiceStatus(invoice.items);
  invoice.updatedAt = new Date().toISOString();
  saveInvoices(invoices);
  return invoice;
}

function receiveInvoiceItem(rowId) {
  if (!activeInvoiceId) return;
  const it = invoiceItems.find((x) => x.rowId === rowId);
  if (!it) return;

  const delta =
    Number(it.receivedQuantity || 0) - Number(it.addedQuantity || 0);
  if (!Number.isFinite(delta) || delta <= 0) {
    showInvoiceNotice("Nothing new to add for this item.");
    return;
  }
  if (!it.name.trim()) {
    showInvoiceNotice("Enter a product name for this item first.");
    return;
  }

  const products = loadProducts();
  let product = it.productId
    ? products.find((p) => p.id === it.productId)
    : null;

  if (!product) {
    // New product: create it now, with the invoice's prices.
    product = {
      id: newId(),
      name: it.name.trim(),
      price: Number(it.customerPrice) || 0,
      customerPrice: Number(it.customerPrice) || 0,
      purchasePrice: Number(it.purchasePrice) || 0,
      partnerPrice: it.partnerPrice ? Number(it.partnerPrice) : null,
      count: 0,
      dollarRateAtAdded: null,
      dollarRateRecordedAt: null,
      lastInvoiceId: activeInvoiceId,
    };
    products.push(product);
    it.productId = product.id;
  }

  product.count = Number(product.count || 0) + delta;
  // The invoice is the source of truth for what we actually paid —
  // update the current purchase cost only now, at the moment of receiving.
  product.purchasePrice = Number(it.purchasePrice) || 0;
  product.lastInvoiceId = activeInvoiceId;

  if (!saveProducts(products)) {
    showInvoiceNotice("Browser storage is full — could not update inventory.");
    return;
  }

  it.addedQuantity = Number(it.addedQuantity || 0) + delta;
  persistInvoiceItemsToStore();
  renderInvoiceItemsTable();
  renderInvoicesList();
  refreshProductsDatalist();
  showInvoiceNotice(`Added ${delta} × "${it.name}" to inventory.`, "success");
}

receiveAllBtn.addEventListener("click", () => {
  for (const it of invoiceItems) {
    if (Number(it.receivedQuantity || 0) < Number(it.quantity || 0)) {
      it.receivedQuantity = it.quantity;
    }
  }
  renderInvoiceItemsTable();
  for (const it of [...invoiceItems]) {
    if (Number(it.receivedQuantity || 0) > Number(it.addedQuantity || 0)) {
      receiveInvoiceItem(it.rowId);
    }
  }
});

function resetInvoiceModal() {
  invoiceMode = "create";
  activeInvoiceId = null;
  invoiceItems = [blankInvoiceItem()];
  invSupplier.value = "";
  invNumber.value = "";
  invDate.value = new Date().toISOString().slice(0, 10);
  invShipping.value = "";
  invNotes.value = "";
  invoiceModalTitle.textContent = "New Purchase Invoice";
  invoiceStatusRow.style.display = "none";
}

function openNewInvoiceModal() {
  refreshProductsDatalist();
  resetInvoiceModal();
  renderInvoiceItemsTable();
  invoiceBackdrop.classList.add("show");
}

function openInvoiceModal(invoiceId) {
  const invoice = loadInvoices().find((inv) => inv.id === invoiceId);
  if (!invoice) return;
  refreshProductsDatalist();
  invoiceMode = "manage";
  activeInvoiceId = invoice.id;
  invoiceItems = invoice.items.map((it) => ({ ...it }));
  invSupplier.value = invoice.supplier;
  invNumber.value = invoice.invoiceNumber || "";
  invDate.value = (invoice.invoiceDate || invoice.createdAt || "").slice(0, 10);
  invShipping.value =
    invoice.shippingCost === null || invoice.shippingCost === undefined
      ? ""
      : invoice.shippingCost;
  invNotes.value = invoice.notes || "";
  invoiceModalTitle.textContent = `Invoice${invoice.invoiceNumber ? " #" + invoice.invoiceNumber : ""} — ${invoice.supplier}`;
  invoiceStatusRow.style.display = "block";
  renderInvoiceItemsTable();
  invoiceBackdrop.classList.add("show");
}

function closeInvoiceModal() {
  invoiceBackdrop.classList.remove("show");
}

document
  .getElementById("newInvoiceBtn")
  .addEventListener("click", openNewInvoiceModal);
document
  .getElementById("invoiceClose")
  .addEventListener("click", closeInvoiceModal);
document
  .getElementById("invoiceCancel")
  .addEventListener("click", closeInvoiceModal);
invoiceBackdrop.addEventListener("click", (event) => {
  if (event.target === invoiceBackdrop) closeInvoiceModal();
});

document.getElementById("invoiceSaveBtn").addEventListener("click", () => {
  const supplier = invSupplier.value.trim();
  const invoiceNumber = invNumber.value.trim();
  const invoiceDateVal = invDate.value;
  const notesVal = invNotes.value.trim();
  const shippingVal =
    invShipping.value.trim() === "" ? null : Number(invShipping.value);

  if (!supplier) return showInvoiceNotice("Supplier / company is required.");
  if (!invoiceDateVal) return showInvoiceNotice("Invoice date is required.");
  if (
    shippingVal !== null &&
    (!Number.isFinite(shippingVal) || shippingVal < 0)
  ) {
    return showInvoiceNotice("Enter a valid shipping cost, or leave it blank.");
  }
  if (invoiceItems.length === 0)
    return showInvoiceNotice("Add at least one item.");

  for (const it of invoiceItems) {
    if (!it.name.trim())
      return showInvoiceNotice("Every item needs a product name.");
    if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) < 1) {
      return showInvoiceNotice(`Enter a valid quantity for "${it.name}".`);
    }
    if (
      !Number.isFinite(Number(it.purchasePrice)) ||
      Number(it.purchasePrice) < 0
    ) {
      return showInvoiceNotice(
        `Enter a valid purchase price for "${it.name}".`,
      );
    }
    if (
      !Number.isFinite(Number(it.customerPrice)) ||
      Number(it.customerPrice) < 0
    ) {
      return showInvoiceNotice(
        `Enter a valid customer sale price for "${it.name}".`,
      );
    }
    if (
      it.partnerPrice !== "" &&
      (!Number.isFinite(Number(it.partnerPrice)) || Number(it.partnerPrice) < 0)
    ) {
      return showInvoiceNotice(
        `Enter a valid partner sale price for "${it.name}", or 0.`,
      );
    }
    if (Number(it.addedQuantity || 0) > Number(it.quantity)) {
      // Quantity was reduced below what's already been received — not allowed.
      return showInvoiceNotice(
        `"${it.name}" already has ${it.addedQuantity} added to inventory — quantity can't go below that.`,
      );
    }
  }

  const isoDate = new Date(invoiceDateVal + "T12:00:00").toISOString();
  const { goods, shipping, total } = recomputeInvoiceTotals();

  // Sync customer/partner prices to any already-existing linked product
  // right away — these may legitimately change before the goods arrive.
  // Purchase price on the product is only touched at receiving time.
  const products = loadProducts();
  let productsChanged = false;
  for (const it of invoiceItems) {
    if (it.productId) {
      const product = products.find((p) => p.id === it.productId);
      if (product) {
        product.customerPrice = Number(it.customerPrice) || 0;
        product.price = product.customerPrice;
        product.partnerPrice =
          it.partnerPrice !== ""
            ? Number(it.partnerPrice)
            : (product.partnerPrice ?? null);
        productsChanged = true;
      }
    }
  }
  if (productsChanged) saveProducts(products);

  const invoices = loadInvoices();
  const cleanedItems = invoiceItems.map((it) => ({
    rowId: it.rowId,
    productId: it.productId,
    name: it.name.trim(),
    quantity: Number(it.quantity),
    receivedQuantity: Number(it.receivedQuantity) || 0,
    addedQuantity: Number(it.addedQuantity) || 0,
    purchasePrice: Number(it.purchasePrice),
    customerPrice: Number(it.customerPrice),
    partnerPrice:
      it.partnerPrice === "" || it.partnerPrice === null
        ? null
        : Number(it.partnerPrice),
  }));

  if (invoiceMode === "create") {
    const invoiceId = newId();
    const expenseId = newId();
    const invoice = {
      id: invoiceId,
      supplier,
      invoiceNumber,
      invoiceDate: isoDate,
      notes: notesVal,
      items: cleanedItems,
      shippingCost: shippingVal,
      totalAmount: total,
      status: computeInvoiceStatus(cleanedItems),
      expenseId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    invoices.push(invoice);
    saveInvoices(invoices);

    const expenses = loadExpenses();
    expenses.unshift({
      id: expenseId,
      item: `Invoice${invoiceNumber ? " #" + invoiceNumber : ""} — ${supplier}`,
      cost: goods,
      shipping: shipping,
      notes: notesVal,
      image: null,
      date: isoDate,
      history: [],
      sourceInvoiceId: invoiceId,
      type: "purchase",
    });
    saveExpenses(expenses);

    showNotice("Purchase invoice created and recorded as an expense.");
  } else {
    const invoice = invoices.find((inv) => inv.id === activeInvoiceId);
    if (!invoice) return closeInvoiceModal();
    invoice.supplier = supplier;
    invoice.invoiceNumber = invoiceNumber;
    invoice.invoiceDate = isoDate;
    invoice.notes = notesVal;
    invoice.items = cleanedItems;
    invoice.shippingCost = shippingVal;
    invoice.totalAmount = total;
    invoice.status = computeInvoiceStatus(cleanedItems);
    invoice.updatedAt = new Date().toISOString();
    saveInvoices(invoices);

    const expenses = loadExpenses();
    const linkedExpense = expenses.find((e) => e.id === invoice.expenseId);
    if (linkedExpense) {
      linkedExpense.item = `Invoice${invoiceNumber ? " #" + invoiceNumber : ""} — ${supplier}`;
      linkedExpense.cost = goods;
      linkedExpense.shipping = shipping;
      linkedExpense.notes = notesVal;
      linkedExpense.date = isoDate;
      saveExpenses(expenses);
    }

    showNotice("Purchase invoice updated.");
  }

  closeInvoiceModal();
  render();
  renderInvoicesList();
  refreshProductsDatalist();
});

function renderInvoicesList() {
  const invoices = loadInvoices();
  invoicesBody.innerHTML = invoices
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((inv) => {
      const status = computeInvoiceStatus(inv.items);
      const itemCount = inv.items.reduce(
        (s, it) => s + Number(it.quantity || 0),
        0,
      );
      return `
          <tr>
            <td>${inv.invoiceNumber ? escapeHtml(inv.invoiceNumber) : "—"}</td>
            <td>${escapeHtml(inv.supplier)}</td>
            <td>${faDateShort(inv.invoiceDate)}</td>
            <td>${inv.items.length} product(s), ${itemCount} unit(s)</td>
            <td class="num">${fmt(inv.totalAmount)} Toman</td>
            <td>${statusBadgeHtml(status)}</td>
            <td>
              <div class="actions">
                <button class="button button-secondary button-small" type="button" data-manage="${inv.id}">Manage</button>
                <button class="button button-danger button-small" type="button" data-delete-invoice="${inv.id}">Delete</button>
              </div>
            </td>
          </tr>`;
    })
    .join("");
  invoicesEmptyState.style.display = invoices.length ? "none" : "block";
}

invoicesBody.addEventListener("click", (event) => {
  const manageBtn = event.target.closest("[data-manage]");
  if (manageBtn) return openInvoiceModal(manageBtn.dataset.manage);

  const delBtn = event.target.closest("[data-delete-invoice]");
  if (delBtn) {
    const invoices = loadInvoices();
    const invoice = invoices.find(
      (inv) => inv.id === delBtn.dataset.deleteInvoice,
    );
    if (!invoice) return;
    const hasReceived = invoice.items.some(
      (it) => Number(it.addedQuantity || 0) > 0,
    );
    const warn = hasReceived
      ? " Some items were already added to inventory — deleting the invoice will NOT remove them from stock."
      : "";
    if (!confirm(`Delete invoice for "${invoice.supplier}"?${warn}`)) return;

    saveInvoices(invoices.filter((inv) => inv.id !== invoice.id));
    const expenses = loadExpenses().filter((e) => e.id !== invoice.expenseId);
    saveExpenses(expenses);

    render();
    renderInvoicesList();
  }
});

// ---- Init ----
updateTotalPreview();
render();
renderInvoicesList();
refreshProductsDatalist();
