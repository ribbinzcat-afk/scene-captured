// ===== Scene Captured — backends.js =====
// รวม backend สำหรับส่งต่อ image gen — ทุกตัวหน้าตาเดียวกัน: generate(ctx, scenePrompt, params, signal) -> {format,data} หรือ {url}
// deps: prompt.js เท่านั้น — ห้าม import จาก index.js

import { flattenScenePrompt, mergeNegative } from "./prompt.js";

// escape ค่าที่จะฝังลง STscript (/imagine ...) กัน quote/backslash ทำให้ parser คำสั่งพัง
function escapeSlashArg(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSlashNamedArgs(argsObj) {
    return Object.entries(argsObj)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}="${escapeSlashArg(v)}"`)
        .join(" ");
}

// รุ่นที่ไม่รองรับ/ไม่จำเป็นต้องใช้ SMEA — ท่าเดียวกับ getNovelParams() ของ ST เอง (stable-diffusion/index.js)
// ขยายเพิ่ม V5 เองเพราะยังไม่มีในซอร์ส ST (ใหม่กว่า) แต่แนวโน้มเดียวกับที่ NovelAI บอกไว้ตอนเลิกใช้ SMEA กับรุ่นความละเอียดสูงขึ้น
const SMEA_UNSUPPORTED_MODELS = ["nai-diffusion-4-curated-preview", "nai-diffusion-4-full", "nai-diffusion-5-full", "nai-diffusion-5-curated"];

function getEffectiveSmea(params) {
    if (params.sampler === "ddim" || SMEA_UNSUPPORTED_MODELS.includes(params.model)) {
        return { sm: false, sm_dyn: false };
    }
    return { sm: Boolean(params.smea), sm_dyn: Boolean(params.smeaDyn) };
}

// ===== nai-st: ยิงผ่าน endpoint ของ ST เอง (/api/novelai/generate-image) =====
// จำกัด: ST ตัด characterPrompts/char_captions ทิ้งฝั่ง server (ดูแผนงาน) — รวม prompt ตัวละครเข้า base ให้หมด
async function generateViaNaiSt(ctx, scenePrompt, params, signal) {
    const prompt = flattenScenePrompt(scenePrompt, params.prefix);
    const negative = mergeNegative(params.negativePrompt, scenePrompt.negative);
    const { sm, sm_dyn } = getEffectiveSmea(params);

    const response = await fetch("/api/novelai/generate-image", {
        method: "POST",
        headers: ctx.getRequestHeaders(),
        signal,
        body: JSON.stringify({
            prompt,
            negative_prompt: negative,
            model: params.model,
            sampler: params.sampler,
            scheduler: params.scheduler,
            steps: params.steps,
            scale: params.scale,
            width: params.width,
            height: params.height,
            upscale_ratio: params.upscaleRatio,
            decrisper: params.decrisper,
            variety_boost: params.varietyBoost,
            sm,
            sm_dyn,
            seed: params.seed,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `NovelAI ตอบกลับ HTTP ${response.status}`);
    }

    const data = await response.text(); // /api/novelai/generate-image คืน base64 ดิบ ไม่ใช่ JSON
    return { format: "png", data };
}

// ===== st-imagine: ยืมระบบ Image Generation ของ ST เอง ผ่าน /imagine =====
// ไม่ผูกกับ NAI โดยเฉพาะ — ไม่ส่ง model/sampler/steps/scale เพราะค่าพวกนี้ตรงกับ NAI เท่านั้น
// ถ้า backend อื่นที่ตั้งไว้ใน ST ไม่รู้จักชื่อ enum พวกนี้จะ error ทันที ปล่อยให้ ST ใช้ค่าที่ตั้งไว้เองดีกว่า
async function generateViaStImagine(ctx, scenePrompt, params, signal) {
    if (typeof ctx.executeSlashCommandsWithOptions !== "function") {
        throw new Error("เวอร์ชัน SillyTavern นี้ไม่มี executeSlashCommandsWithOptions");
    }
    const prompt = flattenScenePrompt(scenePrompt, params.prefix);
    const negative = mergeNegative(params.negativePrompt, scenePrompt.negative);

    const namedArgs = buildSlashNamedArgs({
        quiet: "true",
        gallery: "false",
        negative,
        width: params.width,
        height: params.height,
        seed: Number.isFinite(params.seed) && params.seed >= 0 ? params.seed : undefined,
    });
    const cmd = `/imagine ${namedArgs} "${escapeSlashArg(prompt)}"`;

    // หมายเหตุ: executeSlashCommandsWithOptions รับ abortController เป็น SlashCommandAbortController ของ ST เอง
    // (ไม่ใช่ AbortController มาตรฐานที่เราสร้าง) จึงไม่ผูก signal เข้าไปตรง ๆ — ยกเลิกจาก UI ของ ST เองแทน
    const result = await ctx.executeSlashCommandsWithOptions(cmd, { handleParserErrors: true });
    if (result?.isError) {
        throw new Error(result?.errorMessage || "รันคำสั่ง /imagine ล้มเหลว");
    }
    const url = typeof result?.pipe === "string" ? result.pipe.trim() : "";
    if (!url) {
        throw new Error("ไม่ได้รับ URL รูปจาก /imagine (ตรวจว่าตั้ง source ของ Image Generation ใน ST ไว้แล้วหรือยัง)");
    }
    return { url };
}

// ===== nai-direct: ยิงตรงไป NovelAI ผ่าน CORS proxy ของ ST — รองรับแยก prompt ตัวละครจริง =====
// ⚠️ shape ของ characterPrompts / v4_prompt.caption.char_captions อ้างอิงจากเอกสาร NAI ภายนอก
// ST เองเขียนค่าพวกนี้เป็น [] ตายตัวเสมอ (ดู src/endpoints/novelai.js:356-374) ไม่มีตัวอย่างให้ยืนยัน shape จากซอร์ส ST
// ถ้า NAI ตอบ 400 ให้ดู error message ใน response แล้วปรับ shape ตามนั้น

const REFERENCE_PIXEL_COUNT = 1011712; // 832 * 1216 — ขนาดภาพอ้างอิงของ NAI (จาก src/endpoints/novelai.js)
const SIGMA_MAGIC_NUMBER = 19;
const SIGMA_MAGIC_NUMBER_V4_5 = 58;

// พอร์ตมาจาก calculateSkipCfgAboveSigma() ใน src/endpoints/novelai.js (สูตรเดียวกับที่ ST ใช้คำนวณ Variety+)
function calculateSkipCfgAboveSigma(width, height, modelName) {
    const magicConstant = modelName?.includes("nai-diffusion-4-5") ? SIGMA_MAGIC_NUMBER_V4_5 : SIGMA_MAGIC_NUMBER;
    const pixelCount = width * height;
    const ratio = pixelCount / REFERENCE_PIXEL_COUNT;
    return Math.pow(ratio, 0.5) * magicConstant;
}

// NAI คืนผลลัพธ์เป็น zip (เหมือนตอน ST เรียกฝั่ง server) ต้องแตก zip เองฝั่งเบราว์เซอร์ด้วย JSZip
async function extractPngBase64FromZip(arrayBuffer) {
    if (typeof window.JSZip === "undefined") {
        // โหลดแบบเดียวกับที่ utils.js ใช้ (side-effect import ผูก window.JSZip ให้เอง)
        await import("../../../../../lib/jszip.min.js");
    }
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const entry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith(".png"));
    if (!entry) throw new Error("ไม่พบไฟล์ .png ใน zip ที่ NovelAI ส่งกลับมา");
    return await entry.async("base64");
}

async function generateViaNaiDirect(ctx, scenePrompt, params, signal) {
    const token = params.naiToken || "";
    if (!token) {
        throw new Error("ยังไม่ได้กรอก NovelAI Token ในหน้าตั้งค่า (โหมดนี้ไม่ได้ใช้ token ที่เซฟไว้ใน SillyTavern)");
    }

    const enabledChars = (scenePrompt.characters || []).filter((c) => c.enabled && c.prompt);
    const useCoords = Boolean(params.naiUseCoords) && enabledChars.length > 0;

    const characterPrompts = enabledChars.map((c) => ({
        prompt: c.prompt,
        uc: c.uc || "",
        center: { x: c.x, y: c.y },
        enabled: true,
    }));
    const charCaptions = enabledChars.map((c) => ({ char_caption: c.prompt, centers: [{ x: c.x, y: c.y }] }));
    const negCharCaptions = enabledChars.map((c) => ({ char_caption: c.uc || "", centers: [{ x: c.x, y: c.y }] }));

    // หมายเหตุ: โหมดนี้ "ไม่" ยุบ prompt ตัวละครเข้า base — ส่งแยกผ่าน characterPrompts/char_captions แทน
    const prompt = [params.prefix, scenePrompt.base].filter(Boolean).join(", ");
    const negative = mergeNegative(params.negativePrompt, scenePrompt.negative);
    const { sm, sm_dyn } = getEffectiveSmea(params);

    const body = {
        action: "generate",
        input: prompt,
        model: params.model,
        parameters: {
            params_version: 3,
            prefer_brownian: true,
            negative_prompt: negative,
            height: params.height,
            width: params.width,
            scale: params.scale,
            seed: Number.isFinite(params.seed) && params.seed >= 0 ? params.seed : Math.floor(Math.random() * 9999999999),
            sampler: params.sampler,
            noise_schedule: params.scheduler,
            steps: params.steps,
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: false,
            add_original_image: false,
            controlnet_strength: 1,
            deliberate_euler_ancestral_bug: false,
            dynamic_thresholding: Boolean(params.decrisper),
            legacy: false,
            legacy_v3_extend: false,
            sm,
            sm_dyn,
            uncond_scale: 1,
            skip_cfg_above_sigma: params.varietyBoost ? calculateSkipCfgAboveSigma(params.width, params.height, params.model) : null,
            use_coords: useCoords,
            characterPrompts,
            reference_image_multiple: [],
            reference_information_extracted_multiple: [],
            reference_strength_multiple: [],
            v4_negative_prompt: { caption: { base_caption: negative, char_captions: negCharCaptions } },
            v4_prompt: { caption: { base_caption: prompt, char_captions: charCaptions }, use_coords: useCoords, use_order: true },
        },
    };

    const directUrl = "https://image.novelai.net/ai/generate-image";
    const targetUrl = params.naiUseCorsProxy ? `/proxy/${directUrl}` : directUrl;

    const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        signal,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (text.includes("CORS proxy is disabled")) {
            throw new Error("CORS proxy ของ SillyTavern ยังไม่ได้เปิด — ตั้ง enableCorsProxy: true ใน config.yaml แล้วรีสตาร์ท ST");
        }
        throw new Error(text || `NovelAI ตอบกลับ HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = await extractPngBase64FromZip(arrayBuffer);
    return { format: "png", data: base64 };
}

