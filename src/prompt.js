// ===== Scene Captured — prompt.js =====
// ประกอบ prompt ส่งให้ LLM + แปลงผลลัพธ์กลับเป็น ScenePrompt
// deps: getContext() เท่านั้น (ผ่าน import ตรง ไม่พึ่ง index.js) — ห้าม import จาก index.js

import { getContext } from "../../../../extensions.js";

/**
 * @typedef {Object} SceneCharacter
 * @property {string} name
 * @property {string} prompt
 * @property {string} uc
 * @property {boolean} enabled
 * @property {number} x  ตำแหน่งแนวนอน 0-1 (ใช้ตอนแยกตัวละครจริงในเฟส 4)
 * @property {number} y  ตำแหน่งแนวตั้ง 0-1
 */
/**
 * @typedef {Object} ScenePrompt
 * @property {string} base
 * @property {string} negative
 * @property {SceneCharacter[]} characters
 */

// ตัดส่วน reasoning/thinking ทิ้งก่อน parse (โมเดลบางตัวใส่ <think>...</think> มาด้วย)
export function stripReasoning(raw) {
    let s = String(raw || "");
    try {
        const r = getContext().powerUserSettings && getContext().powerUserSettings.reasoning;
        if (r && r.prefix && r.suffix) {
            const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            s = s.replace(new RegExp(`${esc(r.prefix)}[\\s\\S]*?${esc(r.suffix)}`, "g"), "");
            const pi = s.indexOf(r.prefix);
            if (pi !== -1 && s.indexOf(r.suffix, pi) === -1) s = s.slice(0, pi);
        }
    } catch (e) {
        // ไม่มี config เรื่อง reasoning ก็ข้ามไปใช้ fallback ด้านล่างได้เลย
    }
    s = s.replace(/<(think|thinking|reason|reasoning)>[\s\S]*?<\/\1>/gi, "");
    s = s.replace(/<(think|thinking|reason|reasoning)>[\s\S]*$/i, "");
    return s.trim();
}

// ประกอบ messages สำหรับส่งให้ LLM จากข้อความฉากที่เลือกมา
export function buildSceneMessages(sceneText, systemPrompt, contextPreamble = "") {
    const preamble = String(contextPreamble || "").trim();
    const user =
        (preamble ? `${preamble}\n\n` : "") +
        `ข้อความฉากที่เลือกมา:\n"""\n${String(sceneText || "").trim()}\n"""\n\nเขียน prompt ตามกติกาที่กำหนด ตอบเป็น JSON เท่านั้น`;
    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
    ];
}

function emptyScenePrompt() {
    return { base: "", negative: "", characters: [] };
}

function normalizeCharacter(raw, index) {
    return {
        name: String(raw?.name ?? `ตัวละคร ${index + 1}`).trim() || `ตัวละคร ${index + 1}`,
        prompt: String(raw?.prompt ?? "").trim(),
        uc: String(raw?.uc ?? raw?.negative ?? "").trim(),
        enabled: raw?.enabled !== false,
        x: Number.isFinite(raw?.x) ? raw.x : 0.5,
        y: Number.isFinite(raw?.y) ? raw.y : 0.5,
    };
}

// เติมฟิลด์ที่ขาด + type-guard ให้ครบ ไม่ว่า parser ชั้นไหนจะได้ผลลัพธ์มา
export function normalizeScenePrompt(obj) {
    if (!obj || typeof obj !== "object") return emptyScenePrompt();
    const characters = Array.isArray(obj.characters) ? obj.characters.map(normalizeCharacter) : [];
    return {
        base: String(obj.base ?? "").trim(),
        negative: String(obj.negative ?? "").trim(),
        characters,
    };
}

