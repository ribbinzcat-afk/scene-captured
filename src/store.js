// ===== Scene Captured — store.js =====
// เก็บชื่อ extension / ค่าเริ่มต้น / getter-setter สำหรับ extension_settings
// กติกา: ห้าม import จาก index.js (จะเกิด circular) — ไฟล์นี้ deps = 0
// path ลึกกว่า index.js 1 ชั้น เพราะอยู่ใน src/

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";

export const extensionName = "scene-captured";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// เทมเพลต system prompt เริ่มต้น — สั่งให้ AI ตอบเป็น JSON ที่ parser ของเรารองรับ
export const DEFAULT_CUSTOM_TEMPLATE = `{
  "model": "{{model}}",
  "prompt": "{{prompt}}",
  "negative_prompt": "{{negative}}",
  "width": {{width}},
  "height": {{height}},
  "seed": {{seed}},
  "characters": {{characters_json}}
}`;

export const DEFAULT_SYSTEM_PROMPT =
`คุณคือผู้ช่วยเขียน prompt สำหรับโมเดลสร้างภาพแนว NovelAI/Danbooru-tag
จากข้อความฉากที่ผู้ใช้เลือกมา ให้คุณเขียน prompt บรรยายภาพนั้นออกมา

กติกา:
- ใช้ tag แบบ Danbooru คั่นด้วยจุลภาค (เช่น "1girl, blonde hair, blue eyes, indoors, night")
- ถ้าในฉากมีตัวละครมากกว่า 1 คนที่ควรแยกวาด ให้แยก prompt ของแต่ละตัวออกจากกัน
- "base" คือส่วนที่เป็นภาพรวม (ฉาก/บรรยากาศ/มุมกล้อง/จำนวนคนในภาพ) ไม่ต้องใส่ลักษณะเฉพาะของตัวละครแต่ละคนซ้ำใน base
- ⚠️ ถ้า "characters" มีมากกว่า 1 คน ห้ามใส่ "solo" ใน base เด็ดขาด (ขัดกับการแยกตัวละครของ NovelAI ทำให้เจนออกมาเหลือคนเดียว) และให้ระบุจำนวน/เพศคนในภาพให้ตรงจริง เช่น "2characters, 1girl, 1boy" แทน "1girl, solo"
- "uc" ของแต่ละตัวละคร (ถ้ามี) คือสิ่งที่ไม่ต้องการให้ปรากฏเฉพาะตัวละครนั้น ปล่อยว่างได้ถ้าไม่มี
- ⚠️ "negative" ของภาพรวม ใส่เฉพาะสิ่งที่ต้องเลี่ยง**เฉพาะฉากนี้**เท่านั้น (เช่น ไม่ต้องการให้มีฝนในภาพทั้งที่ฉากอาจสื่อถึงฝน) ห้ามใส่ negative ทั่วไปซ้ำ เช่น "lowres, bad anatomy, bad hands, worst quality, blurry, watermark" ฯลฯ — ค่าพวกนี้ระบบมีตั้งไว้ให้อยู่แล้วจากหน้าตั้งค่าเสมอ ไม่ต้องเขียนซ้ำ ปล่อยเป็น "" ได้ถ้าฉากนี้ไม่มีอะไรต้องเลี่ยงเป็นพิเศษ
- ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกก้อน JSON ห้ามใช้ code fence

รูปแบบ JSON ที่ต้องตอบ:
{"base": "...", "negative": "", "characters": [{"name": "...", "prompt": "...", "uc": ""}]}

ถ้าฉากมีตัวละครเดียวหรือไม่ต้องแยก ให้ "characters" เป็น array ว่าง [] แล้วใส่ลักษณะตัวละครลงใน "base" แทน`;

