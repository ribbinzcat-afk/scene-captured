// ===== Scene Captured — index.js =====
// Extension สำหรับ SillyTavern: เลือกข้อความในซีน -> ให้ AI เขียน image prompt (แยกตัวละครได้) -> ส่งต่อ image gen (เน้น NovelAI)

import { getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import {
    extensionName,
    extensionFolderPath,
    defaultSettings,
    DEFAULT_SYSTEM_PROMPT,
    getSetting,
    setSetting,
    loadSettings,
} from "./src/store.js";
import { buildSceneMessages, parseScenePrompt, flattenScenePrompt, buildAutoSceneMessages, parseAutoScenePrompt } from "./src/prompt.js";
import { buildCharacterContext } from "./src/context.js";
import { buildPromptEditor, readPromptEditor, buildFloatingCaptureButton } from "./src/ui.js";
import { getBackend, testNaiDirectConnection, fetchCustomModels } from "./src/backends.js";
import { saveBase64AsFile } from "../../../utils.js";

// ===== resolution presets (ต้องตรงกับ <option> ใน settings.html) =====
const RESOLUTION_PRESETS = {
    "832x1216": { width: 832, height: 1216 },
    "1216x832": { width: 1216, height: 832 },
    "1024x1024": { width: 1024, height: 1024 },
    "1152x896": { width: 1152, height: 896 },
    "896x1152": { width: 896, height: 1152 },
};

// หา preset ที่ตรงกับ width/height ปัจจุบัน — ถ้าไม่ตรงเลยถือว่า "กำหนดเอง"
function matchResolutionPreset(width, height) {
    for (const [key, dim] of Object.entries(RESOLUTION_PRESETS)) {
        if (dim.width === width && dim.height === height) return key;
    }
    return "custom";
}

// กางกล่อง "ตั้งค่าขั้นสูง" ให้เห็นทันที (ใช้ตอนต้องบังคับโชว์ฟิลด์ที่ซ่อนอยู่ข้างใน เช่นตอนเลือกสัดส่วนแบบกำหนดเอง)
function expandAdvanced(targetId) {
    const $target = $(`#${targetId}`);
    $target.removeClass("scap-hidden");
    $target.prev(".scap-advanced-toggle").find("i").removeClass("fa-chevron-right").addClass("fa-chevron-down");
}

// ===== โหลดค่า settings ปัจจุบันลงในฟอร์ม =====
function populateSettingsForm() {
    $("#scap-response-length").val(getSetting("responseLength"));
    $("#scap-system-prompt").val(getSetting("systemPrompt"));

    $("#scap-include-character-card").prop("checked", getSetting("includeCharacterCard"));
    $("#scap-include-persona").prop("checked", getSetting("includePersona"));
    $("#scap-include-world-info").prop("checked", getSetting("includeWorldInfo"));
    $("#scap-world-info-limit").val(getSetting("worldInfoLimit"));

    $("#scap-prefix").val(getSetting("prefix"));
    $("#scap-negative").val(getSetting("negativePrompt"));

    const width = getSetting("width");
    const height = getSetting("height");
    $("#scap-width").val(width);
    $("#scap-height").val(height);
    $("#scap-resolution").val(matchResolutionPreset(width, height));

    $("#scap-model").val(getSetting("model"));
    $("#scap-sampler").val(getSetting("sampler"));
    $("#scap-scheduler").val(getSetting("scheduler"));
    $("#scap-steps").val(getSetting("steps"));
    $("#scap-scale").val(getSetting("scale"));
    $("#scap-seed").val(getSetting("seed"));
    $("#scap-smea").prop("checked", getSetting("smea"));
    $("#scap-smea-dyn").prop("checked", getSetting("smeaDyn"));
    $("#scap-decrisper").prop("checked", getSetting("decrisper"));
    $("#scap-variety-boost").prop("checked", getSetting("varietyBoost"));

    $("#scap-backend").val(getSetting("backend"));
    updateBackendHint();
    updateBackendFieldsVisibility();
    $("#scap-auto-send").prop("checked", getSetting("autoSendToImageGen"));

    $("#scap-nai-token").val(getSetting("naiToken"));
    $("#scap-nai-cors-proxy").prop("checked", getSetting("naiUseCorsProxy"));
    $("#scap-nai-use-coords").prop("checked", getSetting("naiUseCoords"));

    $("#scap-custom-url").val(getSetting("customUrl"));
    $("#scap-custom-method").val(getSetting("customMethod"));
    $("#scap-custom-cors-proxy").prop("checked", getSetting("customUseCorsProxy"));
    $("#scap-custom-api-key").val(getSetting("customApiKey"));
    $("#scap-custom-api-key-header").val(getSetting("customApiKeyHeader"));
    $("#scap-custom-api-key-prefix").val(getSetting("customApiKeyPrefix"));
    $("#scap-custom-headers").val(getSetting("customHeaders"));
    $("#scap-custom-models-url").val(getSetting("customModelsUrl"));
    $("#scap-custom-models-path").val(getSetting("customModelsPath"));
    $("#scap-custom-model").val(getSetting("customModel"));
    $("#scap-custom-body").val(getSetting("customBodyTemplate"));
    $("#scap-custom-image-path").val(getSetting("customImagePath"));

    $("#scap-auto-enabled").prop("checked", getSetting("autoEnabled"));
    $("#scap-auto-interval").val(getSetting("autoInterval"));
    $("#scap-auto-mode").val(getSetting("autoMode"));
    $("#scap-auto-lookback").val(getSetting("autoLookback"));
    $("#scap-auto-min-chars").val(getSetting("autoMinChars"));

    $("#scap-image-position").val(getSetting("imagePosition"));
    $("#scap-image-attach-mode").val(getSetting("imageAttachMode"));
    updateImageAttachModeHint();
}

const IMAGE_ATTACH_MODE_HINTS = {
    "gallery": "ได้ปุ่มเลื่อนดูรูปเก่า/regen ของ SillyTavern มาฟรี แต่ถ้าเปิด \"Send inline media\" ของ ST ไว้และใช้โมเดลที่ดูรูปได้ (vision) รูปจะถูกส่งเข้า context ทุกครั้งที่ AI ตอบข้อความถัดไป",
    "display-only": "รูปจะไม่ถูกส่งให้ AI เห็นเลยไม่ว่าจะตั้งค่า ST แบบไหน (ไม่แตะข้อความเดิมที่ส่งให้ AI) แต่โชว์ได้ทีละรูป ไม่มีปุ่มย้อนดูรูปเก่า และรูปเก่าจะถูกลบทิ้งทุกครั้งที่เจนใหม่แทนที่",
};

function updateImageAttachModeHint() {
    $("#scap-image-attach-mode-hint").text(IMAGE_ATTACH_MODE_HINTS[getSetting("imageAttachMode")] || "");
}

const BACKEND_HINTS = {
    "nai-st": "ใช้ NovelAI token ที่ตั้งค่าไว้ใน SillyTavern อยู่แล้ว ไม่ต้องตั้งอะไรเพิ่ม — เหมาะกับคนส่วนใหญ่ (แยกตัวละครไม่ได้ ถ้าใส่หลายตัวจะยุบรวมเป็น prompt เดียว)",
    "st-imagine": "ใช้ระบบเจนภาพเดิมที่ตั้งไว้ใน SillyTavern (เมนู Image Generation) ไม่ว่าจะต่อกับอะไรอยู่ก็ใช้อันนั้น",
    "nai-direct": "แยกตัวละครแต่ละคนในภาพได้จริง แต่ต้องมี NovelAI token ของตัวเอง (คนละอันกับที่ตั้งไว้ใน SillyTavern) และต้องเปิด CORS proxy ก่อน — ดูวิธีตั้งค่าด้านล่าง",
    "custom": "เชื่อมต่อ API ของผู้ให้บริการอื่นเอง ต้องกรอก URL/รูปแบบข้อมูลเอง เหมาะกับผู้ที่คุ้นเคยกับ API อยู่แล้ว",
};

function updateBackendHint() {
    const hint = BACKEND_HINTS[getSetting("backend")] || "";
    $("#scap-backend-hint").text(hint);
}

// โชว์เฉพาะฟิลด์ของ backend ที่เลือกอยู่ (nai-direct / custom มีฟิลด์เพิ่ม อีก 2 ตัวไม่มี)
function updateBackendFieldsVisibility() {
    const backend = getSetting("backend");
    $("#scap-nai-direct-fields").toggleClass("scap-hidden", backend !== "nai-direct");
    $("#scap-custom-fields").toggleClass("scap-hidden", backend !== "custom");
}

// ===== เติมรายชื่อ connection profile ลง dropdown (จาก Connection Manager ของ ST) =====
function populateApiProfileDropdown() {
    const ctx = getContext();
    const CMRS = ctx.ConnectionManagerRequestService;
    if (!CMRS || typeof CMRS.handleDropdown !== "function") {
        // Connection Manager ไม่พร้อมใช้งาน (extension ถูกปิด) — ปล่อย dropdown ว่าง ใช้ fallback generateRaw เสมอ
        console.warn(`[${extensionName}] ConnectionManagerRequestService ไม่พร้อมใช้งาน`);
        return;
    }
    try {
        CMRS.handleDropdown("#scap-api-profile", getSetting("apiProfile"), (profile) => {
            setSetting("apiProfile", profile ? profile.id : "");
        });
    } catch (e) {
        console.error(`[${extensionName}] เติม connection profile dropdown ล้มเหลว:`, e);
        toastr.error("โหลดรายชื่อ connection profile ไม่สำเร็จ", "Scene Captured");
    }
}

// ===== ผูก event handler ของฟอร์มตั้งค่า (delegated บน document ทุกตัว) =====
function bindSettingsFormHandlers() {
    $(document).on("input", "#scap-response-length", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("responseLength", Number.isFinite(value) ? value : defaultSettings.responseLength);
    });

    $(document).on("input", "#scap-include-character-card", function () {
        setSetting("includeCharacterCard", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-include-persona", function () {
        setSetting("includePersona", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-include-world-info", function () {
        setSetting("includeWorldInfo", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-world-info-limit", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("worldInfoLimit", Number.isFinite(value) && value >= 0 ? value : defaultSettings.worldInfoLimit);
    });

    $(document).on("input", "#scap-system-prompt", function () {
        setSetting("systemPrompt", $(this).val());
    });

    $(document).on("click", "#scap-reset-system-prompt", function () {
        $("#scap-system-prompt").val(DEFAULT_SYSTEM_PROMPT);
        setSetting("systemPrompt", DEFAULT_SYSTEM_PROMPT);
        toastr.info("คืนค่าคำสั่งระบบเริ่มต้นแล้ว", "Scene Captured");
    });

    $(document).on("input", "#scap-prefix", function () {
        setSetting("prefix", $(this).val());
    });

    $(document).on("input", "#scap-negative", function () {
        setSetting("negativePrompt", $(this).val());
    });

    $(document).on("change", "#scap-resolution", function () {
        const key = $(this).val();
        setSetting("resolutionPreset", key);
        const preset = RESOLUTION_PRESETS[key];
        if (preset) {
            $("#scap-width").val(preset.width);
            $("#scap-height").val(preset.height);
            setSetting("width", preset.width);
            setSetting("height", preset.height);
        } else {
            // เลือก "กำหนดเอง" — เปิดกล่องขั้นสูงให้เห็นช่องกว้าง/สูงทันที ไม่งั้นผู้ใช้จะหาช่องกรอกไม่เจอ
            expandAdvanced("scap-adv-image-api");
        }
    });

    // พับ/กาง "ตั้งค่าขั้นสูง" ทุกกลุ่มด้วย handler ตัวเดียว (ใช้ data-target ชี้กล่องที่จะพับ)
    $(document).on("click", ".scap-advanced-toggle", function () {
        const $toggle = $(this);
        const $target = $("#" + $toggle.data("target"));
        const nowHidden = !$target.hasClass("scap-hidden");
        $target.toggleClass("scap-hidden");
        $toggle.find("i").toggleClass("fa-chevron-right", nowHidden).toggleClass("fa-chevron-down", !nowHidden);
    });

    $(document).on("input", "#scap-width", function () {
        const value = parseInt($(this).val(), 10);
        if (Number.isFinite(value) && value > 0) {
            setSetting("width", value);
            $("#scap-resolution").val(matchResolutionPreset(value, getSetting("height")));
        }
    });

    $(document).on("input", "#scap-height", function () {
        const value = parseInt($(this).val(), 10);
        if (Number.isFinite(value) && value > 0) {
            setSetting("height", value);
            $("#scap-resolution").val(matchResolutionPreset(getSetting("width"), value));
        }
    });

    $(document).on("change", "#scap-model", function () {
        setSetting("model", $(this).val());
    });

    $(document).on("change", "#scap-sampler", function () {
        setSetting("sampler", $(this).val());
    });

    $(document).on("change", "#scap-scheduler", function () {
        setSetting("scheduler", $(this).val());
    });

    $(document).on("input", "#scap-steps", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("steps", Number.isFinite(value) ? value : defaultSettings.steps);
    });

    $(document).on("input", "#scap-scale", function () {
        const value = parseFloat($(this).val());
        setSetting("scale", Number.isFinite(value) ? value : defaultSettings.scale);
    });

    $(document).on("input", "#scap-seed", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("seed", Number.isFinite(value) ? value : -1);
    });

    $(document).on("input", "#scap-smea", function () {
        setSetting("smea", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-smea-dyn", function () {
        setSetting("smeaDyn", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-decrisper", function () {
        setSetting("decrisper", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-variety-boost", function () {
        setSetting("varietyBoost", Boolean($(this).prop("checked")));
    });

    $(document).on("change", "#scap-backend", function () {
        setSetting("backend", $(this).val());
        updateBackendHint();
        updateBackendFieldsVisibility();
    });

    $(document).on("input", "#scap-auto-send", function () {
        setSetting("autoSendToImageGen", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-nai-token", function () {
        setSetting("naiToken", $(this).val());
    });

    $(document).on("input", "#scap-nai-cors-proxy", function () {
        setSetting("naiUseCorsProxy", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-nai-use-coords", function () {
        setSetting("naiUseCoords", Boolean($(this).prop("checked")));
    });

    $(document).on("click", "#scap-nai-test-connection", async function () {
        const token = getSetting("naiToken");
        if (!token) {
            toastr.warning("ยังไม่ได้กรอก NovelAI Token", "Scene Captured");
            return;
        }
        const $btn = $(this);
        $btn.addClass("scap-busy");
        try {
            const info = await testNaiDirectConnection(token, getSetting("naiUseCorsProxy"));
            const tier = info?.tiers?.length ? `tier ${info.tiers[0]?.tier ?? "?"}` : "เชื่อมต่อสำเร็จ";
            toastr.success(tier, "Scene Captured — NovelAI");
        } catch (e) {
            console.error(`[${extensionName}] ทดสอบ NovelAI ล้มเหลว:`, e);
            toastr.error(String(e?.message || e), "Scene Captured — NovelAI");
        } finally {
            $btn.removeClass("scap-busy");
        }
    });

    $(document).on("input", "#scap-custom-url", function () {
        setSetting("customUrl", $(this).val());
    });

    $(document).on("change", "#scap-custom-method", function () {
        setSetting("customMethod", $(this).val());
    });

    $(document).on("input", "#scap-custom-cors-proxy", function () {
        setSetting("customUseCorsProxy", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-custom-api-key", function () {
        setSetting("customApiKey", $(this).val());
    });

    $(document).on("input", "#scap-custom-api-key-header", function () {
        setSetting("customApiKeyHeader", $(this).val());
    });

    $(document).on("input", "#scap-custom-api-key-prefix", function () {
        setSetting("customApiKeyPrefix", $(this).val());
    });

    $(document).on("input", "#scap-custom-headers", function () {
        setSetting("customHeaders", $(this).val());
    });

    $(document).on("input", "#scap-custom-models-url", function () {
        setSetting("customModelsUrl", $(this).val());
    });

    $(document).on("input", "#scap-custom-models-path", function () {
        setSetting("customModelsPath", $(this).val());
    });

    $(document).on("input", "#scap-custom-model", function () {
        setSetting("customModel", $(this).val());
    });

    $(document).on("click", "#scap-custom-load-models", async function () {
        const $btn = $(this);
        $btn.addClass("scap-busy");
        try {
            const models = await fetchCustomModels(buildGenerationParams());
            const $select = $("#scap-custom-model-select");
            $select.empty().append(`<option value="">— เลือกโมเดล (${models.length} รายการ) —</option>`);
            for (const m of models) {
                $select.append(`<option value="${m.id.replace(/"/g, "&quot;")}">${m.label}</option>`);
            }
            toastr.success(`โหลดรายชื่อโมเดลได้ ${models.length} รายการ`, "Scene Captured");
        } catch (e) {
            console.error(`[${extensionName}] โหลดรายชื่อโมเดลล้มเหลว:`, e);
            toastr.error(String(e?.message || e), "Scene Captured — โหลดโมเดล");
        } finally {
            $btn.removeClass("scap-busy");
        }
    });

    $(document).on("change", "#scap-custom-model-select", function () {
        const value = $(this).val();
        if (!value) return;
        $("#scap-custom-model").val(value);
        setSetting("customModel", value);
    });

    $(document).on("input", "#scap-custom-body", function () {
        setSetting("customBodyTemplate", $(this).val());
    });

    $(document).on("input", "#scap-custom-image-path", function () {
        setSetting("customImagePath", $(this).val());
    });

    $(document).on("input", "#scap-auto-enabled", function () {
        setSetting("autoEnabled", Boolean($(this).prop("checked")));
    });

    $(document).on("input", "#scap-auto-interval", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("autoInterval", Number.isFinite(value) && value > 0 ? value : defaultSettings.autoInterval);
    });

    $(document).on("change", "#scap-auto-mode", function () {
        setSetting("autoMode", $(this).val());
    });

    $(document).on("input", "#scap-auto-lookback", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("autoLookback", Number.isFinite(value) && value > 0 ? value : defaultSettings.autoLookback);
    });

    $(document).on("input", "#scap-auto-min-chars", function () {
        const value = parseInt($(this).val(), 10);
        setSetting("autoMinChars", Number.isFinite(value) && value >= 0 ? value : defaultSettings.autoMinChars);
    });

    $(document).on("change", "#scap-image-position", function () {
        setSetting("imagePosition", $(this).val());
        applyImagePositionToAllMessages();
    });

    $(document).on("change", "#scap-image-attach-mode", function () {
        setSetting("imageAttachMode", $(this).val());
        updateImageAttachModeHint();
    });
}

// ===== เฟส 2: เลือกข้อความ -> ให้ AI เขียน prompt =====

let isCaptureBusy = false;
let $floatBtn = null;
let pendingSelection = null; // { text, mesId } — เก็บตอนกดปุ่มลอย

// รวมค่าตั้งค่า 4 ตัวที่คุม buildCharacterContext() ไว้ที่เดียว กันเขียนซ้ำ 2 จุด (capture ปกติ + auto)
function getCharacterContextOptions() {
    return {
        includeCharacterCard: getSetting("includeCharacterCard"),
        includePersona: getSetting("includePersona"),
        includeWorldInfo: getSetting("includeWorldInfo"),
        worldInfoLimit: parseInt(getSetting("worldInfoLimit"), 10) || 0,
    };
}

// ยิง generation ไปหา LLM — ใช้ connection profile ถ้าเลือกไว้ ไม่งั้น fallback ไป generateRaw (API หลักของ ST)
// generateRaw รับ prompt เป็น array ของ {role, content} ได้เหมือนกับ ConnectionManagerRequestService.sendRequest
// จึงส่ง messages ชุดเดียวกันให้ทั้งสองทางได้เลย ไม่ต้องแปลงรูปแบบ
async function scapGenerate(messages, maxTokens) {
    const ctx = getContext();
    const profileId = getSetting("apiProfile");

    if (profileId && ctx.ConnectionManagerRequestService) {
        try {
            const res = await ctx.ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens, {
                stream: false,
                extractData: true,
            });
            const content = res && typeof res.content === "string" ? res.content : "";
            if (content) return content;
            console.warn(`[${extensionName}] profile ส่งข้อความว่าง — fallback ไป API หลัก`);
        } catch (e) {
            console.error(`[${extensionName}] profile request ล้มเหลว fallback ไป API หลัก:`, e?.cause ?? e);
        }
    }

    if (typeof ctx.generateRaw !== "function") {
        throw new Error("เวอร์ชัน SillyTavern นี้ไม่มี generateRaw");
    }
    return await ctx.generateRaw({ prompt: messages, responseLength: maxTokens });
}

// ===== เฟส 3: ต่อ image gen + แทรกรูป =====

const busyControllers = new Map(); // mesId -> AbortController — กำลังเจนภาพอยู่ (กดปุ่มซ้ำ = ยกเลิก)

// รวบพารามิเตอร์ทั้งหมดจากหน้าตั้งค่าเป็นก้อนเดียว ส่งให้ backend.generate()
function buildGenerationParams() {
    return {
        prefix: getSetting("prefix"),
        negativePrompt: getSetting("negativePrompt"),
        width: getSetting("width"),
        height: getSetting("height"),
        model: getSetting("model"),
        sampler: getSetting("sampler"),
        scheduler: getSetting("scheduler"),
        steps: getSetting("steps"),
        scale: getSetting("scale"),
        seed: getSetting("seed"),
        smea: getSetting("smea"),
        smeaDyn: getSetting("smeaDyn"),
        decrisper: getSetting("decrisper"),
        varietyBoost: getSetting("varietyBoost"),
        upscaleRatio: getSetting("upscaleRatio"),
        naiToken: getSetting("naiToken"),
        naiUseCorsProxy: getSetting("naiUseCorsProxy"),
        naiUseCoords: getSetting("naiUseCoords"),
        customUrl: getSetting("customUrl"),
        customMethod: getSetting("customMethod"),
        customHeaders: getSetting("customHeaders"),
        customBodyTemplate: getSetting("customBodyTemplate"),
        customImagePath: getSetting("customImagePath"),
        customUseCorsProxy: getSetting("customUseCorsProxy"),
        customApiKey: getSetting("customApiKey"),
        customApiKeyHeader: getSetting("customApiKeyHeader"),
        customApiKeyPrefix: getSetting("customApiKeyPrefix"),
        customModel: getSetting("customModel"),
        customModelsUrl: getSetting("customModelsUrl"),
        customModelsPath: getSetting("customModelsPath"),
    };
}

// สลับไอคอนปุ่มจับซีนของข้อความนั้นเป็นสปินเนอร์ตอนกำลังเจนภาพ — กดซ้ำตอนสปินอยู่ = ยกเลิก (ผูกกับ busyControllers)
function setMesButtonBusy(mesId, busy) {
    const $btn = $(`#chat .mes[mesid="${mesId}"] .scap-mes-capture`);
    if (!$btn.length) return;
    if (busy) {
        $btn.addClass("scap-busy fa-spinner fa-spin").removeClass("fa-camera");
        $btn.attr("title", "กำลังเจนภาพ… (กดเพื่อยกเลิก)");
    } else {
        $btn.removeClass("scap-busy fa-spinner fa-spin").addClass("fa-camera");
        $btn.attr("title", "จับซีนนี้ด้วย Scene Captured");
    }
}

// ต่อ MediaAttachment เข้า mes.extra.media แล้วสั่ง ST วาดใหม่ — ต้องใช้ extra.media[] เท่านั้น
// (extra.image / extra.image_swipes ถูก ST เปลี่ยนเป็น getter/setter ที่เขียนไม่ได้แล้วในเวอร์ชันนี้)
// ลบไฟล์รูปออกจากดิสก์จริง ๆ (ไม่ใช่แค่เอาอ้างอิงออกจากข้อความ) — ข้ามให้เงียบถ้าเป็น URL นอกเซิร์ฟเวอร์ (backend อื่นที่ไม่ได้ผ่าน saveBase64AsFile)
async function deleteImageFileIfLocal(url) {
    if (!url || /^https?:\/\//i.test(url)) return;
    try {
        const ctx = getContext();
        await fetch("/api/images/delete", {
            method: "POST",
            headers: ctx.getRequestHeaders(),
            body: JSON.stringify({ path: url }),
        });
    } catch (e) {
        console.warn(`[${extensionName}] ลบไฟล์รูปเก่าไม่สำเร็จ (ไม่กระทบการใช้งานหลัก):`, e);
    }
}

function escapeHtmlAttr(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// โหมด "gallery" (ค่าเริ่มต้น) — ใช้ extra.media[] ของ ST เอง ได้ปุ่ม swipe ดูรูปเก่า/regen มาฟรี
// ⚠️ ข้อควรรู้: ถ้าเปิด "Send inline media" ของ ST ไว้ + โมเดลที่ใช้รองรับรูปภาพ (vision) รูปในโหมดนี้จะถูกส่งเข้า context จริง (ยืนยันจากซอร์ส ST — ไม่แยกว่ารูปมาจาก extension ไหน)
function attachMediaGallery(ctx, message, mesId, url, promptTitle, negative, width, height) {
    if (!Array.isArray(message.extra.media)) message.extra.media = [];

    // ค่า literal ต่อไปนี้ตรงกับ MEDIA_TYPE.IMAGE / MEDIA_SOURCE.GENERATED / MEDIA_DISPLAY.GALLERY / SCROLL_BEHAVIOR.KEEP
    // ใน public/scripts/constants.js — ใช้ literal ตรง ๆ แทนการ import เพื่อลด coupling กับ path ภายใน
    message.extra.media.push({
        url,
        type: "image",
        title: promptTitle,
        source: "generated",
        negative,
        width,
        height,
    });
    message.extra.media_index = message.extra.media.length - 1;
    message.extra.media_display = "gallery"; // ได้ปุ่ม swipe ซ้าย/ขวาของ ST มาฟรีสำหรับ regen
    message.extra.inline_image = true;

    const $mesEl = $(`#chat .mes[mesid="${mesId}"]`);
    if ($mesEl.length) {
        ctx.appendMediaToMessage(message, $mesEl, "keep");
        applyImagePositionForMessage($mesEl); // ย้ายตำแหน่งรูปตามที่ตั้งไว้ (บน/ล่างข้อความ)
    }
}

// โหมด "display-only" — ฝังรูปเป็น &lt;img&gt; ใน extra.display_text แทน ไม่แตะ .mes และไม่ใช้ extra.media เลย
// ยืนยันแล้วจากซอร์ส ST (2026-08-19): ทั้ง text completion และ chat completion อ่านแค่ .mes,
// ส่วนฟีเจอร์ vision-inlining ของ chat completion อ่านจาก extra.media เท่านั้น — โหมดนี้จึง "มองไม่เห็น" จากทั้งสองทาง
// โชว์ทีละรูป ไม่มีประวัติให้ swipe ย้อนดู — ลบไฟล์เก่าทิ้งทุกครั้งที่มีรูปใหม่มาแทน กันไฟล์ค้างสะสม
async function attachMediaDisplayOnly(ctx, message, mesId, url, promptTitle) {
    const prevUrl = message.extra?.scene_captured?.imageUrl;
    if (prevUrl && prevUrl !== url) {
        await deleteImageFileIfLocal(prevUrl);
    }

    const imgTag = `<img src="${escapeHtmlAttr(url)}" title="${escapeHtmlAttr(promptTitle)}" class="scap-inline-img" />`;
    const baseMes = message.mes; // ต้นฉบับที่ LLM เห็น — ห้ามแก้ค่านี้เด็ดขาด
    message.extra.display_text = getSetting("imagePosition") === "above" ? `${imgTag}\n\n${baseMes}` : `${baseMes}\n\n${imgTag}`;

    const $mesEl = $(`#chat .mes[mesid="${mesId}"]`);
    if ($mesEl.length) {
        ctx.updateMessageBlock(mesId, message);
    }
}

// เช็คว่าข้อความนี้มีรูปที่ Scene Captured แทรกไว้อยู่แล้วหรือยัง — ต้องเช็คทั้ง 2 โหมด (gallery ใช้ extra.media, display-only ใช้ extra.display_text)
function messageHasScapImage(message) {
    const hasMedia = Array.isArray(message?.extra?.media) && message.extra.media.length > 0;
    const hasDisplayImage = Boolean(message?.extra?.display_text?.includes('class="scap-inline-img"'));
    return hasMedia || hasDisplayImage;
}

async function attachMediaToMessage(ctx, message, mesId, url, promptTitle, negative, width, height) {
    if (!message.extra || typeof message.extra !== "object") message.extra = {};

    if (getSetting("imageAttachMode") === "display-only") {
        await attachMediaDisplayOnly(ctx, message, mesId, url, promptTitle);
    } else {
        attachMediaGallery(ctx, message, mesId, url, promptTitle, negative, width, height);
    }
}

// เจนภาพจริงจาก ScenePrompt ที่มีอยู่แล้ว (ไม่เรียก LLM ซ้ำ) แล้วแทรกเข้าไปในข้อความ
async function generateImageForMessage(mesId, scenePromptOverride, opts = {}) {
    const ctx = getContext();
    const message = ctx.chat[mesId];
    if (!message) {
        toastr.error("ไม่พบข้อความนี้แล้ว (อาจถูกลบหรือแชทถูกสลับ)", "Scene Captured");
        return;
    }

    const scenePrompt = scenePromptOverride || message.extra?.scene_captured?.prompt;
    if (!scenePrompt || (!scenePrompt.base && !scenePrompt.characters?.length)) {
        toastr.warning("ยังไม่มี prompt ให้เจนภาพ — กด \"จับซีนนี้\" ก่อน", "Scene Captured");
        return;
    }

    if (busyControllers.has(mesId)) {
        toastr.info("กำลังเจนภาพข้อความนี้อยู่แล้ว", "Scene Captured");
        return;
    }

    const backendId = getSetting("backend");
    const backend = getBackend(backendId);
    const params = buildGenerationParams();
    if (opts.forceRandomSeed) params.seed = -1; // ปุ่ม "เจนใหม่" ต้องได้ seed สุ่มเสมอ ไม่ใช้ seed ตายตัวจากหน้าตั้งค่า
    const controller = new AbortController();
    busyControllers.set(mesId, controller);
    setMesButtonBusy(mesId, true);

    try {
        const result = await backend.generate(ctx, scenePrompt, params, controller.signal);
        let url;
        if (result?.data) {
            const subFolder = ctx.name2 || extensionName;
            const filename = `${subFolder}_${ctx.humanizedDateTime ? ctx.humanizedDateTime() : Date.now()}`;
            url = await saveBase64AsFile(result.data, subFolder, filename, result.format || "png");
        } else if (result?.url) {
            url = result.url;
        }
        if (!url) throw new Error("backend ไม่ได้คืน URL หรือข้อมูลรูปกลับมา");

        if (!message.extra.scene_captured) message.extra.scene_captured = { prompt: scenePrompt, params: null, backend: null, at: Date.now(), imageUrl: null };

        const promptTitle = flattenScenePrompt(scenePrompt, params.prefix);
        await attachMediaToMessage(ctx, message, mesId, url, promptTitle, scenePrompt.negative || params.negativePrompt, params.width, params.height);

        message.extra.scene_captured.prompt = scenePrompt;
        message.extra.scene_captured.params = params;
        message.extra.scene_captured.backend = backendId;
        message.extra.scene_captured.at = Date.now();
        message.extra.scene_captured.imageUrl = url;

        await ctx.saveChat();
        refreshMesButtonsFor(mesId);
        toastr.success("เจนภาพเสร็จแล้ว", "Scene Captured");
    } catch (e) {
        if (e?.name === "AbortError") {
            toastr.info("ยกเลิกการเจนภาพแล้ว", "Scene Captured");
        } else {
            console.error(`[${extensionName}] generateImageForMessage ล้มเหลว:`, e?.cause ?? e);
            toastr.error(String(e?.cause?.message || e?.message || e), "Scene Captured เจนภาพไม่สำเร็จ");
        }
    } finally {
        busyControllers.delete(mesId);
        setMesButtonBusy(mesId, false);
    }
}

// เปิดหน้าต่างแก้ prompt — "สร้างภาพ" บันทึกแล้วเจนต่อทันที, "บันทึก prompt อย่างเดียว" เก็บไว้เจนทีหลัง
const POPUP_RESULT_SAVE_ONLY = 1002;
async function openSceneEditor(scenePrompt, mesId) {
    const ctx = getContext();
    const $container = buildPromptEditor(scenePrompt, getSetting("prefix"));

    const result = await ctx.callGenericPopup($container, ctx.POPUP_TYPE.TEXT, "", {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: "สร้างภาพ",
        cancelButton: "ยกเลิก",
        customButtons: [{ text: "บันทึก prompt อย่างเดียว", result: POPUP_RESULT_SAVE_ONLY }],
    });

    if (result !== ctx.POPUP_RESULT.AFFIRMATIVE && result !== POPUP_RESULT_SAVE_ONLY) {
        toastr.info("ยกเลิกแล้ว ไม่ได้บันทึก prompt", "Scene Captured");
        return;
    }

    const edited = readPromptEditor($container);
    const message = ctx.chat[mesId];
    if (!message) {
        console.error(`[${extensionName}] ไม่พบข้อความ mesId=${mesId} ตอนจะบันทึก prompt`);
        toastr.error("ไม่พบข้อความนี้แล้ว (อาจถูกลบหรือแชทถูกสลับ)", "Scene Captured");
        return;
    }

    if (!message.extra || typeof message.extra !== "object") message.extra = {};
    message.extra.scene_captured = {
        prompt: edited,
        params: null,
        backend: null,
        at: Date.now(),
    };
    await ctx.saveChat();
    refreshMesButtonsFor(mesId);

    if (result === ctx.POPUP_RESULT.AFFIRMATIVE) {
        toastr.success("บันทึก prompt แล้ว กำลังส่งไปเจนภาพ…", "Scene Captured");
        await generateImageForMessage(mesId, edited);
    } else {
        toastr.success("บันทึก prompt แล้ว", "Scene Captured");
    }
}

// เรียก LLM เขียน prompt จากข้อความฉากที่เลือกมา — ถ้าตั้ง "ส่งต่ออัตโนมัติ" ไว้ ข้ามหน้าแก้ไขแล้วเจนภาพเลย
async function captureFlow(sceneText, mesId) {
    const text = String(sceneText || "").trim();
    if (!text) {
        toastr.warning("ไม่มีข้อความให้จับซีน", "Scene Captured");
        return;
    }
    if (isCaptureBusy) {
        toastr.info("กำลังเขียน prompt อยู่ รอสักครู่", "Scene Captured");
        return;
    }

    isCaptureBusy = true;
    const loadingToast = toastr.info("กำลังคิด prompt จากฉากที่เลือก…", "Scene Captured", { timeOut: 0, extendedTimeOut: 0 });
    try {
        const contextPreamble = await buildCharacterContext(getCharacterContextOptions());
        const messages = buildSceneMessages(text, getSetting("systemPrompt"), contextPreamble);
        const raw = await scapGenerate(messages, getSetting("responseLength"));
        const scenePrompt = parseScenePrompt(raw);
        toastr.clear(loadingToast);

        if (getSetting("autoSendToImageGen")) {
            const ctx = getContext();
            const message = ctx.chat[mesId];
            if (message) {
                if (!message.extra || typeof message.extra !== "object") message.extra = {};
                message.extra.scene_captured = { prompt: scenePrompt, params: null, backend: null, at: Date.now() };
                await ctx.saveChat();
            }
            await generateImageForMessage(mesId, scenePrompt);
        } else {
            await openSceneEditor(scenePrompt, mesId);
        }
    } catch (e) {
        console.error(`[${extensionName}] captureFlow ล้มเหลว:`, e?.cause ?? e);
        toastr.clear(loadingToast);
        toastr.error(String(e?.cause?.message || e?.message || e), "Scene Captured เขียน prompt ไม่สำเร็จ");
    } finally {
        isCaptureBusy = false;
    }
}

// ปุ่มทั้งชุดที่แทรกในแถบ action ของทุกข้อความ — เรียง: จับซีน / แก้ prompt / เจนใหม่ / ก๊อป prompt / ลบรูป
// 4 ปุ่มหลัง (edit/regen/copy/delete) ซ่อนด้วย scap-hidden ไว้ก่อน โชว์เฉพาะข้อความที่มีข้อมูลเกี่ยวข้องจริง (ดู refreshMesButtonsForAll)
const MES_BUTTONS_HTML = `
    <div title="จับซีนนี้ด้วย Scene Captured" class="mes_button scap-mes-capture fa-solid fa-camera"></div>
    <div title="แก้ prompt ที่บันทึกไว้" class="mes_button scap-mes-edit fa-solid fa-pen scap-hidden"></div>
    <div title="เจนใหม่ (prompt เดิม สุ่ม seed ใหม่)" class="mes_button scap-mes-regen fa-solid fa-rotate scap-hidden"></div>
    <div title="ก๊อป prompt ล่าสุด" class="mes_button scap-mes-copy fa-solid fa-copy scap-hidden"></div>
    <div title="ลบรูปนี้" class="mes_button scap-mes-delete-image fa-solid fa-trash-can scap-hidden"></div>`;

// แทรกปุ่มเข้า template ของทุกข้อความ (ทำครั้งเดียวตอน APP_READY ซึ่งเป็น sticky event)
function ensureCaptureButtonInTemplate() {
    const $btnSlot = $("#message_template .extraMesButtons");
    if (!$btnSlot.length || $btnSlot.find(".scap-mes-capture").length) return;
    $btnSlot.prepend(MES_BUTTONS_HTML);
}

// แทรกปุ่มลงข้อความที่วาดไปแล้วก่อนที่ template ด้านบนจะทันอัปเดต (เผี่ยงชนกันตอนโหลดหน้าครั้งแรก)
// ต้องเรียกซ้ำได้ทุกครั้งที่มีข้อความใหม่โผล่ — เช็คก่อนว่ามีปุ่มอยู่แล้วหรือยังทุกครั้ง กันแทรกซ้ำ
function ensureCaptureButtonOnRenderedMessages() {
    $("#chat .mes").each(function () {
        const $slot = $(this).find(".extraMesButtons");
        if ($slot.length && !$slot.find(".scap-mes-capture").length) {
            $slot.prepend(MES_BUTTONS_HTML);
        }
    });
    refreshMesButtonsForAll();
}

// โชว์/ซ่อนปุ่ม แก้ prompt / เจนใหม่ / ก๊อป / ลบรูป ตามข้อมูลจริงของแต่ละข้อความ (ไม่โชว์ถ้ายังไม่มีอะไรให้ทำ)
function refreshMesButtonsFor(mesId) {
    const ctx = getContext();
    const message = ctx.chat[mesId];
    const $mesEl = $(`#chat .mes[mesid="${mesId}"]`);
    if (!message || !$mesEl.length) return;

    const hasPrompt = Boolean(message.extra?.scene_captured?.prompt);
    const hasImage = messageHasScapImage(message);

    $mesEl.find(".scap-mes-edit").toggleClass("scap-hidden", !hasPrompt);
    $mesEl.find(".scap-mes-regen").toggleClass("scap-hidden", !hasPrompt);
    $mesEl.find(".scap-mes-copy").toggleClass("scap-hidden", !hasPrompt);
    $mesEl.find(".scap-mes-delete-image").toggleClass("scap-hidden", !hasImage);
}

function refreshMesButtonsForAll() {
    $("#chat .mes").each(function () {
        const mesId = Number($(this).attr("mesid"));
        if (Number.isFinite(mesId)) refreshMesButtonsFor(mesId);
    });
}

// ย้าย .mes_media_wrapper ไปก่อน/หลัง .mes_text ตามตำแหน่งที่ตั้งไว้ — ทำได้เรื่อย ๆ ซ้ำได้ (idempotent)
// node เดิมไม่ถูกสร้างใหม่ตอน ST render รูป (แค่ empty().append() ข้างใน) ย้ายครั้งเดียวอยู่ถาวรจนกว่าจะย้ายอีก
function applyImagePositionForMessage($mesEl) {
    const $wrapper = $mesEl.find(".mes_media_wrapper");
    const $text = $mesEl.find(".mes_text");
    if (!$wrapper.length || !$text.length) return;
    if (getSetting("imagePosition") === "above") {
        $wrapper.insertBefore($text);
    } else {
        $wrapper.insertAfter($text);
    }
}

function applyImagePositionToAllMessages() {
    $("#chat .mes").each(function () {
        applyImagePositionForMessage($(this));
    });
}

function hideFloatButton() {
    if ($floatBtn) {
        $floatBtn.remove();
        $floatBtn = null;
    }
    pendingSelection = null;
}

// ตรวจ selection ในแชท — ถ้าเลือกข้อความใน .mes_text อยู่ ให้โชว์ปุ่มลอยใกล้จุดที่เลือก
function handleChatSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
        hideFloatButton();
        return;
    }
    const text = selection.toString().trim();
    if (!text) {
        hideFloatButton();
        return;
    }
    const anchorEl = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    const $mesText = $(anchorEl).closest(".mes_text");
    const $mes = $(anchorEl).closest(".mes");
    if (!$mesText.length || !$mes.length || !$mes.closest("#chat").length) {
        hideFloatButton();
        return;
    }

    const mesId = Number($mes.attr("mesid"));
    pendingSelection = { text, mesId };

    if (!$floatBtn) {
        $floatBtn = buildFloatingCaptureButton();
        $("body").append($floatBtn);
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    $floatBtn.css({
        position: "fixed",
        top: `${Math.max(8, rect.top - 36)}px`,
        left: `${Math.max(8, rect.left)}px`,
        zIndex: 9999,
    });
}

// ===== เฟส 5: อัตโนมัติทุก n ข้อความ — ให้ AI เลือกซีนเอง =====

// ตัวนับผูกกับแชท (chat_metadata) — ลบแชทแล้วหาย, สลับแชทแล้วรีเซ็ต
// ห้าม cache reference ของ chatMetadata เพราะ ST สร้างอ็อบเจกต์ใหม่ทุกครั้งที่สลับแชท
function getAutoState() {
    const meta = getContext().chatMetadata;
    if (!meta) return { count: 0 };
    if (!meta.scene_captured_auto || typeof meta.scene_captured_auto !== "object") {
        meta.scene_captured_auto = { count: 0 };
    }
    return meta.scene_captured_auto;
}

function saveAutoState() {
    const ctx = getContext();
    if (typeof ctx.saveMetadataDebounced === "function") ctx.saveMetadataDebounced();
}

function resetAutoCounter() {
    getAutoState().count = 0;
    saveAutoState();
}

// ให้ AI เลือกข้อความเองจาก N ข้อความล่าสุด แล้วจับซีน — ทำงานเงียบ ๆ เป็นงานเบื้องหลัง ไม่โชว์ toastr error รบกวนกลางแชท
async function runAutoCapture() {
    if (isCaptureBusy || busyControllers.size > 0) return; // มีงานจับซีน/เจนภาพอื่นทำอยู่ ข้ามรอบนี้ไปก่อน

    const ctx = getContext();
    const lookback = Math.max(1, parseInt(getSetting("autoLookback"), 10) || defaultSettings.autoLookback);
    const minChars = Math.max(0, parseInt(getSetting("autoMinChars"), 10) || 0);

    const startIdx = Math.max(0, ctx.chat.length - lookback);
    const candidates = ctx.chat
        .slice(startIdx)
        .map((m, i) => ({ mesId: startIdx + i, name: m.name, text: String(m.mes || "") }))
        .filter((c) => c.text.trim().length >= minChars);

    if (!candidates.length) {
        console.log(`[${extensionName}] auto: ไม่มีข้อความที่ยาวพอให้เลือก ข้ามรอบนี้`);
        return;
    }

    const listText = candidates
        .map((c) => `[${c.mesId}] ${c.name}: ${c.text.replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n");

    isCaptureBusy = true;
    try {
        const contextPreamble = await buildCharacterContext(getCharacterContextOptions());
        const messages = buildAutoSceneMessages(listText, getSetting("systemPrompt"), contextPreamble);
        const raw = await scapGenerate(messages, getSetting("responseLength"));
        const parsed = parseAutoScenePrompt(raw);
        if (!parsed) {
            console.warn(`[${extensionName}] auto: parse ผลลัพธ์ไม่สำเร็จ ข้ามรอบนี้`, raw);
            return;
        }

        const { mesId, scenePrompt } = parsed;
        const message = ctx.chat[mesId];
        if (!message) {
            console.warn(`[${extensionName}] auto: AI เลือก mesId=${mesId} ที่ไม่มีอยู่จริง ข้ามรอบนี้`);
            return;
        }
        if (messageHasScapImage(message)) {
            console.log(`[${extensionName}] auto: ข้อความ #${mesId} มีรูปอยู่แล้ว ข้ามรอบนี้กันทับของเดิม`);
            return;
        }

        if (!message.extra || typeof message.extra !== "object") message.extra = {};
        message.extra.scene_captured = { prompt: scenePrompt, params: null, backend: null, at: Date.now() };
        await ctx.saveChat();

        if (getSetting("autoMode") === "full") {
            await generateImageForMessage(mesId, scenePrompt);
        } else {
            toastr.info(
                `เลือกข้อความ #${mesId} ให้แล้ว — คลิกที่นี่เพื่อดู/แก้ prompt แล้วสร้างภาพ`,
                "Scene Captured อัตโนมัติ",
                { timeOut: 12000, onclick: () => openSceneEditor(scenePrompt, mesId) },
            );
        }
    } catch (e) {
        // งานเบื้องหลัง — log ไว้พอ ไม่โชว์ toastr error รบกวนกลางแชท
        console.error(`[${extensionName}] runAutoCapture ล้มเหลว:`, e?.cause ?? e);
    } finally {
        isCaptureBusy = false;
    }
}

// นับข้อความ AI ใหม่แต่ละข้อความ — ไม่นับตอน swipe (type === "swipe")
async function onAutoCharacterMessageRendered(mesId, type) {
    if (!getSetting("autoEnabled")) return;
    if (type === "swipe") return;

    const state = getAutoState();
    state.count = (state.count || 0) + 1;
    const interval = Math.max(1, parseInt(getSetting("autoInterval"), 10) || defaultSettings.autoInterval);

    if (state.count < interval) {
        saveAutoState();
        return;
    }

    state.count = 0;
    saveAutoState();
    await runAutoCapture();
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);

    try {
        loadSettings();

        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);

        bindSettingsFormHandlers();
        populateSettingsForm();
        populateApiProfileDropdown();

        // ===== เฟส 2: ปุ่มจับซีน (ทั้งข้อความ + selection) =====
        const ctx = getContext();
        ctx.eventSource.on(ctx.eventTypes.APP_READY, ensureCaptureButtonInTemplate);
        // fallback: เผื่อข้อความถูกวาดไปก่อนที่ template ด้านบนจะอัปเดตทัน (เช่นตอนโหลดหน้าครั้งแรก)
        for (const ev of [ctx.eventTypes.CHAT_CHANGED, ctx.eventTypes.MORE_MESSAGES_LOADED, ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, ctx.eventTypes.USER_MESSAGE_RENDERED]) {
            ctx.eventSource.on(ev, ensureCaptureButtonOnRenderedMessages);
            ctx.eventSource.on(ev, applyImagePositionToAllMessages); // เฟส 6: ตำแหน่งรูป บน/ล่าง ต้องคงอยู่ทุกครั้งที่ข้อความถูกวาดใหม่
        }
        ensureCaptureButtonOnRenderedMessages();
        applyImagePositionToAllMessages();

        // ===== เฟส 5: อัตโนมัติทุก n ข้อความ =====
        ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, onAutoCharacterMessageRendered);
        ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, resetAutoCounter);

        $(document).on("click", ".scap-mes-capture", function () {
            const mesId = Number($(this).closest(".mes").attr("mesid"));
            // ปุ่มกำลังสปิน (กำลังเจนภาพข้อความนี้อยู่) — กดซ้ำ = ยกเลิก แทนที่จะเริ่มจับซีนใหม่
            if (busyControllers.has(mesId)) {
                busyControllers.get(mesId).abort();
                return;
            }
            const message = getContext().chat[mesId];
            if (!message) return;
            captureFlow(message.mes, mesId);
        });

        // ===== เฟส 6: แก้ prompt / เจนใหม่ / ก๊อป prompt / ลบรูป =====
        $(document).on("click", ".scap-mes-edit", function () {
            const mesId = Number($(this).closest(".mes").attr("mesid"));
            const message = getContext().chat[mesId];
            const prompt = message?.extra?.scene_captured?.prompt;
            if (!prompt) {
                toastr.warning("ยังไม่มี prompt ที่บันทึกไว้ให้แก้", "Scene Captured");
                return;
            }
            openSceneEditor(prompt, mesId);
        });

        $(document).on("click", ".scap-mes-regen", function () {
            const mesId = Number($(this).closest(".mes").attr("mesid"));
            const message = getContext().chat[mesId];
            const prompt = message?.extra?.scene_captured?.prompt;
            if (!prompt) {
                toastr.warning("ยังไม่มี prompt ที่บันทึกไว้ให้เจนใหม่", "Scene Captured");
                return;
            }
            generateImageForMessage(mesId, prompt, { forceRandomSeed: true });
        });

        $(document).on("click", ".scap-mes-copy", async function () {
            const mesId = Number($(this).closest(".mes").attr("mesid"));
            const message = getContext().chat[mesId];
            const prompt = message?.extra?.scene_captured?.prompt;
            if (!prompt) {
                toastr.warning("ยังไม่มี prompt ที่บันทึกไว้ให้ก๊อป", "Scene Captured");
                return;
            }
            const text = flattenScenePrompt(prompt, getSetting("prefix"));
            try {
                await navigator.clipboard.writeText(text);
                toastr.success("ก๊อป prompt แล้ว", "Scene Captured");
            } catch (e) {
                console.error(`[${extensionName}] ก๊อป prompt ไม่สำเร็จ:`, e);
                toastr.error("ก๊อป prompt ไม่สำเร็จ (เบราว์เซอร์อาจไม่อนุญาต clipboard)", "Scene Captured");
            }
        });

        $(document).on("click", ".scap-mes-delete-image", async function () {
            const mesId = Number($(this).closest(".mes").attr("mesid"));
            const ctx2 = getContext();
            const message = ctx2.chat[mesId];
            if (!message) return;

            const hasMedia = Array.isArray(message.extra?.media) && message.extra.media.length > 0;
            const hasDisplayImage = Boolean(message.extra?.display_text?.includes('class="scap-inline-img"'));
            if (!hasMedia && !hasDisplayImage) return;

            const $mesEl = $(`#chat .mes[mesid="${mesId}"]`);

            if (hasMedia) {
                // โหมด gallery — เอาตัวที่กำลังโชว์อยู่ออกจาก array (รูปเก่าที่เหลือยังกด "ลบรูป" ไล่ทีละรูปต่อได้)
                const index = Number.isFinite(message.extra.media_index) ? message.extra.media_index : message.extra.media.length - 1;
                const [removed] = message.extra.media.splice(index, 1);
                await deleteImageFileIfLocal(removed?.url);
                if (!message.extra.media.length) {
                    message.extra.media_index = 0;
                    message.extra.inline_image = false;
                } else {
                    message.extra.media_index = Math.min(index, message.extra.media.length - 1);
                }
                if ($mesEl.length) ctx2.appendMediaToMessage(message, $mesEl, "keep");
            }

            if (hasDisplayImage) {
                // โหมด display-only — ลบไฟล์จริง + เอา display_text ออกให้กลับไปโชว์ .mes เดิม
                await deleteImageFileIfLocal(message.extra.scene_captured?.imageUrl);
                delete message.extra.display_text;
                if ($mesEl.length) ctx2.updateMessageBlock(mesId, message);
            }

            if (message.extra.scene_captured) message.extra.scene_captured.imageUrl = null;
            await ctx2.saveChat();
            refreshMesButtonsFor(mesId);
            toastr.success("ลบรูปแล้ว", "Scene Captured");
        });

        $(document).on("click", "#scap-float-btn", function (e) {
            e.stopPropagation();
            if (!pendingSelection) return;
            const { text, mesId } = pendingSelection;
            window.getSelection()?.removeAllRanges();
            hideFloatButton();
            captureFlow(text, mesId);
        });

        $(document).on("mouseup", "#chat", () => {
            // หน่วงเฟรมเดียวให้ browser อัปเดต selection ให้เสร็จก่อนอ่านค่า
            setTimeout(handleChatSelectionChange, 0);
        });

        $(document).on("keyup", "#chat", (e) => {
            if (e.shiftKey || e.key === "Shift") setTimeout(handleChatSelectionChange, 0);
        });

        $(document).on("mousedown", (e) => {
            if ($floatBtn && !$(e.target).closest("#scap-float-btn").length) hideFloatButton();
        });

        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