// ดึงก้อน {...} แรกที่สมดุลออกจากข้อความ (เผื่อ LLM ใส่ข้อความอื่นแวดล้อม JSON)
function extractFirstJsonBlock(text) {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

// รูปแบบสำรอง (บรรทัดข้อความ) เผื่อ LLM ไม่ยอมตอบ JSON:
// BASE: ...
// NEGATIVE: ...
// CHAR ชื่อ: prompt | UC: uc
function parseLineFormat(text) {
    const lines = text.split(/\r?\n/);
    const result = emptyScenePrompt();
    let matchedAny = false;
    for (const line of lines) {
        const baseMatch = line.match(/^\s*BASE\s*[:：]\s*(.+)$/i);
        const negMatch = line.match(/^\s*NEGATIVE\s*[:：]\s*(.+)$/i);
        const charMatch = line.match(/^\s*CHAR(?:ACTER)?\s+(.+?)\s*[:：]\s*(.+)$/i);
        if (baseMatch) {
            result.base = baseMatch[1].trim();
            matchedAny = true;
        } else if (negMatch) {
            result.negative = negMatch[1].trim();
            matchedAny = true;
        } else if (charMatch) {
            const [, name, rest] = charMatch;
            const ucSplit = rest.split(/\|\s*UC\s*[:：]/i);
            result.characters.push(normalizeCharacter({
                name: name.trim(),
                prompt: ucSplit[0].trim(),
                uc: (ucSplit[1] || "").trim(),
            }, result.characters.length));
            matchedAny = true;
        }
    }
    return matchedAny ? result : null;
}

/**
 * parser ทนทาน 3 ชั้น — ห้าม throw ทิ้งเด็ดขาด (เสีย token การเจนไปแล้ว)
 * ชั้น 1: JSON ตรง ๆ
 * ชั้น 2: ดึงก้อน {...} แรกออกมาแล้ว JSON.parse
 * ชั้น 3: รูปแบบบรรทัด BASE:/CHAR:
 * fallback: เอาข้อความดิบทั้งหมดใส่ base ให้ผู้ใช้แก้เอง
 * @param {string} raw
 * @returns {ScenePrompt}
 */
export function parseScenePrompt(raw) {
    const text = stripReasoning(raw);
    if (!text) return emptyScenePrompt();

    // ชั้น 1
    try {
        return normalizeScenePrompt(JSON.parse(text));
    } catch (e) {
        // ไม่ใช่ JSON ล้วน ๆ — ไปลองชั้นถัดไป
    }

    // ชั้น 2
    const block = extractFirstJsonBlock(text);
    if (block) {
        try {
            return normalizeScenePrompt(JSON.parse(block));
        } catch (e) {
            // ก้อน {...} ที่เจอไม่ใช่ JSON ที่ถูกต้อง — ไปลองชั้นถัดไป
        }
    }

    // ชั้น 3
    const lineResult = parseLineFormat(text);
    if (lineResult) return lineResult;

    // fallback — ไม่ throw ทิ้ง ให้ผู้ใช้แก้เองในหน้าต่างแก้ prompt
    console.warn("[scene-captured] parseScenePrompt: parse ไม่สำเร็จทั้ง 3 ชั้น ใช้ raw text แทน", raw);
    return { base: text.trim(), negative: "", characters: [] };
}

// ===== เฟส 5: โหมดอัตโนมัติ — ให้ AI เลือกข้อความเองจากรายการล่าสุด =====

// ประกอบ messages ให้ AI เลือกข้อความ (ระบุ mesId) จากรายการที่มีเลขกำกับ แล้วเขียน prompt ให้เลย
// สำหรับ "เจนรูปด่วน" — ไม่มีข้อความฉากจากแชทมาให้ ผู้ใช้ระบุโจทย์เองหรืออ้างอิงตัวละคร/persona ตรง ๆ
export function buildPortraitMessages(briefText, systemPrompt, contextPreamble = "") {
    const preamble = String(contextPreamble || "").trim();
    const user =
        (preamble ? `${preamble}\n\n` : "") +
        `นี่ไม่ใช่ฉากจากบทสนทนา แต่เป็นโจทย์ให้วาดภาพโดยตรง:\n"""\n${String(briefText || "").trim()}\n"""\n\n` +
        `เขียน prompt ตามกติกาที่กำหนด (เน้นภาพเดี่ยว ไม่ต้องเดาใส่ฉาก/สถานการณ์เพิ่มเองถ้าโจทย์ไม่ได้ระบุ) ตอบเป็น JSON เท่านั้น`;
    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
    ];
}

export function buildAutoSceneMessages(candidatesText, systemPrompt, contextPreamble = "") {
    const preamble = String(contextPreamble || "").trim();
    const autoSystem = `${systemPrompt}\n\nโหมดนี้ต้องเลือกข้อความเองจากรายการที่ให้มาด้วย ตอบ JSON ที่มีคีย์ "mesId" (ตัวเลข) ระบุหมายเลขข้อความที่เลือกเพิ่มจากปกติ:\n{"mesId": 0, "base": "...", "negative": "", "characters": [...]}`;
    const user =
        (preamble ? `${preamble}\n\n` : "") +
        `ข้อความล่าสุดในแชท (มีหมายเลขกำกับแต่ละบรรทัด — ใช้เลขนี้ตอบกลับ):\n"""\n${candidatesText}\n"""\n\nเลือกข้อความที่เห็นภาพชัดที่สุด 1 ข้อความ แล้วเขียน prompt ให้ตามกติกา`;
    return [
        { role: "system", content: autoSystem },
        { role: "user", content: user },
    ];
}

// parse ผลลัพธ์โหมดอัตโนมัติ — ต้องมี mesId ที่เป็นตัวเลขด้วยถึงจะถือว่าใช้ได้ (ห้าม throw ทิ้งเหมือนกัน คืน null แทน)
export function parseAutoScenePrompt(raw) {
    const text = stripReasoning(raw);
    if (!text) return null;

    let obj = null;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        // ลองดึงก้อน {...} แรกแทน
    }
    if (!obj) {
        const block = extractFirstJsonBlock(text);
        if (block) {
            try {
                obj = JSON.parse(block);
            } catch (e) {
                // parse ไม่ได้จริง ๆ — ปล่อยให้ตกไป return null ด้านล่าง (โหมดอัตโนมัติไม่มี fallback แบบ manual เพราะไม่รู้จะถามผู้ใช้ยังไงตอนไม่มีคนอยู่หน้าจอ)
            }
        }
    }
    if (!obj) return null;

    const mesId = Number(obj.mesId);
    if (!Number.isFinite(mesId)) return null;

    return { mesId, scenePrompt: normalizeScenePrompt(obj) };
}

// รวม prefix + base + ตัวละครที่เปิดใช้งาน เป็น prompt เดียว (ใช้กับ backend ที่ไม่รองรับแยกตัวละคร)
// ตัดจุลภาค/ช่องว่างท้ายออกก่อนต่อกัน กัน ", ," ซ้ำเวลา prefix ผู้ใช้เผลอใส่จุลภาคท้ายมาเอง (เช่น "masterpiece, best quality, ")
function trimTrailingComma(s) {
    return String(s || "").trim().replace(/,\s*$/, "");
}

export function flattenScenePrompt(scenePrompt, prefix) {
    const parts = [trimTrailingComma(prefix), trimTrailingComma(scenePrompt.base)];
    for (const ch of scenePrompt.characters || []) {
        if (ch.enabled && ch.prompt) parts.push(trimTrailingComma(ch.prompt));
    }
    return parts.filter(Boolean).join(", ");
}