// ทดสอบว่า token + CORS proxy ใช้ได้จริงไหม โดยไม่เจนภาพจริง (ยิง /user/subscription)
export async function testNaiDirectConnection(token, useCorsProxy) {
    const directUrl = "https://api.novelai.net/user/subscription";
    const targetUrl = useCorsProxy ? `/proxy/${directUrl}` : directUrl;
    const response = await fetch(targetUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
        if (text.includes("CORS proxy is disabled")) {
            throw new Error("CORS proxy ของ SillyTavern ยังไม่ได้เปิด — ตั้ง enableCorsProxy: true ใน config.yaml แล้วรีสตาร์ท ST");
        }
        // ยืนยันแล้ว (2026-08-19): /user/subscription ตอบ error นี้แม้ token ใช้งานได้จริง (เจนภาพจริงผ่านสำเร็จด้วย token เดียวกัน)
        // เดาว่า endpoint นี้ฝั่ง NovelAI มีปัญหา/เปลี่ยนพฤติกรรมแยกจากการเจนภาพจริง — อย่าเชื่อผลตรวจนี้ 100%
        if (text.includes("Please refresh NovelAI.net")) {
            throw new Error("NovelAI ตอบ error จาก endpoint ตรวจสอบนี้ (พบว่าบางครั้งขึ้น error นี้แม้ token ใช้งานได้จริง) — ลองกด \"จับซีนนี้\" แล้วสร้างภาพจริงดูเพื่อยืนยันอีกทางว่า token ใช้ได้หรือไม่");
        }
        throw new Error(text || `HTTP ${response.status}`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        return {};
    }
}

// ===== custom: ยิง URL ที่ผู้ใช้ตั้งเอง ด้วย body template ที่แทนค่าได้ =====

function fillCustomTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        const token = `{{${key}}}`;
        if (!result.includes(token)) continue;
        if (typeof value === "string") {
            // escape ให้เป็น JSON string content (ไม่รวม quote ครอบ) เผื่อ template ใส่ quote ครอบไว้เองแล้ว
            const escaped = JSON.stringify(value).slice(1, -1);
            result = result.split(token).join(escaped);
        } else {
            result = result.split(token).join(JSON.stringify(value));
        }
    }
    return result;
}

