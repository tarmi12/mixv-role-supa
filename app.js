function formatCodeInGroups(code) {
  if (!code) return "";
  const cleaned = String(code).replace(/\s+/g, '');
  return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
}

const SUPABASE_URL = "https://bkgyqjpbiwqzpywrzbbf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrZ3lxanBiaXdxenB5d3J6YmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MzcxOTUsImV4cCI6MjEwNTMxMzE5NX0.P3iZtEYI1YJ2zKHGk-NvBEq5qHt2JPuzFgo-jlUXKo8";

let state = {
  user: null,
  profile: null,
  sessionToken: null,
  combineItems: []
};

function getHeaders(token = state.sessionToken) {
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json"
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function callEdgeFunction(action, payload = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tiger-api`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ action, payload })
  });
  const json = await res.json();
  console.log(`[Tiger-API] Action: ${action}`, json);
  if (!res.ok) throw new Error(json.error || json.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ Tiger API");
  return json;
}

function parseVoucherAmount(info) {
  console.log("[Tiger-API] Show Info Raw:", info);
  if (!info) return 0;
  let val = info?.amount ?? 
            info?.balance ?? 
            info?.total_amount ?? 
            info?.value ?? 
            info?.data?.amount ?? 
            info?.data?.balance ?? 
            info?.data?.total_amount ?? 
            info?.data?.value ?? 
            info?.result?.amount ?? 
            info?.result?.balance ?? 
            0;
  return parseFloat(val) || 0;
}

function extractTigerVoucherCode(createRes) {
  console.log("[Tiger-API] Raw Create Response:", createRes);

  if (!createRes) throw new Error("Tiger API ไม่ได้ส่งข้อมูลตอบกลับมา");
  if (typeof createRes === 'string' && createRes.trim().length > 3) return createRes.trim();

  const keysToSearch = [
    'voucher_number', 'voucher_no', 'voucher_code', 'vouchernumber', 'voucherno', 'vouchercode',
    'code', 'voucher', 'barcode', 'qr_code', 'qr_data', 'qr'
  ];

  let foundCode = null;
  function searchRecursive(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of keysToSearch) {
      if (obj[k] && typeof obj[k] === 'string' && !obj[k].startsWith('TX-')) {
        foundCode = obj[k];
        return;
      } else if (obj[k] && typeof obj[k] === 'number') {
        foundCode = String(obj[k]);
        return;
      }
    }
    for (const childKey of Object.keys(obj)) {
      if (typeof obj[childKey] === 'object' && !foundCode) {
        searchRecursive(obj[childKey]);
      }
    }
  }

  searchRecursive(createRes);

  if (!foundCode) {
    const jsonStr = JSON.stringify(createRes);
    const match = jsonStr.match(/\b\d{10,16}\b/);
    if (match) foundCode = match[0];
  }

  if (!foundCode) {
    alert("โครงสร้างที่ Tiger ส่งมา:\n" + JSON.stringify(createRes, null, 2));
    throw new Error("ระบบออกคูปองสำเร็จ แต่ไม่พบเลข Voucher จาก Tiger API");
  }

  return String(foundCode).trim();
}

// --- Authentication Flow ---
const formLogin = document.getElementById("form-login");
const authAlert = document.getElementById("auth-alert");

formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  authAlert.classList.add("hidden");
  const btn = document.getElementById("btn-login");
  btn.textContent = "กำลังตรวจสอบ...";
  btn.disabled = true;

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: getHeaders(null),
      body: JSON.stringify({ email, password })
    });
    const authData = await authRes.json();
    if (!authRes.ok) throw new Error(authData.error_description || authData.message || "อีเมลหรือรหัสผ่านไม่ถูกต้อง");

    state.sessionToken = authData.access_token;
    state.user = authData.user;

    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${state.user.id}&select=*`, {
      headers: getHeaders(state.sessionToken)
    });
    const profiles = await profileRes.json();
    if (!profiles || profiles.length === 0) {
      throw new Error("ไม่พบข้อมูลสิทธิ์ผู้ใช้งาน (Profile) ในระบบ");
    }

    state.profile = profiles[0];
    initDashboard();
  } catch (err) {
    authAlert.textContent = err.message;
    authAlert.classList.remove("hidden");
  } finally {
    btn.textContent = "เข้าสู่ระบบ";
    btn.disabled = false;
  }
});