export const defaultSettings = {
    // ตั้งค่าทั่วไป
    apiProfile: "",              // "" = ใช้ generateRaw (API หลักของ ST)
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    responseLength: 500,

    // ข้อมูลอ้างอิงที่ส่งไปช่วย AI เขียน prompt ให้ตรงตัวละคร (นอกเหนือจากข้อความที่เลือก)
    includeCharacterCard: true,
    includePersona: true,
    includeWorldInfo: true,
    worldInfoLimit: 1500,   // ตัวอักษร — กันบานถ้า lorebook มีเยอะ (0 = ไม่จำกัด)

    // ช่องที่ผู้ใช้ตั้งเอง
    prefix: "masterpiece, best quality, ",
    negativePrompt: "lowres, bad anatomy, bad hands, worst quality",

    // ขนาดภาพ
    width: 832,
    height: 1216,
    resolutionPreset: "832x1216",

    // พารามิเตอร์ NovelAI
    model: "nai-diffusion-5-full",  // ⚠️ ชื่อ ID นี้เดาจากรูปแบบการตั้งชื่อของ NovelAI เอง ยังไม่ยืนยัน 100% กับ API จริง — ดูหมายเหตุในหน้าตั้งค่า
    sampler: "k_euler_ancestral",
    scheduler: "karras",
    steps: 28,
    scale: 5,
    seed: -1,
    smea: false,
    smeaDyn: false,
    decrisper: false,
    varietyBoost: false,
    upscaleRatio: 1,

    // เลือก backend image gen
    backend: "nai-st",           // nai-st | nai-direct | st-imagine | custom
    naiToken: "",                // ใช้เฉพาะ nai-direct — เก็บ plaintext ใน settings.json
    naiUseCorsProxy: true,
    naiUseCoords: false,      // เปิด = ส่งตำแหน่งตัวละคร (center x/y) ไปด้วย

    customUrl: "",
    customMethod: "POST",
    customHeaders: "{\"Content-Type\": \"application/json\"}",
    customBodyTemplate: DEFAULT_CUSTOM_TEMPLATE,
    customImagePath: "",
    customUseCorsProxy: false,
    customApiKey: "",             // แทรกเป็น header ให้อัตโนมัติ (ไม่ต้องเขียนเองใน Headers JSON)
    customApiKeyHeader: "Authorization",
    customApiKeyPrefix: "Bearer ",
    customModel: "",              // ใช้แทนใน {{model}} ของ Body Template
    customModelsUrl: "",          // endpoint GET สำหรับดึงรายชื่อโมเดล (ไม่บังคับ)
    customModelsPath: "",         // path ของ array รายชื่อโมเดลใน response

    // การแทรกรูป
    imagePosition: "below",      // below | above
    imageAttachMode: "gallery",  // gallery = extra.media (ปุ่ม swipe ในตัว ของ ST) | display-only = ฝังใน extra.display_text (ไม่ถูกส่งเข้า context เลย)
    autoSendToImageGen: false,   // true = ข้ามหน้าแก้ prompt แล้วเจนภาพทันที

    // อัตโนมัติทุก n ข้อความ
    autoEnabled: false,
    autoInterval: 10,
    autoMode: "manual",          // manual = แจ้งเตือน, full = เจนภาพให้เลย
    autoLookback: 6,
    autoMinChars: 40,
};

// อ่านค่า settings แบบมี fallback ไปที่ defaultSettings — เพิ่มคีย์ใหม่ทีหลังไม่ต้อง migrate
export function getSetting(key) {
    const s = extension_settings[extensionName] || {};
    return s[key] !== undefined ? s[key] : defaultSettings[key];
}

export function setSetting(key, value) {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

// สร้าง/เติม extension_settings[extensionName] ให้ครบทุกคีย์ (เรียกตอนโหลด)
export function loadSettings() {
    if (!extension_settings[extensionName] || typeof extension_settings[extensionName] !== "object") {
        extension_settings[extensionName] = {};
    }
    const s = extension_settings[extensionName];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(s, key)) {
            s[key] = typeof value === "object" && value !== null ? structuredClone(value) : value;
        }
    }
    return s;
}
