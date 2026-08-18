// ===== Scene Captured — ui.js =====
// สร้าง/อ่านค่า DOM ของหน้าต่างแก้ prompt + ปุ่มลอยตอนเลือกข้อความ
// deps: ไม่มี (pure DOM builder) — ห้าม import จาก index.js

let charRowUidCounter = 0;

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ตาราง 5x5 เลือกตำแหน่งตัวละคร (แปลงเป็น center x/y แบบ normalize 0-1) — ใช้กับ backend ที่รองรับ use_coords เท่านั้น
function buildPositionGridHtml(x, y) {
    let cells = "";
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const cx = (col + 0.5) / 5;
            const cy = (row + 0.5) / 5;
            const selected = Math.abs(cx - x) < 0.11 && Math.abs(cy - y) < 0.11;
            cells += `<div class="scap-char-grid-cell${selected ? " scap-grid-selected" : ""}" data-x="${cx.toFixed(2)}" data-y="${cy.toFixed(2)}"></div>`;
        }
    }
    return `
        <div class="scap-char-grid-label">ตำแหน่ง (สำหรับ backend ที่รองรับ use_coords)</div>
        <div class="scap-char-grid">${cells}</div>`;
}

function buildCharacterRowHtml(ch, uid) {
    const x = Number.isFinite(ch.x) ? ch.x : 0.5;
    const y = Number.isFinite(ch.y) ? ch.y : 0.5;
    return `
    <div class="scap-char-row" data-uid="${uid}" data-x="${x}" data-y="${y}">
        <div class="scap-char-row-head">
            <input type="text" class="scap-char-name text_pole" value="${escapeHtml(ch.name)}" placeholder="ชื่อตัวละคร" />
            <label class="checkbox_label scap-char-enabled-label">
                <input type="checkbox" class="scap-char-enabled" ${ch.enabled ? "checked" : ""} />
                <span>ใช้</span>
            </label>
            <div class="scap-char-up menu_button menu_button_icon interactable" title="เลื่อนขึ้น"><i class="fa-solid fa-arrow-up"></i></div>
            <div class="scap-char-down menu_button menu_button_icon interactable" title="เลื่อนลง"><i class="fa-solid fa-arrow-down"></i></div>
            <div class="scap-char-remove menu_button menu_button_icon interactable" title="ลบตัวละครนี้"><i class="fa-solid fa-trash-can"></i></div>
        </div>
        <textarea class="scap-char-prompt text_pole" rows="2" placeholder="prompt ของตัวละครนี้ (เช่น 1girl, blonde hair, red dress)">${escapeHtml(ch.prompt)}</textarea>
        <textarea class="scap-char-uc text_pole" rows="1" placeholder="UC เฉพาะตัวละครนี้ (ไม่บังคับ)">${escapeHtml(ch.uc)}</textarea>
        ${buildPositionGridHtml(x, y)}
    </div>`;
}

// สร้างหน้าต่างแก้ prompt เป็น jQuery element ที่ยังคงอ้างอิงได้หลัง popup ปิด
// (ต้องส่ง element/jQuery object ให้ callGenericPopup ไม่ใช่ string ถึงจะอ่านค่ากลับได้)
export function buildPromptEditor(scenePrompt, prefixText) {
    const $container = $(`
    <div class="scap-editor">
        <div class="scap-editor-prefix">
            <span class="scap-editor-prefix-label">Prefix (แทรกอัตโนมัติ):</span>
            <span class="scap-editor-prefix-chip">${escapeHtml(prefixText) || "(ว่าง)"}</span>
        </div>

        <label>Base prompt (ภาพรวมของฉาก)</label>
        <textarea class="scap-editor-base text_pole" rows="3"></textarea>

        <label>Negative prompt (เว้นว่าง = ใช้ค่าเริ่มต้นจากหน้าตั้งค่า)</label>
        <textarea class="scap-editor-negative text_pole" rows="2"></textarea>

        <div class="scap-editor-chars-head">
            <b>ตัวละครแยก (สำหรับ backend ที่รองรับ)</b>
            <div class="scap-editor-add-char menu_button menu_button_icon interactable">
                <i class="fa-solid fa-plus"></i><span>เพิ่มตัวละคร</span>
            </div>
        </div>
        <div class="scap-editor-characters"></div>
    </div>`);

    $container.find(".scap-editor-base").val(scenePrompt.base || "");
    $container.find(".scap-editor-negative").val(scenePrompt.negative || "");

    const $charsWrap = $container.find(".scap-editor-characters");
    for (const ch of scenePrompt.characters || []) {
        $charsWrap.append(buildCharacterRowHtml(ch, charRowUidCounter++));
    }

    // จัดการปุ่มทั้งหมดในหน้าต่างนี้ด้วย delegated handler ผูกกับ container เอง
    // (ไม่ผูกกับ document เพราะ popup นี้เปิด-ปิดได้หลายรอบ ผูกกับ document จะเพิ่ม handler ซ้ำเรื่อย ๆ)
    $container.on("click", ".scap-editor-add-char", function () {
        $charsWrap.append(buildCharacterRowHtml({ name: "", prompt: "", uc: "", enabled: true }, charRowUidCounter++));
    });

    $container.on("click", ".scap-char-remove", function () {
        $(this).closest(".scap-char-row").remove();
    });

    $container.on("click", ".scap-char-up", function () {
        const $row = $(this).closest(".scap-char-row");
        const $prev = $row.prev(".scap-char-row");
        if ($prev.length) $row.insertBefore($prev);
    });

    $container.on("click", ".scap-char-down", function () {
        const $row = $(this).closest(".scap-char-row");
        const $next = $row.next(".scap-char-row");
        if ($next.length) $row.insertAfter($next);
    });

    $container.on("click", ".scap-char-grid-cell", function () {
        const $cell = $(this);
        const $row = $cell.closest(".scap-char-row");
        $row.attr("data-x", $cell.data("x")).attr("data-y", $cell.data("y"));
        $row.find(".scap-char-grid-cell").removeClass("scap-grid-selected");
        $cell.addClass("scap-grid-selected");
    });

    return $container;
}

// อ่านค่ากลับจาก DOM ของหน้าต่างแก้ prompt เป็น ScenePrompt
export function readPromptEditor($container) {
    const characters = [];
    $container.find(".scap-char-row").each(function () {
        const $row = $(this);
        const x = parseFloat($row.attr("data-x"));
        const y = parseFloat($row.attr("data-y"));
        characters.push({
            name: $row.find(".scap-char-name").val().trim() || "ตัวละคร",
            prompt: $row.find(".scap-char-prompt").val().trim(),
            uc: $row.find(".scap-char-uc").val().trim(),
            enabled: Boolean($row.find(".scap-char-enabled").prop("checked")),
            x: Number.isFinite(x) ? x : 0.5,
            y: Number.isFinite(y) ? y : 0.5,
        });
    });
    return {
        base: $container.find(".scap-editor-base").val().trim(),
        negative: $container.find(".scap-editor-negative").val().trim(),
        characters,
    };
}

// ปุ่มลอยที่โผล่ตอนลากเลือกข้อความในแชท
export function buildFloatingCaptureButton() {
    return $(`
    <div id="scap-float-btn" class="scap-float-btn menu_button interactable" title="จับซีนนี้ด้วย Scene Captured">
        <i class="fa-solid fa-camera"></i>
        <span>จับซีนนี้</span>
    </div>`);
}