document.getElementById("btn-logout").addEventListener("click", () => {
  state = { user: null, profile: null, sessionToken: null, combineItems: [] };
  document.getElementById("view-dashboard").classList.add("hidden");
  document.getElementById("view-auth").classList.remove("hidden");
  document.getElementById("login-password").value = "";
});

function initDashboard() {
  document.getElementById("view-auth").classList.add("hidden");
  document.getElementById("view-dashboard").classList.remove("hidden");
  document.getElementById("user-display").textContent = `${state.profile.display_name} (${state.profile.email})`;

  const badge = document.getElementById("badge-role");
  const ownerPanel = document.getElementById("panel-owner");

  if (state.profile.role === "owner") {
    badge.textContent = "OWNER PORTAL";
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-purple-100 text-purple-800";
    ownerPanel.classList.remove("hidden");
  } else {
    badge.textContent = "STAFF PORTAL";
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800";
    ownerPanel.classList.add("hidden");
  }

  loadHistory();
}

// ================= 1. Scan Cancel & Re-issue =================
const inputReissueCode = document.getElementById("input-reissue-code");
const inputReissueAmount = document.getElementById("input-reissue-amount");
const btnReissueSubmit = document.getElementById("btn-reissue-submit");

btnReissueSubmit.addEventListener("click", async () => {
  const code = inputReissueCode.value.trim().replace(/\s+/g, '');
  const amount = parseFloat(inputReissueAmount.value);

  if (!code) return alert("กรุณายิงสแกน หรือพิมพ์เลขคูปองเดิม");
  if (isNaN(amount) || amount <= 0) return alert("กรุณาระบุยอดเงินสร้างใหม่ที่ถูกต้อง");

  if (!confirm(`ยืนยันยกเลิกคูปองเดิม [${code}]\nและสร้างคูปองใหม่ยอด: ${amount.toFixed(2)} บาท?`)) return;

  btnReissueSubmit.disabled = true;
  btnReissueSubmit.textContent = "กำลังดำเนินการ...";
  const txId = "TX-" + Date.now();

  try {
    await callEdgeFunction("cancel", { voucher_num: code });

    const createRes = await callEdgeFunction("create", {
      amount: amount,
      ref_num: txId,
      note: `Reissued from: ${code}`
    });

    const realTigerVoucherCode = extractTigerVoucherCode(createRes);

    await callEdgeFunction("db_insert", {
      transaction_id: txId,
      action_type: "REISSUE",
      staff_name: state.profile.display_name,
      total_amount: amount,
      new_voucher_code: realTigerVoucherCode,
      old_vouchers: [code],
      ref_num: `${code} -> ${realTigerVoucherCode}`
    });

    alert("ยกเลิกและออกคูปองใหม่สำเร็จ! เลขที่: " + realTigerVoucherCode);

    triggerPrintSlip({
      txId,
      actionTitle: "ใบรับเงินยกยอดคูปอง",
      staff: state.profile.display_name,
      amount: amount,
      voucherCode: realTigerVoucherCode,
      olds: [{ desc: `บิลเดิม:`, code: code, amount: amount }]
    });

    inputReissueCode.value = "";
    inputReissueAmount.value = "";
    loadHistory();
  } catch (err) {
    alert("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    btnReissueSubmit.disabled = false;
    btnReissueSubmit.textContent = "ยกเลิกคูปองเดิม & ออกใบใหม่ทันที";
  }
});

// ================= 2. Create Voucher (ฟังก์ชันลับ **1) =================
document.getElementById("btn-owner-create").addEventListener("click", async () => {
  const rawAmountInput = document.getElementById("owner-amount").value.trim();
  const rawRefInput = document.getElementById("owner-ref").value.trim();
  const pin = document.getElementById("owner-pin").value.trim();

  const hasSecretTag = rawAmountInput.endsWith("**1") || rawRefInput.endsWith("**1");
  if (!hasSecretTag) return alert("ไม่สามารถดำเนินการได้: ข้อมูลไม่ถูกต้อง");

  const cleanAmountStr = rawAmountInput.replace("**1", "").trim();
  const amount = parseFloat(cleanAmountStr);

  if (!amount || amount <= 0) return alert("กรุณาระบุมูลค่าเงินที่ถูกต้อง");
  if (pin !== "1234") return alert("รหัส PIN ยืนยันไม่ถูกต้อง");

  const txId = "TX-OWN-" + Date.now();
  const cleanRef = rawRefInput.replace("**1", "").trim();
  const secretRef = cleanRef ? `${cleanRef}**1` : `OWNER**1`;

  try {
    const createRes = await callEdgeFunction("create", {
      amount: amount,
      ref_num: secretRef,
      require_pin: true,
      pin: pin,
      is_owner_action: true,
      tag: "**1"
    });

    const realTigerVoucherCode = extractTigerVoucherCode(createRes);

    await callEdgeFunction("db_insert", {
      transaction_id: txId,
      action_type: "OWNER_DIRECT",
      staff_name: `${state.profile.display_name}`,
      total_amount: amount,
      new_voucher_code: realTigerVoucherCode,
      ref_num: secretRef
    });

    alert("ออกคูปองพิเศษสำเร็จ! เลขที่: " + realTigerVoucherCode);
    triggerPrintSlip({
      txId,
      actionTitle: "ใบรับเงินคูปองพิเศษ",
      staff: `${state.profile.display_name}`,
      amount: amount,
      voucherCode: realTigerVoucherCode,
      olds: [{ desc: "ออกคูปองพิเศษ", amount: amount }]
    });

    document.getElementById("owner-amount").value = "";
    document.getElementById("owner-ref").value = "";
    document.getElementById("owner-pin").value = "";
    loadHistory();
  } catch (err) {
    alert("ทำรายการล้มเหลว: " + err.message);
  }
});

// ================= 3. Cancel Voucher =================
document.getElementById("btn-cancel-direct").addEventListener("click", async () => {
  const code = document.getElementById("input-check-code").value.trim().replace(/\s+/g, '');
  if (!code) return alert("กรุณาระบุเลขคูปองที่ต้องการยกเลิก");

  if (!confirm(`ยืนยันยกเลิกคูปอง [${code}] หรือไม่?`)) return;

  try {
    await callEdgeFunction("cancel", { voucher_num: code });
    await callEdgeFunction("db_insert", {
      transaction_id: "TX-CAN-" + Date.now(),
      action_type: "CANCEL_SINGLE",
      staff_name: state.profile.display_name,
      total_amount: 0.00,
      old_vouchers: [code]
    });

    alert("ยกเลิกคูปองสำเร็จเรียบร้อย");
    document.getElementById("input-check-code").value = "";
    loadHistory();
  } catch (err) {
    alert("ไม่สามารถยกเลิกได้: " + err.message);
  }
});

// ================= 4. Combine Vouchers =================
const inputCombineCode = document.getElementById("input-combine-code");
const inputCombineNote = document.getElementById("input-combine-note");
const btnAddCombine = document.getElementById("btn-add-combine");
const listCombine = document.getElementById("list-combine");
const textCombineTotal = document.getElementById("text-combine-total");
const btnSubmitCombine = document.getElementById("btn-submit-combine");

async function scanAndAddCombine() {
  const code = inputCombineCode.value.trim().replace(/\s+/g, '').toUpperCase();
  if (!code) return;

  if (state.combineItems.some(item => item.code === code)) {
    inputCombineCode.value = "";
    return alert("มีรหัสคูปองนี้อยู่ในรายการแล้ว");
  }

  btnAddCombine.disabled = true;
  btnAddCombine.textContent = "กำลังเช็ค...";

  try {
    const info = await callEdgeFunction("show", { voucher_num: code });
    const amount = parseVoucherAmount(info);

    if (amount <= 0) {
      throw new Error("คูปองนี้มียอดเงินคงเหลือ 0.00 บาท หรือถูกยกเลิก/ใช้งานไปแล้ว");
    }

    state.combineItems.push({ code, amount });
    inputCombineCode.value = "";
    renderCombineList();
  } catch (err) {
    alert(`ดึงยอดไม่สำเร็จ: ${err.message}`);
    inputCombineCode.select();
  } finally {
    btnAddCombine.disabled = false;
    btnAddCombine.textContent = "+ ตรวจสอบ & เพิ่ม";
    inputCombineCode.focus();
  }
}

inputCombineCode.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    scanAndAddCombine();
  }
});

