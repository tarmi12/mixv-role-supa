// --- Supabase Config ---
const SUPABASE_URL = "https://bkgyqjpbiwqzpywrzbbf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrZ3lxanBiaXdxenB5d3J6YmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MzcxOTUsImV4cCI6MjEwNTMxMzE5NX0.P3iZtEYI1YJ2zKHGk-NvBEq5qHt2JPuzFgo-jlUXKo8";

let historyAllData = [];
let currentHistoryPage = 1;
const itemsPerPage = 20;

function formatCodeInGroups(code) {
  if (!code) return "";
  const cleaned = String(code).replace(/\s+/g, '');
  return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
}

function getHeaders() {
  return {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

async function callBackend(action, payload = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tiger-api`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ action, payload })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || json.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ Tiger API");
  return json;
}

// เพิ่มช่องกรอกคูปองเดิม
document.getElementById("btn-add-voucher-input").addEventListener("click", () => {
  const container = document.getElementById("voucher-inputs-container");
  const count = container.querySelectorAll(".staff-v-input").length + 1;
  const div = document.createElement("div");
  div.className = "flex gap-2 items-center";
  div.innerHTML = `
    <input type="text" placeholder="ยิงหรือพิมพ์เลขคูปองใบที่ ${count}" class="staff-v-input flex-1 px-3 py-2 border rounded-lg uppercase tracking-wider text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none">
    <button type="button" onclick="this.parentElement.remove()" class="text-red-500 hover:text-red-700 px-2 py-1 font-bold text-xs bg-red-50 rounded">ลบ</button>
  `;
  container.appendChild(div);
  div.querySelector("input").focus();
});

// ================= ฟังก์ชันรวมยอดคูปองสำหรับพนักงาน (จากไฟล์ตัวเก่า) =================
async function processStaffCombine() {
  const staff = document.getElementById('staff_name').value.trim();
  const ref = document.getElementById('staff_combine_ref').value.trim();
  const inputs = Array.from(document.querySelectorAll('.staff-v-input'))
                      .map(i => i.value.trim().replace(/[^0-9a-zA-Z]/g, ''))
                      .filter(v => v.length > 0);

  if (!staff) return alert("กรุณาระบุชื่อพนักงาน");
  if (!ref) return alert("กรุณาระบุเลขที่บิล / เอกสารอ้างอิง");
  if (inputs.length < 2) return alert("ต้องระบุรหัสคูปองเดิมตั้งแต่ 2 ใบขึ้นไป");

  const btn = document.getElementById('btn-combine');
  btn.disabled = true;
  btn.innerText = "กำลังตรวจสอบยอดจากตู้ Tiger...";

  try {
    let totalAmount = 0;
    let oldVoucherDetails = [];

    for (const code of inputs) {
      const showRes = await callBackend("show", { voucher_num: code });
      const voucherObj = showRes?.voucher || showRes?.result || showRes?.data || (Array.isArray(showRes) ? showRes[0] : showRes);

      const rawAmt = voucherObj?.amount ?? voucherObj?.balance;
      const amt = parseFloat(String(rawAmt || '').replace(/,/g, ''));
      const isUsed = String(voucherObj?.used) === "1" || voucherObj?.used === 1 || voucherObj?.used === true;

      if (isNaN(amt) || amt <= 0) {
        throw new Error(`คูปอง ${code} ไม่พบยอดเงิน หรือตรวจสอบไม่ได้`);
      }

      if (isUsed) {
        throw new Error(`คูปอง ${code} ถูกใช้งานหรือยกเลิกไปแล้ว (used = 1)`);
      }

      await callBackend("cancel", { voucher_num: code });
      totalAmount += amt;
      oldVoucherDetails.push({ code: code, amount: amt });
    }

    btn.innerText = "กำลังสร้างคูปองใหม่...";

    const txId = `TX-${Date.now()}`;
    const createRes = await callBackend("create", {
      amount: totalAmount.toFixed(2),
      ref_num: ref,
      note: `Staff Combined: ${inputs.join(",")}`
    });

    const newCode = Array.isArray(createRes?.result) ? createRes.result[0] : (createRes?.result || createRes?.[0]);
    if (!newCode) throw new Error("Tiger สร้างยอดรวมสำเร็จแต่ไม่ได้ส่งรหัสคูปองใหม่กลับมา");

    await callBackend("db_insert", {
      transaction_id: txId,
      action_type: 'COMBINE',
      staff_name: staff,
      total_amount: totalAmount,
      new_voucher_code: String(newCode),
      old_vouchers: oldVoucherDetails,
      ref_num: ref,
      error_message: 'รวมยอดสำเร็จ'
    });

    // สั่งพิมพ์แยก 2 ใบตัดตรงกลางอัตโนมัติ สำหรับหน้ารวมยอดคูปอง
    renderAndPrintCombineSlip({
      txId,
      dateStr: new Date().toLocaleString('th-TH'),
      staff: staff,
      ref: ref,
      oldVouchers: oldVoucherDetails,
      totalAmount: totalAmount.toFixed(2),
      newCode: String(newCode),
      isReprint: false
    });

    document.getElementById('staff_combine_ref').value = '';
    const container = document.getElementById("voucher-inputs-container");
    container.innerHTML = `
      <input type="text" placeholder="ยิงหรือพิมพ์เลขคูปองใบที่ 1" class="staff-v-input w-full px-3 py-2 border rounded-lg uppercase tracking-wider text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none">
      <input type="text" placeholder="ยิงหรือพิมพ์เลขคูปองใบที่ 2" class="staff-v-input w-full px-3 py-2 border rounded-lg uppercase tracking-wider text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none">
    `;

    loadStaffHistory();
  } catch (err) {
    alert("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "ตรวจสอบยอดและดำเนินการรวมคูปอง";
  }
}

document.getElementById('btn-combine').addEventListener('click', processStaffCombine);

// ================= ฟังก์ชันยกเลิกเดี่ยว (จากไฟล์ตัวเก่า) =================
async function processStaffCancel() {
  const staff = document.getElementById('staff_name').value.trim();
  const code = document.getElementById('staff_cancel_code').value.trim().replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  const reason = document.getElementById('staff_cancel_reason').value.trim() || 'Staff VOID';

  if (!staff) return alert("กรุณาระบุชื่อพนักงาน");
  if (!code || code.length < 5) return alert("กรุณาระบุรหัสคูปอง 12 หลัก");
  if (!confirm(`ยืนยันการยกเลิกคูปอง ${code} หรือไม่?`)) return;

  const btn = document.getElementById('btn-cancel');
  btn.disabled = true;
  btn.innerText = "กำลังยกเลิก...";

  try {
    await callBackend("cancel", { voucher_num: code });
    const txId = `VOID-${Date.now()}`;

    await callBackend("db_insert", {
      transaction_id: txId,
      action_type: 'CANCEL_SINGLE',
      staff_name: staff,
      total_amount: 0.00,
      old_vouchers: [{ code, amount: 0 }],
      ref_num: '-',
      error_message: reason
    });

    renderAndPrintVoidSlip({
      txId,
      dateStr: new Date().toLocaleString('th-TH'),
      staff: staff,
      voucherNum: code,
      reason: reason
    });

    document.getElementById('staff_cancel_code').value = '';
    document.getElementById('staff_cancel_reason').value = '';
    loadStaffHistory();
  } catch (err) {
    alert("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "ยืนยันการยกเลิกคูปอง";
  }
}

document.getElementById('btn-cancel').addEventListener('click', processStaffCancel);

// ================= โหลดประวัติและระบบแบ่งหน้า =================
async function loadStaffHistory() {
  const tbody = document.getElementById('staff-history-rows');
  const pag = document.getElementById('history-pagination');
  pag.classList.add('hidden');
  tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-400 font-bold">กำลังโหลดประวัติ...</td></tr>`;

  try {
    const data = await callBackend("db_select");
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-400 font-bold">ยังไม่มีประวัติการทำรายการ</td></tr>`;
      return;
    }

    historyAllData = data;
    currentHistoryPage = 1;
    renderHistoryPage();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-rose-500 font-bold">โหลดข้อมูลล้มเหลว: ${err.message}</td></tr>`;
  }
}

document.getElementById("btn-refresh-history").addEventListener("click", loadStaffHistory);

function renderHistoryPage() {
  const tbody = document.getElementById('staff-history-rows');
  const pag = document.getElementById('history-pagination');
  const totalItems = historyAllData.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  if (currentHistoryPage < 1) currentHistoryPage = 1;
  if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;

  const startIndex = (currentHistoryPage - 1) * itemsPerPage;
  const pageData = historyAllData.slice(startIndex, startIndex + itemsPerPage);

  tbody.innerHTML = pageData.map(item => `
    <tr class="hover:bg-slate-50 border-b border-slate-200 text-xs">
      <td class="p-3.5 font-mono">${new Date(item.created_at).toLocaleString('th-TH')}</td>
      <td class="p-3.5 font-mono font-bold text-slate-900">${item.transaction_id}<br><span class="text-slate-400 text-[11px] font-normal">${item.ref_num || '-'}</span></td>
      <td class="p-3.5">
        <span class="px-2.5 py-1 rounded text-xs font-black ${item.action_type === 'COMBINE' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}">
          ${item.action_type}
        </span>
      </td>
      <td class="p-3.5 font-medium">${item.staff_name}</td>
      <td class="p-3.5 font-black text-emerald-600 text-sm">${parseFloat(item.total_amount).toFixed(2)}</td>
      <td class="p-3.5 font-mono text-slate-500">${item.new_voucher_code ? formatCodeInGroups(item.new_voucher_code) : '-'}</td>
      <td class="p-3.5 text-center font-bold">${item.reprint_count || 0}</td>
      <td class="p-3.5 text-right">
        <button type="button" onclick='reprintStaffRecord(${JSON.stringify(item)})' class="bg-slate-800 hover:bg-black text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">Reprint</button>
      </td>
    </tr>
  `).join('');

  pag.classList.remove('hidden');
  document.getElementById('history-page-info').innerText = `แสดงรายการ ${startIndex + 1} - ${Math.min(startIndex + itemsPerPage, totalItems)} จากทั้งหมด ${totalItems} รายการ`;
  document.getElementById('history-page-num').innerText = `${currentHistoryPage} / ${totalPages}`;
  document.getElementById('btn-prev-page').disabled = currentHistoryPage === 1;
  document.getElementById('btn-next-page').disabled = currentHistoryPage === totalPages;
}

document.getElementById('btn-prev-page').addEventListener('click', () => { currentHistoryPage--; renderHistoryPage(); });
document.getElementById('btn-next-page').addEventListener('click', () => { currentHistoryPage++; renderHistoryPage(); });

// ฟังก์ชัน Reprint ประจำจุดพนักงาน
async function reprintStaffRecord(item) {
  const repStaff = prompt("ระบุชื่อพนักงานผู้พิมพ์ซ้ำ:", document.getElementById('staff_name').value);
  if (!repStaff) return;

  try {
    await callBackend("db_update", {
      id: item.id,
      updateData: {
        reprint_count: (item.reprint_count || 0) + 1,
        last_reprint_at: new Date().toISOString(),
        reprinted_by: repStaff
      }
    });
  } catch (e) {
    console.warn("Update reprint count failed:", e);
  }

  if (item.action_type === 'COMBINE') {
    renderAndPrintCombineSlip({
      txId: item.transaction_id,
      dateStr: new Date(item.created_at).toLocaleString('th-TH'),
      staff: item.staff_name,
      ref: item.ref_num,
      oldVouchers: item.old_vouchers,
      totalAmount: parseFloat(item.total_amount).toFixed(2),
      newCode: item.new_voucher_code,
      isReprint: true,
      reprintBy: repStaff
    });
  } else if (item.action_type === 'CANCEL_SINGLE') {
    renderAndPrintVoidSlip({
      txId: item.transaction_id,
      dateStr: new Date(item.created_at).toLocaleString('th-TH'),
      staff: item.staff_name,
      voucherNum: item.old_vouchers?.[0]?.code || '-',
      reason: item.error_message,
      isReprint: true,
      reprintBy: repStaff
    });
  }
}

// ================= ฟังก์ชันพิมพ์สลิปตามของเดิม =================
function renderAndPrintCombineSlip({ txId, dateStr, staff, ref, oldVouchers = [], totalAmount, newCode, isReprint = false, reprintBy }) {
  const slip = document.getElementById("thermal-slip");
  const headerBadge = isReprint ? `*** REPRINT SLIP (${reprintBy || staff}) ***` : `*** ใบรับเงินรวมคูปอง ***`;
  const headerBadge2 = isReprint ? `*** REPRINT SLIP (${reprintBy || staff}) ***` : `*** หลักฐานการรวมคูปอง ***`;

  const oldListHtml1 = oldVouchers.map((v, i) => `
    <div class="flex justify-between">
      <span>บิลที่ ${i + 1}: ${v.code || v.desc || ''}</span>
      <span>${parseFloat(v.amount).toFixed(2)} บาท</span>
    </div>
  `).join('');

  const oldListHtml2 = oldVouchers.map((v, i) => `
    <div class="flex justify-between">
      <span>${v.code || v.desc || `บิลที่ ${i + 1}`}</span>
      <span>${parseFloat(v.amount).toFixed(2)} ฿</span>
    </div>
  `).join('');

  slip.innerHTML = `
    <!-- ท่อนที่ 1 (ลูกค้า) -->
    <div class="slip-segment text-left">
      <div class="border border-black py-1 text-center font-bold text-[13px] tracking-wide mb-1">
        ${headerBadge}
      </div>
      <div class="text-center font-bold text-[13px] mb-2">
        ใบรับเงินรวมคูปอง<br>
        <span class="text-[11px] font-normal">(เอกสารสำหรับลูกค้า)</span>
      </div>

      <div class="text-[12px] font-bold space-y-0.5 mb-2">
        <div>วันที่-เวลา: ${dateStr}</div>
        <div>พนักงาน: ${staff} | บิล: ${ref || '-'}</div>
        <div>TX ID: ${txId}</div>
      </div>

      <div class="border-t border-dotted border-black pt-1.5 pb-1 space-y-1 text-[12px]">
        ${oldListHtml1}
      </div>

      <div class="border-t border-black pt-1.5 flex justify-between items-baseline text-base font-black mt-1">
        <span>ยอดรวมสุทธิ:</span>
        <span class="text-lg">${parseFloat(totalAmount).toFixed(2)} บาท</span>
      </div>
    </div>

    <div class="page-break"></div>

    <!-- ท่อนที่ 2 (ร้านค้าเก็บ/สแกนตู้) -->
    <div class="slip-segment text-center pt-1">
      <div class="border border-black py-1 text-center font-bold text-[13px] tracking-wide mb-1">
        ${headerBadge2}
      </div>
      <div class="text-center font-bold text-[13px] mb-2">
        หลักฐานการรวมคูปอง<br>
        <span class="text-[11px] font-normal">(ร้านเก็บไว้ / สแกนที่ตู้จ่ายเงิน)</span>
      </div>

      <div class="text-left text-[12px] font-bold space-y-0.5 mb-2">
        <div>วันที่-เวลา: ${dateStr} | TX: ${txId}</div>
        <div>พนักงาน: ${staff} | บิล: ${ref || '-'}</div>
      </div>

      <div class="border-t border-dotted border-black pt-1.5 pb-1 space-y-1 text-[12px] text-left">
        ${oldListHtml2}
      </div>

      <div class="border-t border-black pt-1.5 text-left font-black text-[13px] mb-2">
        ยอดเงินสร้างใหม่: ${parseFloat(totalAmount).toFixed(2)} บาท
      </div>

      <div class="text-xl font-black font-mono tracking-widest my-2">${formatCodeInGroups(newCode)}</div>

      <div class="flex justify-center my-3">
        <div id="print-qr-code" class="p-2 bg-white inline-block"></div>
      </div>

      <div class="text-[10.5px] font-bold text-center mt-1">
        *** นำ QR Code ด้านบนไปสแกนที่ตู้จ่ายเงิน ***
      </div>
    </div>
  `;

  new QRCode(document.getElementById("print-qr-code"), {
    text: String(newCode).trim(),
    width: 175,
    height: 175,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  slip.classList.remove("hidden");
  setTimeout(() => {
    window.print();
    slip.classList.add("hidden");
  }, 200);
}

function renderAndPrintVoidSlip({ txId, dateStr, staff, voucherNum, reason, isReprint = false, reprintBy }) {
  const slip = document.getElementById("thermal-slip");
  const header = isReprint ? `*** REPRINT VOID SLIP (${reprintBy || staff}) ***` : `*** ใบยกเลิกคูปอง (VOID SLIP) ***`;

  slip.innerHTML = `
    <div class="slip-segment text-left font-mono">
      <div class="border-2 border-black py-1.5 text-center font-black text-sm tracking-wide mb-3">
        ${header}
      </div>
      <div class="text-xs space-y-1.5 mb-3">
        <div>รหัสธุรกรรม: <strong>${txId}</strong></div>
        <div>วันที่-เวลา: ${dateStr}</div>
        <div>พนักงาน: <strong>${staff}</strong></div>
        <div class="border-t border-b border-black py-2 my-2 text-sm">
          <div>รหัสคูปองที่ยกเลิก:</div>
          <div class="text-lg font-black tracking-widest mt-1">${formatCodeInGroups(voucherNum)}</div>
        </div>
        <div>เหตุผล: <span class="font-bold">${reason || '-'}</span></div>
      </div>
      <div class="mt-8 pt-3 border-t border-dashed border-black flex justify-between text-[11px]">
        <div>( ลงชื่อผู้ยกเลิก )</div>
        <div>( ผู้จัดการ/พยาน )</div>
      </div>
    </div>
  `;

  slip.classList.remove("hidden");
  setTimeout(() => {
    window.print();
    slip.classList.add("hidden");
  }, 150);
}

// เริ่มต้นโหลดประวัติ
window.addEventListener('DOMContentLoaded', () => {
  loadStaffHistory();
});