function resolveJsonPath(obj, path) {
    if (!path) return obj;
    return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

// รวม header มาตรฐาน + Headers (JSON) ที่ผู้ใช้ตั้งเอง + API Key (แทรก header ให้อัตโนมัติ ไม่ต้องเขียนเองใน Headers JSON)
function buildCustomHeaders(params) {
    let headers = { "Content-Type": "application/json" };
    if (params.customHeaders) {
        try {
            headers = { ...headers, ...JSON.parse(params.customHeaders) };
        } catch (e) {
            throw new Error(`Custom Headers ไม่ใช่ JSON ที่ถูกต้อง: ${e.message}`);
        }
    }
    if (params.customApiKey) {
        const headerName = params.customApiKeyHeader || "Authorization";
        const prefix = params.customApiKeyPrefix ?? "";
        headers[headerName] = `${prefix}${params.customApiKey}`;
    }
    return headers;
}

async function generateViaCustom(ctx, scenePrompt, params, signal) {
    if (!params.customUrl) {
        throw new Error("ยังไม่ได้ตั้ง Custom API URL ในหน้าตั้งค่า");
    }

    const enabledChars = (scenePrompt.characters || []).filter((c) => c.enabled && c.prompt);
    const promptText = flattenScenePrompt(scenePrompt, params.prefix);
    const vars = {
        model: params.customModel || "",
        prompt: promptText,
        negative: mergeNegative(params.negativePrompt, scenePrompt.negative),
        width: params.width,
        height: params.height,
        seed: Number.isFinite(params.seed) ? params.seed : -1,
        characters_json: JSON.stringify(enabledChars.map((c) => ({ name: c.name, prompt: c.prompt, uc: c.uc, x: c.x, y: c.y }))),
    };

    const template = (params.customBodyTemplate || "").trim();
    if (!template) throw new Error("ยังไม่ได้ตั้ง Body Template ในหน้าตั้งค่า");
    const filled = fillCustomTemplate(template, vars);

    let bodyObj;
    try {
        bodyObj = JSON.parse(filled);
    } catch (e) {
        throw new Error(`Body Template ไม่ใช่ JSON ที่ถูกต้องหลังแทนค่า: ${e.message}`);
    }

    const headers = buildCustomHeaders(params);
    const targetUrl = params.customUseCorsProxy ? `/proxy/${params.customUrl}` : params.customUrl;
    const method = (params.customMethod || "POST").toUpperCase();

    const response = await fetch(targetUrl, {
        method,
        headers,
        signal,
        body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(bodyObj),
    });

    const rawText = await response.text();
    if (!response.ok) {
        if (rawText.includes("CORS proxy is disabled")) {
            throw new Error("CORS proxy ของ SillyTavern ยังไม่ได้เปิด — ตั้ง enableCorsProxy: true ใน config.yaml แล้วรีสตาร์ท ST");
        }
        throw new Error(rawText || `Custom API ตอบกลับ HTTP ${response.status}`);
    }

    let extracted = rawText;
    try {
        const json = JSON.parse(rawText);
        extracted = params.customImagePath ? resolveJsonPath(json, params.customImagePath) : json;
    } catch (e) {
        // response ไม่ใช่ JSON — ถือว่าทั้งก้อนเป็น base64/URL ดิบ ใช้ rawText ตรง ๆ ต่อไป
    }

    if (typeof extracted !== "string" || !extracted) {
        throw new Error('ดึงรูปจาก response ไม่สำเร็จ — ตรวจ "path ของรูปใน response" ในหน้าตั้งค่า');
    }

    if (/^https?:\/\//i.test(extracted)) return { url: extracted };
    if (/^data:image\//i.test(extracted)) {
        const base64 = extracted.split(",")[1] || "";
        return { format: "png", data: base64 };
    }
    return { format: "png", data: extracted }; // สมมติว่าเป็น base64 ดิบ
}

// ดึงรายชื่อโมเดลจาก provider (GET) — ใช้ headers ชุดเดียวกับตอนเจนภาพ (รวม API Key ที่ตั้งไว้)
// คืนเป็น [{id, label}] เสมอ ไม่ว่า response จะเป็น array ของ string ล้วน หรือ array ของ object
export async function fetchCustomModels(params) {
    if (!params.customModelsUrl) {
        throw new Error("ยังไม่ได้ตั้ง URL สำหรับโหลดรายชื่อโมเดลในหน้าตั้งค่า");
    }

    const headers = buildCustomHeaders(params);
    delete headers["Content-Type"]; // เป็น GET ไม่มี body ไม่จำเป็นต้องส่ง Content-Type
    const targetUrl = params.customUseCorsProxy ? `/proxy/${params.customModelsUrl}` : params.customModelsUrl;

    const response = await fetch(targetUrl, { method: "GET", headers });
    const rawText = await response.text();
    if (!response.ok) {
        if (rawText.includes("CORS proxy is disabled")) {
            throw new Error("CORS proxy ของ SillyTavern ยังไม่ได้เปิด — ตั้ง enableCorsProxy: true ใน config.yaml แล้วรีสตาร์ท ST");
        }
        throw new Error(rawText || `HTTP ${response.status}`);
    }

    let json;
    try {
        json = JSON.parse(rawText);
    } catch (e) {
        throw new Error("response ไม่ใช่ JSON ที่ถูกต้อง");
    }

    const list = params.customModelsPath ? resolveJsonPath(json, params.customModelsPath) : json;
    if (!Array.isArray(list)) {
        throw new Error('ดึงรายชื่อโมเดลไม่สำเร็จ — ตรวจ "path ของ array รายชื่อโมเดล" ในหน้าตั้งค่า');
    }

    return list.map((item) => {
        if (typeof item === "string") return { id: item, label: item };
        const id = item?.id ?? item?.name ?? item?.model ?? JSON.stringify(item);
        const label = item?.name ?? item?.id ?? item?.model ?? String(id);
        return { id: String(id), label: String(label) };
    });
}

export const BACKENDS = {
    "nai-st": {
        id: "nai-st",
        label: "NovelAI (ผ่าน SillyTavern)",
        supportsCharacters: false,
        generate: generateViaNaiSt,
    },
    "st-imagine": {
        id: "st-imagine",
        label: "ใช้ Image Generation ของ SillyTavern",
        supportsCharacters: false,
        generate: generateViaStImagine,
    },
    "nai-direct": {
        id: "nai-direct",
        label: "NovelAI (ตรง — แยกตัวละครได้)",
        supportsCharacters: true,
        generate: generateViaNaiDirect,
    },
    "custom": {
        id: "custom",
        label: "Custom API",
        supportsCharacters: true,
        generate: generateViaCustom,
    },
};

export function getBackend(id) {
    return BACKENDS[id] || BACKENDS["nai-st"];
}