btnAddCombine.addEventListener("click", scanAndAddCombine);

function renderCombineList() {
  listCombine.innerHTML = "";

  if (state.combineItems.length === 0) {
    listCombine.innerHTML = `<li class="py-3 text-xs text-slate-400 text-center">ยังไม่มีรายการคูปอง (ยิงสแกนเพื่อเพิ่ม)</li>`;
    textCombineTotal.textContent = "0.00 ฿";
    btnSubmitCombine.disabled = true;
    return;
  }

  let total = 0;
  state.combineItems.forEach((item, index) => {
    total += item.amount;
    const li = document.createElement("li");
    li.className = "py-2.5 flex justify-between items-center text-xs";
    li.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="font-mono font-bold text-slate-900">${formatCodeInGroups(item.code)}</span>
        <span class="text-emerald-600 font-bold">(${item.amount.toFixed(2)} บาท)</span>
      </div>
      <button onclick="removeCombineItem(${index})" class="text-red-500 font-bold hover:text-red-700 px-2 py-1 rounded bg-red-50 hover:bg-red-100 transition">
        ลบ
      </button>
    `;
    listCombine.appendChild(li);
  });

  textCombineTotal.textContent = `${total.toFixed(2)} ฿`;
  btnSubmitCombine.disabled = false;
}

window.removeCombineItem = function(index) {
  state.combineItems.splice(index, 1);
  renderCombineList();
};

btnSubmitCombine.addEventListener("click", async () => {
  if (state.combineItems.length === 0) return;

  const totalAmount = state.combineItems.reduce((acc, curr) => acc + curr.amount, 0);
  const oldCodes = state.combineItems.map(i => i.code);
  const customNote = inputCombineNote.value.trim();
  const txId = "TX-CMB-" + Date.now();

  if (!confirm(`ยืนยันการรวมคูปองทั้งหมด ${oldCodes.length} ใบ\nยอดรวมสุทธิ: ${totalAmount.toFixed(2)} บาท?`)) return;

  btnSubmitCombine.disabled = true;
  btnSubmitCombine.textContent = "กำลังดำเนินการ...";

  try {
    for (const code of oldCodes) {
      try {
        await callEdgeFunction("cancel", { voucher_num: code });
      } catch (cancelErr) {
        console.warn(`ยกเลิกคูปอง ${code} ไม่สำเร็จ:`, cancelErr);
      }
    }

    const createRes = await callEdgeFunction("create", {
      amount: totalAmount,
      ref_num: txId,
      note: customNote ? `${customNote} | Combined: ${oldCodes.join(", ")}` : `Combined from: ${oldCodes.join(", ")}`
    });

    const realTigerVoucherCode = extractTigerVoucherCode(createRes);

    await callEdgeFunction("db_insert", {
      transaction_id: txId,
      action_type: "COMBINE",
      staff_name: state.profile.display_name,
      total_amount: totalAmount,
      new_voucher_code: realTigerVoucherCode,
      old_vouchers: oldCodes,
      ref_num: customNote || `รวม ${oldCodes.length} ใบ -> ${realTigerVoucherCode}`
    });

    alert("รวมคูปองสำเร็จเรียบร้อย! เลขที่ใบใหม่: " + realTigerVoucherCode);

    triggerPrintSlip({
      txId,
      actionTitle: "ใบรับเงินรวมคูปอง",
      staff: state.profile.display_name,
      amount: totalAmount,
      voucherCode: realTigerVoucherCode,
      olds: state.combineItems.map((item, idx) => ({ desc: `บิลที่ ${idx + 1}:`, code: item.code, amount: item.amount }))
    });

    state.combineItems = [];
    inputCombineNote.value = "";
    renderCombineList();
    loadHistory();
  } catch (err) {
    alert("เกิดข้อผิดพลาดในการรวมคูปอง: " + err.message);
  } finally {
    btnSubmitCombine.disabled = false;
    btnSubmitCombine.textContent = "ยืนยันการรวมบิลและสร้าง QR ใหม่";
  }
});

// ================= 5. Transaction History Loader =================
async function loadHistory() {
  const tbody = document.getElementById("history-rows");
  try {
    const list = await callEdgeFunction("db_select");
    tbody.innerHTML = "";
    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400">ยังไม่มีประวัติการทำรายการ</td></tr>`;
      return;
    }

    list.forEach(row => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50 transition-colors";
      const dateStr = new Date(row.created_at).toLocaleString("th-TH");
      tr.innerHTML = `
        <td class="px-6 py-3 font-mono text-xs">${dateStr}</td>
        <td class="px-6 py-3"><span class="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100">${row.action_type}</span></td>
        <td class="px-6 py-3 font-medium text-slate-800">${row.staff_name}</td>
        <td class="px-6 py-3 font-bold text-emerald-600">${parseFloat(row.total_amount).toFixed(2)} ฿</td>
        <td class="px-6 py-3 font-mono font-bold text-slate-900">${formatCodeInGroups(row.new_voucher_code) || "-"}</td>
        <td class="px-6 py-3 text-right">
          ${row.new_voucher_code ? `<button onclick="reprintTx('${row.transaction_id}', '${row.action_type}', '${row.staff_name}', ${row.total_amount}, '${row.new_voucher_code}')" class="text-xs text-amber-600 hover:text-amber-800 font-bold">พิมพ์สลิปอีกครั้ง</button>` : "-"}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-red-500">โหลดข้อมูลล้มเหลว: ${err.message}</td></tr>`;
  }
}

document.getElementById("btn-refresh-history").addEventListener("click", loadHistory);

// ================= Thermal Print System =================
function triggerPrintSlip({ txId, actionTitle = "ใบรับเงินรวมคูปอง", staff, amount, voucherCode, olds = [], isReprint = false }) {
  const now = new Date();
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear() + 543} ${now.toLocaleTimeString('th-TH')}`;

  const headerBadge = isReprint ? "REPRINT SLIP" : "RECEIPT SLIP";
  document.getElementById("slip-header-badge1").textContent = headerBadge;
  document.getElementById("slip-header-badge2").textContent = headerBadge;
  document.getElementById("slip-staff-id1").textContent = staff;
  document.getElementById("slip-staff-id2").textContent = staff;

  document.getElementById("slip-title1").textContent = actionTitle;
  document.getElementById("slip-title2").textContent = actionTitle.replace("ใบรับเงิน", "หลักฐาน");

  // ท่อนที่ 1 (ลูกค้า)[cite: 2]
  document.getElementById("slip-date1").textContent = dateStr;
  document.getElementById("slip-staff1").textContent = `${staff} | บิล: 1801`;
  document.getElementById("slip-tx1").textContent = txId;

  const oldList1 = document.getElementById("slip-old-items1");
  oldList1.innerHTML = "";
  olds.forEach(item => {
    const div = document.createElement("div");
    div.className = "flex justify-between font-bold";
    const descText = item.code ? `${item.desc} ${item.code}` : (item.desc || item);
    div.innerHTML = `<span>${descText}</span><span>${item.amount ? item.amount.toFixed(2) + ' บาท' : ''}</span>`;
    oldList1.appendChild(div);
  });

  document.getElementById("slip-amount1").textContent = `${amount.toFixed(2)} บาท`;

  // ท่อนที่ 2 (ร้านค้าเก็บ/สแกนตู้)[cite: 2]
  document.getElementById("slip-date2").textContent = dateStr;
  document.getElementById("slip-tx2").textContent = txId;
  document.getElementById("slip-staff2").textContent = staff;

  const oldList2 = document.getElementById("slip-old-items2");
  oldList2.innerHTML = "";
  olds.forEach(item => {
    const div = document.createElement("div");
    div.className = "flex justify-between font-bold";
    const codeText = item.code || item.desc || item;
    div.innerHTML = `<span>${codeText}</span><span>${item.amount ? item.amount.toFixed(2) + ' ฿' : ''}</span>`;
    oldList2.appendChild(div);
  });

  document.getElementById("slip-amount2").textContent = `${amount.toFixed(2)} บาท`;

  // แสดงเลข Voucher แท้จัดกลุ่ม 4 หลัก และสร้าง QR Code[cite: 2]
  const cleanVoucher = String(voucherCode).trim();
  document.getElementById("slip-code-formatted").textContent = formatCodeInGroups(cleanVoucher);

  const qrContainer = document.getElementById("qrcode-container");
  qrContainer.innerHTML = "";
  new QRCode(qrContainer, {
    text: cleanVoucher.replace(/\s+/g, ''),
    width: 175,
    height: 175,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  const slip = document.getElementById("thermal-slip");
  slip.classList.remove("hidden");
  setTimeout(() => {
    window.print();
    slip.classList.add("hidden");
  }, 150);
}

window.reprintTx = function(txId, actionType, staff, amount, voucherCode) {
  triggerPrintSlip({
    txId,
    actionTitle: "ใบรับเงินรวมคูปอง",
    staff: staff,
    amount: parseFloat(amount),
    voucherCode: voucherCode,
    olds: [{ desc: "พิมพ์ซ้ำ (Reprint)", amount: parseFloat(amount) }],
    isReprint: true
  });
};
