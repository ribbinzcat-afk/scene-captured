// ===== Scene Captured — context.js =====
// ดึงข้อมูล character card / persona / World Info มาช่วย AI เขียน prompt ให้ตรงตัวละครมากขึ้น
// ท่าเดียวกับ buildContextPreamble() ของ tinyfeed (proven ใช้งานจริงแล้ว) — ตัดส่วนระบบ alias/profile ของ TinyPhone ออกเพราะไม่เกี่ยวกับ extension นี้
// deps: getContext() เท่านั้น — ห้าม import จาก index.js

import { getContext } from "../../../../extensions.js";

function htmlToPlain(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
    return (d.textContent || "").trim();
}

function getPersonaDescription() {
    try {
        const ctx = getContext();
        const pu = ctx.powerUserSettings || {};
        if (pu.persona_description) return String(pu.persona_description);
        const file = ctx.user_avatar;
        const byAvatar = pu.persona_descriptions && file ? pu.persona_descriptions[file] : null;
        return byAvatar && byAvatar.description ? String(byAvatar.description) : "";
    } catch (e) {
        return "";
    }
}

/**
 * ประกอบข้อมูลอ้างอิง (character card / persona / world info) เป็น string เดียว สำหรับแปะไว้ก่อน prompt ที่ส่งให้ AI เขียน image prompt
 * ทำงานได้แม้ไม่มีตัวละคร/แชท (คืน "" เฉย ๆ) — ไม่ throw ทิ้งเด็ดขาด เพราะแค่เป็นข้อมูลเสริม ไม่ใช่ตัวหลัก
 * @param {{includeCharacterCard?: boolean, includePersona?: boolean, includeWorldInfo?: boolean, worldInfoLimit?: number}} opts
 * @returns {Promise<string>}
 */
export async function buildCharacterContext(opts = {}) {
    try {
        const ctx = getContext();
        const sections = [];
        const push = (title, body) => {
            const b = String(body == null ? "" : body).trim();
            if (b) sections.push(`[${title}]\n${b}`);
        };

        const chId = ctx.characterId;
        const card = chId != null && ctx.characters ? ctx.characters[chId] : null;

        if (opts.includeCharacterCard !== false && card) {
            const lines = [`ชื่อ: ${card.name || ctx.name2 || ""}`];
            if (card.description) lines.push(`คำอธิบาย:\n${htmlToPlain(card.description)}`);
            if (card.personality) lines.push(`บุคลิก:\n${htmlToPlain(card.personality)}`);
            if (card.scenario) lines.push(`ฉาก:\n${htmlToPlain(card.scenario)}`);
            push("ตัวละครหลัก", lines.join("\n"));
        }

        let personaDesc = "";
        if (opts.includePersona !== false) {
            personaDesc = getPersonaDescription();
            if (ctx.name1 || personaDesc) {
                push("ผู้ใช้ (Persona)", `ชื่อ: ${ctx.name1 || ""}` + (personaDesc ? `\nคำอธิบาย:\n${htmlToPlain(personaDesc)}` : ""));
            }
        }

        if (opts.includeWorldInfo !== false) {
            try {
                if (typeof ctx.getWorldInfoPrompt === "function" && Array.isArray(ctx.chat) && ctx.chat.length) {
                    // ⚠️ ST ต้องการ chat เป็น array ของ string "ชื่อ: ข้อความ" และเรียงใหม่→เก่า (reverse) — พลาดจุดนี้แล้ว World Info จะ scan context ผิดตำแหน่ง
                    const chatForWI = ctx.chat.map((m) => `${m.name}: ${m.mes}`).reverse();
                    const scanData = {
                        personaDescription: personaDesc || "",
                        characterDescription: (card && card.description) || "",
                        characterPersonality: (card && card.personality) || "",
                        characterDepthPrompt: "",
                        scenario: (card && card.scenario) || "",
                        creatorNotes: (card && card.creator_notes) || "",
                        trigger: "normal",
                    };
                    const wi = (await ctx.getWorldInfoPrompt(chatForWI, ctx.maxContext || 4096, true, scanData)) || {};
                    const wiParts = [];
                    const add = (label, val) => {
                        const t = String(val || "").trim();
                        if (t) wiParts.push(`— ${label} —\n${htmlToPlain(t)}`);
                    };
                    add("ก่อนคำอธิบายตัวละคร", wi.worldInfoBefore);
                    add("หลังคำอธิบายตัวละคร", wi.worldInfoAfter);
                    if (Array.isArray(wi.anBefore) && wi.anBefore.length) add("ก่อน Author's Note", wi.anBefore.join("\n"));
                    if (Array.isArray(wi.anAfter) && wi.anAfter.length) add("หลัง Author's Note", wi.anAfter.join("\n"));
                    if (Array.isArray(wi.worldInfoDepth) && wi.worldInfoDepth.length) {
                        const d = wi.worldInfoDepth.map((x) => `(depth ${x.depth}) ${(x.entries || []).join(" | ")}`).join("\n");
                        add("แทรกในบทสนทนา", d);
                    }
                    if (Array.isArray(wi.worldInfoExamples) && wi.worldInfoExamples.length) {
                        add(
                            "ตัวอย่างบทสนทนา",
                            wi.worldInfoExamples.map((e) => (typeof e === "string" ? e : (e && e.content) || "")).join("\n"),
                        );
                    }
                    let wiStr = wiParts.join("\n\n").trim();
                    const limit = Number.isFinite(opts.worldInfoLimit) ? opts.worldInfoLimit : 0;
                    if (wiStr && limit > 0 && wiStr.length > limit) wiStr = wiStr.slice(0, limit) + "…";
                    push("World Info", wiStr);
                }
            } catch (e) {
                console.warn("[scene-captured] ดึง World Info ไม่สำเร็จ:", e);
            }
        }

        if (!sections.length) return "";
        return `=== ข้อมูลตัวละคร/บริบทเรื่อง (อ้างอิงประกอบการเขียน prompt เท่านั้น) ===\n\n${sections.join("\n\n")}\n\n=== จบข้อมูลอ้างอิง ===`;
    } catch (e) {
        console.warn("[scene-captured] buildCharacterContext ล้มเหลว:", e);
        return "";
    }
}
