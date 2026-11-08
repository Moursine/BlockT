const categoryBlocks = {
  events: [{ label: "When run", detail: "Start when the flow runs", color: "events", trigger: true }, { label: "When key pressed", detail: "Start when a key is pressed", color: "events", trigger: true, value: "Space" }, { label: "When window focused", detail: "Start when a window becomes active", color: "events", trigger: true, value: "Any window" }, { label: "When timer ends", detail: "Start after a delay", color: "events", trigger: true, value: "5 seconds" }],
  files: [{ label: "Open program", detail: "Launch an application", color: "files" }, { label: "Open file", detail: "Open a document or folder", color: "files" }, { label: "Save active file", detail: "Save the current window", color: "files" }],
  system: [{ label: "Wait", detail: "Pause the flow", color: "system" }, { label: "Run command", detail: "Run a shell command", color: "system" }, { label: "Show notification", detail: "Display a desktop message", color: "system" }],
  input: [{ label: "Type text", detail: "Enter text at the cursor", color: "input" }, { label: "Press key", detail: "Send a keyboard command", color: "input" }, { label: "Click mouse", detail: "Click at a screen position", color: "input" }, { label: "Move mouse", detail: "Move the cursor to a position", color: "input" }, { label: "Move mouse relative", detail: "Move from the screen center by direction and pixels", color: "input" }],
  detection: [{ label: "Detect screen color", detail: "Drop into an If or While condition", color: "detection", kind: "detection" }, { label: "Detect screen text", detail: "True when the area contains the words", color: "detection", kind: "detection" }],
  loops: [{ label: "Repeat", detail: "Container with a nested body", color: "loops", kind: "repeat" }, { label: "If", detail: "Run actions when a condition is true", color: "loops", kind: "if" }, { label: "If / else", detail: "Choose between two branches", color: "loops", kind: "ifElse" }, { label: "While condition", detail: "Loop while a condition is true", color: "loops", kind: "while" }, { label: "Only in app", detail: "Run the inner blocks only while this app is active", color: "loops", kind: "scope" }],
  variables: [{ label: "Set variable", detail: "Store a value", color: "variables" }, { label: "Random variable", detail: "Store a random number between two values", color: "variables" }, { label: "Change variable", detail: "Increase or decrease", color: "variables" }],
  functions: []
};
const colors = { events: "lime", files: "blue", system: "blue", input: "lime", loops: "orange", detection: "teal", variables: "purple", functions: "purple" };
const defaults = { "Open program": "C:\\Program Files\\App\\app.exe", "Open file": "C:\\Documents\\file.txt", Wait: "1 second", "Type text": "Hello world", "Press key": "{\"key\":\"Enter\",\"holdMs\":0}", "Click mouse": "{\"x\":640,\"y\":360,\"button\":\"left\",\"atCursor\":false,\"holdMs\":0}", "Move mouse": "{\"x\":640,\"y\":360,\"mode\":\"instant\",\"duration\":300}", "Move mouse relative": "{\"direction\":\"right\",\"pixels\":100,\"duration\":300}", Repeat: "3 times", If: "isRunning", "If / else": "isRunning", "Detect screen color": "{\"x1\":0,\"y1\":0,\"x2\":100,\"y2\":100,\"color\":\"#FF0000\",\"tolerance\":20}", "Detect screen text": "{\"x1\":0,\"y1\":0,\"x2\":300,\"y2\":100,\"mode\":\"text\",\"text\":\"\"}", "While condition": "isRunning", "Only in app": "notepad.exe", "Set variable": "name = value", "Random variable": "roll = 1 to 6", "Change variable": "count + 1" };
const uid = () => crypto.randomUUID();
const action = (label, color, value = defaults[label] || "") => ({ id: uid(), label, color, value });
const container = (label, kind, value = defaults[label]) => ({ id: uid(), label, color: "loops", kind, value, condition: null, children: [], elseChildren: kind === "ifElse" ? [] : undefined });
const trigger = (label = "When run", value = "") => ({ label, value });

let scripts = [];
let selectedCategory = "files";
let selectedScriptId = null;
let selectedBlockId = null;
let freeBlocks = [];
let variables = [];
let functions = [];
let history = [];
let redoHistory = [];
let pan = { x: 0, y: 0 };
let zoom = 1;
let suppressBlockClick = false;
let macroRunning = false;
const detectionNextPoints = new Map();
let activeDetectionEditor = null;
const workspace = document.querySelector("#workspace");
const board = document.querySelector("#scriptBoard");
const palette = document.querySelector("#blockPalette");
const toast = document.querySelector("#toast");
const codeView = document.querySelector("#codeView");
const codeEditor = document.querySelector("#codeEditor");
const confirmDialog = document.querySelector("#confirmDialog");
const settingsDialog = document.querySelector("#settingsDialog");
const functionDialog = document.querySelector("#functionDialog");
const aiDialog = document.querySelector("#aiDialog");
const blockContextMenu = document.querySelector("#blockContextMenu");
const runShortcutInput = document.querySelector("#runShortcutInput");
const shortcutMessage = document.querySelector("#shortcutMessage");
const dragPreview = document.querySelector("#dragPreview");
const stopButton = document.querySelector("#stopButton");
let pendingDeleteScriptId = null;
let blockClipboard = null;
let stateLoaded = false;
let macros = [];
let activeMacroId = null;
let codeDirty = false;
let pendingAppPickerBlockId = null;

function snapshot() { history.push(structuredClone({ scripts, freeBlocks, variables, functions, selectedScriptId, selectedBlockId, pan, zoom })); if (history.length > 100) history.shift(); redoHistory = []; }
function documentFingerprint(state) { return JSON.stringify({ scripts: state.scripts, freeBlocks: state.freeBlocks, variables: state.variables, functions: state.functions }); }
function stepHistory(from, to, emptyMessage) {
  const current = structuredClone({ scripts, freeBlocks, variables, functions, selectedScriptId, selectedBlockId, pan, zoom });
  while (from.length) {
    const state = from.pop();
    if (documentFingerprint(state) === documentFingerprint(current)) continue;
    to.push(current);
    const view = { pan, zoom };
    restore(state);
    ({ pan, zoom } = view);
    selectedBlockId = null;
    codeDirty = false;
    renderWorkspace();
    return true;
  }
  showToast(emptyMessage);
  return false;
}
function undo() { return stepHistory(history, redoHistory, "Nothing to undo"); }
function redo() { return stepHistory(redoHistory, history, "Nothing to redo"); }
function restore(state) { ({ scripts, freeBlocks = [], variables = [], functions = [], selectedScriptId, selectedBlockId, pan, zoom } = state); }
function macroDocument() { return structuredClone({ scripts, freeBlocks, variables, functions, selectedScriptId, selectedBlockId, pan, zoom }); }
function applyMacroDocument(document) { restore(structuredClone(document)); history = []; redoHistory = []; }
function activeMacro() { return macros.find((macro) => macro.id === activeMacroId) || null; }
function syncActiveMacro() { const macro = activeMacro(); if (macro) macro.document = macroDocument(); }
function commitDirtyCode() {
  if (!codeDirty) return true;
  try { parseCode(); codeDirty = false; return true; }
  catch (error) { showToast(error.message || "Fix the Code view before switching flows"); return false; }
}
function macroState() { syncActiveMacro(); return { version: 2, macros, activeMacroId }; }
function persistMacroStateNow() { const save = window.macroStudio?.saveMacroState?.(macroState()); return save?.catch(() => showToast("Could not save flow state")); }
function persistMacroState() { if (!stateLoaded) return; clearTimeout(persistMacroState.timer); persistMacroState.timer = setTimeout(() => persistMacroStateNow(), 120); }
function updateBoardTransform() { board.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; }
function showToast(message) { toast.textContent = message; toast.classList.add("visible"); clearTimeout(showToast.timeout); showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 2200); }
function renderMacroLibrary() {
  const list = document.querySelector("#macroLibraryList");
  const recent = [...macros].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)).slice(0, 3);
  list.innerHTML = recent.length ? recent.map((macro) => `<button class="macro-name ${macro.id === activeMacroId ? "selected" : ""}" data-macro-id="${macro.id}">${macro.name.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</button>`).join("") : '<p class="macro-library-empty">No saved flows</p>';
  list.querySelectorAll("[data-macro-id]").forEach((button) => button.addEventListener("click", () => selectMacro(button.dataset.macroId)));
  document.querySelector("#macroTitle").textContent = (activeMacro()?.name || "Untitled flow").toUpperCase();
}
function renderFlowLibrary() {
  const list = document.querySelector("#flowLibraryList");
  const ordered = [...macros].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  list.innerHTML = ordered.length ? ordered.map((macro) => `<button class="flow-library-item ${macro.id === activeMacroId ? "selected" : ""}" data-flow-id="${macro.id}"><strong>${macro.name.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</strong><small>${macro.id === activeMacroId ? "Open now" : "Open flow"}</small></button>`).join("") : '<p class="macro-library-empty">No saved flows yet.</p>';
  list.querySelectorAll("[data-flow-id]").forEach((button) => button.addEventListener("click", () => { selectMacro(button.dataset.flowId); document.querySelector("#flowLibraryDialog").hidden = true; }));
}
function selectMacro(id) {
  const macro = macros.find((item) => item.id === id);
  if (!macro || macro.id === activeMacroId) return;
  if (!commitDirtyCode()) return;
  syncActiveMacro();
  activeMacroId = macro.id;
  applyMacroDocument(macro.document);
  codeDirty = false;
  renderWorkspace();
  showToast(`${macro.name} opened`);
}
function clearCurrentMacro() {
  scripts = []; freeBlocks = []; variables = []; functions = []; history = []; redoHistory = []; selectedScriptId = null; selectedBlockId = null; pan = { x: 0, y: 0 }; zoom = 1;
}
function saveNamedMacro(name) {
  const safeName = String(name || "").trim();
  if (!safeName) return;
  const duplicate = macros.find((macro) => macro.name.toLowerCase() === safeName.toLowerCase() && macro.id !== activeMacroId);
  if (duplicate) return showToast("A flow with that name already exists");
  const existing = activeMacro();
  if (existing) { existing.name = safeName; existing.updatedAt = Date.now(); }
  else { const macro = { id: uid(), name: safeName, updatedAt: Date.now(), document: macroDocument() }; macros.push(macro); activeMacroId = macro.id; }
  syncActiveMacro();
  renderMacroLibrary();
  persistMacroStateNow();
  showToast(`${safeName} saved`);
}
async function runScripts() {
  if (macroRunning) return stopRunningMacro();
  const status = document.querySelector("#runStatus");
  const runnableScripts = scripts.filter((script) => script.runnable);
  if (!runnableScripts.length) return showToast("Add an Event block before running a flow");
  if (!window.macroStudio?.runMacros) return showToast("Run flows from the BlockT desktop app");
  macroRunning = true;
  stopButton.hidden = false;
  stopButton.disabled = false;
  stopButton.textContent = "Stop";
  status.textContent = "RUNNING";
  try {
    const result = await window.macroStudio.runMacros(runnableScripts);
    status.textContent = "COMPLETE";
    const skipped = result.skipped.length ? `; skipped ${[...new Set(result.skipped)].join(", ")}` : "";
    showToast(`${result.completed} action${result.completed === 1 ? "" : "s"} completed${skipped}`);
  } catch (error) {
    const stopped = error.message === "Macro stopped";
    status.textContent = stopped ? "STOPPED" : "ERROR";
    showToast(stopped ? "Macro stopped" : error.message || "Macro stopped with an error");
  } finally {
    macroRunning = false;
    stopButton.hidden = true;
  }
}
async function stopRunningMacro() {
  if (!macroRunning) return;
  stopButton.disabled = true;
  stopButton.textContent = "Stopping...";
  document.querySelector("#runStatus").textContent = "STOPPING";
  await window.macroStudio?.stopMacro?.();
}
function shortcutFromEvent(event) {
  const functionKey = /^F(?:[1-9]|1[0-2])$/.test(event.key) ? event.key : "";
  const letterOrDigit = /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : "";
  const key = functionKey || letterOrDigit;
  if (!key) return null;
  const modifiers = [event.ctrlKey && "Control", event.shiftKey && "Shift", event.altKey && "Alt"].filter(Boolean);
  return [...modifiers, key].join("+");
}
function countBlocks(blocks) { return blocks.reduce((count, block) => count + 1 + (block.children ? countBlocks(block.children) : 0) + (block.elseChildren ? countBlocks(block.elseChildren) : 0), 0); }
function selectedScript() { return scripts.find((script) => script.id === selectedScriptId) || scripts[0]; }
function makeBlock(raw) { return ["repeat", "if", "ifElse", "while", "scope"].includes(raw.kind) ? container(raw.label, raw.kind) : { ...action(raw.label, raw.color, raw.value || defaults[raw.label] || ""), kind: raw.kind }; }
function cloneBlocks(blocks) { return structuredClone(blocks).map((block) => { block.id = uid(); if (block.children) block.children = cloneBlocks(block.children); if (block.elseChildren) block.elseChildren = cloneBlocks(block.elseChildren); return block; }); }
function functionCall(definition) { return { id: uid(), label: definition.name, color: "functions", kind: "function", children: cloneBlocks(definition.blocks) }; }
function createTriggerScript(raw, x, y) { return { id: uid(), x, y, runnable: true, trigger: trigger(raw.label, raw.value || ""), blocks: [] }; }
function renderPalette(filter = "") {
  if (selectedCategory === "functions") {
    const matches = functions.filter((definition) => definition.name.toLowerCase().includes(filter.toLowerCase()));
    palette.innerHTML = matches.length ? matches.map((definition) => `<button class="palette-block function-reporter" data-function-id="${definition.id}" style="color:var(--purple)">${definition.name}<small>${countBlocks(definition.blocks)} saved block${countBlocks(definition.blocks) === 1 ? "" : "s"}</small></button>`).join("") : '<p class="palette-hint">Select a block sequence, then use the function button in the toolbar.</p>';
    document.querySelectorAll("[data-function-id]").forEach((element) => element.addEventListener("click", () => { const definition = functions.find((item) => item.id === element.dataset.functionId); if (definition) insertBlock(functionCall(definition)); }));
    return;
  }
  const matches = categoryBlocks[selectedCategory].filter((block) => block.label.toLowerCase().includes(filter.toLowerCase()));
  const variableCreator = selectedCategory === "variables" ? `<form class="variable-create" id="variableCreate"><input id="variableName" maxlength="30" placeholder="Variable name" aria-label="Variable name" /><button type="submit">+</button></form>${variables.map((name) => `<button class="palette-block variable-reporter" data-label="Set variable" data-color="variables" data-value="${name} = value" style="color:var(--purple)">${name}<small>Set ${name}</small></button><button class="palette-block variable-reporter" data-label="Random variable" data-color="variables" data-value="${name} = 1 to 6" style="color:var(--purple)">Random ${name}<small>Set ${name} to a random number</small></button><button class="palette-block variable-reporter" data-label="Change variable" data-color="variables" data-value="${name} + 1" style="color:var(--purple)">Change ${name}<small>Increase or decrease ${name}</small></button>`).join("")}` : "";
  palette.innerHTML = `${variableCreator}${matches.map((block) => `<button class="palette-block" data-label="${block.label}" data-color="${block.color}" data-kind="${block.kind || ""}" data-trigger="${block.trigger || false}" data-value="${block.value || ""}" style="color:var(--${colors[block.color]})">${block.label}<small>${block.detail}</small></button>`).join("")}`;
  document.querySelectorAll(".palette-block").forEach((element) => {
    const raw = { label: element.dataset.label, color: element.dataset.color, kind: element.dataset.kind || undefined, trigger: element.dataset.trigger === "true", value: element.dataset.value || "" };
    bindPaletteDrag(element, raw);
    element.addEventListener("click", () => { if (element.dataset.justDragged) { delete element.dataset.justDragged; return; } if (raw.trigger) { snapshot(); scripts.push(createTriggerScript(raw, 150 - pan.x, 100 - pan.y)); selectedScriptId = scripts.at(-1).id; renderWorkspace(); } else insertBlock(makeBlock(raw)); });
  });
  document.querySelector("#variableCreate")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#variableName").value.trim().replace(/\s+/g, "_");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return showToast("Use a name beginning with a letter or underscore");
    if (variables.includes(name)) return showToast("That variable already exists");
    snapshot(); variables.push(name); persistMacroState(); renderPalette(); showToast(`${name} added to Variables`);
  });
}
function detectionValue(value) { try { return { x1: 0, y1: 0, x2: 100, y2: 100, color: "#FF0000", tolerance: 20, ...JSON.parse(value) }; } catch { return { x1: 0, y1: 0, x2: 100, y2: 100, color: "#FF0000", tolerance: 20 }; } }
function detectionEditor(value, ownerId, condition = false) { const detector = detectionValue(value); const data = condition ? `data-condition-id="${ownerId}"` : `data-value-id="${ownerId}"`; const corners = `<input class="detection-coordinates" data-detection-point="start" value="${detector.x1}, ${detector.y1}" readonly aria-label="First detection corner; press F9 to capture" /><input class="detection-coordinates" data-detection-point="end" value="${detector.x2}, ${detector.y2}" readonly aria-label="Second detection corner; press F9 to capture" />`; if (detector.mode === "text") return `<span class="detection-editor detection-text-editor" ${data} tabindex="0">${corners}<input class="detection-text" value="${String(detector.text ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}" placeholder="words to find" aria-label="Words to detect in the area" /></span>`; const swatches = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#FFFFFF", "#000000"].map((color) => `<button type="button" class="detection-swatch" data-color="${color}" style="background:${color}" aria-label="Use ${color}"></button>`).join(""); return `<span class="detection-editor" ${data} tabindex="0">${corners}<button type="button" class="detection-color-button" style="--picked-color:${detector.color}" aria-label="Open color palette"></button><span class="detection-palette" hidden>${swatches}<button type="button" class="detection-screen-color">F9 screen</button></span><input class="detection-hex" value="${detector.color}" aria-label="Detection hex color" /><label class="detection-tolerance">match <input class="detection-range" type="range" min="0" max="255" value="${detector.tolerance}" /><output>${detector.tolerance}</output></label></span>`; }
function pressKeyValue(value) {
  try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && "key" in parsed) return { key: String(parsed.key || ""), holdMs: Math.max(0, Math.round(Number(parsed.holdMs) || 0)) }; } catch {}
  return { key: String(value || ""), holdMs: 0 };
}
function pressKeyEditor(value, id) {
  const press = pressKeyValue(value);
  return `<span class="press-key-editor" data-value-id="${id}" tabindex="0"><input class="block-field key-capture" value="${press.key.replaceAll('"', "&quot;")}" readonly aria-label="Press key; focus this field and press the key to capture" /><input class="block-field press-key-hold" type="number" min="0" step="50" value="${press.holdMs}" aria-label="Hold duration in milliseconds; 0 is a quick tap" /><span class="field-unit">ms hold</span></span>`;
}
function updatePressKeyEditor(editor, mutate) {
  const owner = editor.dataset.valueId;
  const next = mutate(pressKeyValue(findBlockValue(owner)));
  setBlockValue(owner, JSON.stringify(next));
  return next;
}
function moveMouseValue(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0, mode: parsed.mode === "smooth" ? "smooth" : "instant", duration: Math.max(0, Math.round(Number(parsed.duration) || 300)) };
  } catch {}
  return { x: 640, y: 360, mode: "instant", duration: 300 };
}
function moveMouseEditor(value, id) {
  const move = moveMouseValue(value);
  return `<span class="move-mouse-editor" data-value-id="${id}" tabindex="0"><input class="block-field move-position coordinate-capture" value="${move.x}, ${move.y}" readonly aria-label="Move mouse position; press F9 to capture" /><select class="block-field move-mode" aria-label="Move mode"><option value="instant" ${move.mode === "instant" ? "selected" : ""}>instantly</option><option value="smooth" ${move.mode === "smooth" ? "selected" : ""}>smoothly over</option></select>${move.mode === "smooth" ? `<input class="block-field move-duration" type="number" min="0" step="50" value="${move.duration}" aria-label="Glide duration in milliseconds" /><span class="field-unit">ms</span>` : ""}</span>`;
}
function updateMoveMouseEditor(editor, mutate) {
  const owner = editor.dataset.valueId;
  const next = mutate(moveMouseValue(findBlockValue(owner)));
  setBlockValue(owner, JSON.stringify(next));
  return next;
}
const relativeDirections = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"];
function relativeMoveValue(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return { direction: relativeDirections.includes(parsed.direction) ? parsed.direction : "right", pixels: Math.max(0, Math.round(Number(parsed.pixels) || 0)), duration: Math.max(0, Math.round(Number(parsed.duration) || 0)) };
  } catch {}
  return { direction: "right", pixels: 100, duration: 300 };
}
function relativeMoveEditor(value, id) {
  const move = relativeMoveValue(value);
  return `<span class="relative-move-editor" data-value-id="${id}" tabindex="0"><button type="button" class="relative-move-capture" aria-label="Pick a target from the screen center with F9">F9 target</button><select class="block-field relative-move-direction" aria-label="Relative mouse direction">${relativeDirections.map((direction) => `<option value="${direction}" ${move.direction === direction ? "selected" : ""}>${direction}</option>`).join("")}</select><input class="block-field relative-move-pixels" type="number" min="0" step="1" value="${move.pixels}" aria-label="Relative movement in pixels" /><span class="field-unit">px</span><input class="block-field relative-move-duration" type="number" min="0" step="50" value="${move.duration}" aria-label="Movement duration in milliseconds" /><span class="field-unit">ms</span></span>`;
}
function updateRelativeMoveEditor(editor, mutate) {
  const owner = editor.dataset.valueId;
  const next = mutate(relativeMoveValue(findBlockValue(owner)));
  setBlockValue(owner, JSON.stringify(next));
  return next;
}
function clickMouseValue(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0,     button: parsed.button === "right" ? "right" : "left", atCursor: Boolean(parsed.atCursor), holdMs: Math.max(0, Math.round(Number(parsed.holdMs) || 0)) };
  } catch {}
  const [legacyX, legacyY] = String(value || "").split(",").map((part) => Number(part.trim()));
      return { x: Number.isFinite(legacyX) ? legacyX : 640, y: Number.isFinite(legacyY) ? legacyY : 360, button: "left", atCursor: false, holdMs: 0 };
}
function clickMouseEditor(value, id) {
  const click = clickMouseValue(value);
  const position = click.atCursor ? "" : `<input class="block-field click-position coordinate-capture" value="${click.x}, ${click.y}" readonly aria-label="Click position; press F9 to capture" />`;
  return `<span class="click-mouse-editor" data-value-id="${id}" tabindex="0">${position}<select class="block-field click-button" aria-label="Mouse button"><option value="left" ${click.button === "left" ? "selected" : ""}>left</option><option value="right" ${click.button === "right" ? "selected" : ""}>right</option></select><label class="click-at-cursor-label"><input class="click-at-cursor" type="checkbox" ${click.atCursor ? "checked" : ""} aria-label="Click at the cursor's current position instead of a fixed spot" /><span class="field-unit">here</span></label><input class="block-field click-hold" type="number" min="0" step="50" value="${click.holdMs}" aria-label="Hold duration in milliseconds; 0 is a quick click" /><span class="field-unit">ms hold</span></span>`;
}
function updateClickMouseEditor(editor, mutate) {
  const owner = editor.dataset.valueId;
  const next = mutate(clickMouseValue(findBlockValue(owner)));
  setBlockValue(owner, JSON.stringify(next));
  return next;
}
function scopeEditor(value, id) { return `<span class="scope-editor"><input class="block-field" data-value-id="${id}" value="${value.replaceAll('"', "&quot;")}" readonly aria-label="Selected active app" /><button class="scope-app-picker" type="button" data-scope-id="${id}">Choose app</button></span>`; }
async function openAppPicker() {
  const list = document.querySelector("#openAppsList");
  document.querySelector("#appPickerDialog").hidden = false;
  list.innerHTML = '<p class="macro-library-empty">Loading open apps...</p>';
  try {
    const apps = await window.macroStudio?.getOpenApps?.();
    list.innerHTML = apps?.length ? apps.map((app) => `<button type="button" class="open-app-item" data-app-name="${app.executable.replaceAll('"', "&quot;")}"><strong>${app.executable}</strong><small>${app.title.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</small></button>`).join("") : '<p class="macro-library-empty">No visible desktop apps found. Refresh after opening one.</p>';
    list.querySelectorAll("[data-app-name]").forEach((button) => button.addEventListener("click", () => {
      if (!pendingAppPickerBlockId) return;
      snapshot();
      setBlockValue(pendingAppPickerBlockId, button.dataset.appName);
      pendingAppPickerBlockId = null;
      document.querySelector("#appPickerDialog").hidden = true;
      renderWorkspace();
      showToast(`Only in app set to ${button.dataset.appName}`);
    }));
  } catch (error) { list.innerHTML = `<p class="macro-library-empty">${error.message || "Could not list open apps"}</p>`; }
}
function field(block) { if (block.kind === "detection") return detectionEditor(block.value, block.id); if (block.label === "Press key") return pressKeyEditor(block.value, block.id); if (block.label === "Move mouse") return moveMouseEditor(block.value, block.id); if (block.label === "Move mouse relative") return relativeMoveEditor(block.value, block.id); if (block.label === "Click mouse") return clickMouseEditor(block.value, block.id); if (block.kind === "scope") return scopeEditor(block.value, block.id); return block.value ? `<input class="block-field" data-value-id="${block.id}" value="${block.value.replaceAll('"', "&quot;")}" aria-label="Edit ${block.label}" />` : ""; }
function conditionField(block) { return block.condition?.kind === "detection" ? detectionEditor(block.condition.value, block.id, true) : `<input class="block-field condition-input" data-condition-target="${block.id}" data-condition-value-id="${block.id}" value="${block.value.replaceAll('"', "&quot;")}" aria-label="Edit ${block.label} condition" />`; }
function renderBlock(block, scriptId, path, branch = "main") {
  const selected = block.id === selectedBlockId ? "selected-block" : "";
  const key = JSON.stringify({ scriptId, path, branch }).replaceAll('"', "&quot;");
  if (!block.children) return `<div class="macro-block ${block.color} ${selected}" data-block-id="${block.id}" data-path="${key}"><span class="block-notch top"></span><span class="block-text">${block.label} ${field(block)}</span><span class="block-notch bottom"></span></div>`;
  const type = block.kind === "ifElse" ? "if" : "loop";
  const mainDrop = `${key}`;
  const elseDrop = JSON.stringify({ scriptId, path, branch: "else" }).replaceAll('"', "&quot;");
  return `<div class="container-block ${type} ${block.color} ${selected}" data-block-id="${block.id}" data-path="${key}"><div class="container-head"><span>${block.label} ${["if", "ifElse", "while"].includes(block.kind) ? conditionField(block) : field(block)}</span></div><div class="container-body drop-zone" data-insert="${mainDrop}">${block.children.map((child, index) => renderBlock(child, scriptId, [...path, index])).join("")}<div class="nest-label">drop blocks inside</div></div>${block.elseChildren ? `<div class="else-label">else</div><div class="container-body drop-zone else-body" data-insert="${elseDrop}">${block.elseChildren.map((child, index) => renderBlock(child, scriptId, [...path, index], "else")).join("")}<div class="nest-label">drop blocks inside else</div></div>` : ""}<div class="container-foot"></div></div>`;
}
function renderFreeItemBlock(block, groupId, groupIndex = "") {
  const selected = block.id === selectedBlockId ? "selected-block" : "";
  const source = groupIndex === "" ? "" : `data-free-index="${groupIndex}"`;
  if (!block.children) return `<div class="macro-block ${block.color} ${selected}" data-block-id="${block.id}" data-free-block-id="${groupId}" ${source}><span class="block-notch top"></span><span class="block-text">${block.label} ${field(block)}</span><span class="block-notch bottom"></span></div>`;
  const type = block.kind === "ifElse" ? "if" : "loop";
  return `<div class="container-block ${type} ${block.color} ${selected}" data-block-id="${block.id}" data-free-block-id="${groupId}" ${source}><div class="container-head"><span>${block.label} ${["if", "ifElse", "while"].includes(block.kind) ? conditionField(block) : field(block)}</span></div><div class="container-body">${block.children.map((child) => renderFreeItemBlock(child, groupId)).join("")}</div>${block.elseChildren ? `<div class="else-label">else</div><div class="container-body else-body">${block.elseChildren.map((child) => renderFreeItemBlock(child, groupId)).join("")}</div>` : ""}<div class="container-foot"></div></div>`;
}
function renderFreeBlock(item) { return `<div class="free-block free-drop-zone" data-free-insert="${item.id}" style="left:${item.x}px;top:${item.y}px">${item.blocks.map((block, index) => renderFreeItemBlock(block, item.id, index)).join("")}</div>`; }
function renderWorkspace() {
  updateBoardTransform();
  board.innerHTML = `${scripts.map((script, index) => `<section class="script-stack ${script.id === selectedScriptId ? "selected-script" : ""} ${script.runnable ? "runnable-script" : "detached-script"}" data-script-id="${script.id}" style="left:${script.x}px;top:${script.y}px"><button class="stack-title" data-select-script="${script.id}"><span class="drag-handle">⠿</span> Script ${index + 1}</button>${script.runnable ? `<div class="trigger-block">${script.trigger?.label || "When run"}${script.trigger?.value ? `<span>${script.trigger.value}</span>` : ""}</div>` : '<div class="detached-label">detached - not run</div>'}<div class="stack-body drop-zone" data-insert="${JSON.stringify({ scriptId: script.id, path: [], branch: "main" }).replaceAll('"', "&quot;")}">${script.blocks.map((block, blockIndex) => renderBlock(block, script.id, [blockIndex])).join("")}<div class="stack-insert">drop to add</div></div></section>`).join("")}${freeBlocks.map(renderFreeBlock).join("")}`;
  workspace.classList.toggle("has-scripts", scripts.length > 0);
  document.querySelector("#stepCount").textContent = `${scripts.reduce((total, script) => total + countBlocks(script.blocks), 0) + freeBlocks.reduce((total, item) => total + countBlocks(item.blocks), 0)} BLOCKS / ${scripts.length} SCRIPTS`;
  renderMacroLibrary();
  bindBoardEvents();
  persistMacroState();
  refreshCodeViewIfVisible();
}
function refreshCodeViewIfVisible() {
  if (codeView.hidden || codeDirty) return;
  const script = selectedScript();
  document.querySelector("#codeScriptTitle").textContent = script ? `script-${scripts.indexOf(script) + 1}.js` : "no-script.js";
  codeEditor.value = script ? scriptToCode(script) : "";
}
function decode(value) { return JSON.parse(value.replaceAll("&quot;", '"')); }
function blockList(target) {
  if (target.freeId) return freeBlocks.find((item) => item.id === target.freeId)?.blocks || [];
  const script = scripts.find((item) => item.id === target.scriptId);
  let blocks = script.blocks;
  for (const index of target.path.slice(0, -1)) blocks = blocks[index].children;
  if (target.path.length) { const parent = blocks[target.path.at(-1)]; return target.branch === "else" ? parent.elseChildren : parent.children; }
  return blocks;
}
function deleteAt(target) { const script = scripts.find((item) => item.id === target.scriptId); let list = script.blocks; for (let depth = 0; depth < target.path.length - 1; depth += 1) list = list[target.path[depth]].children; if (target.path.length) list.splice(target.path.at(-1), 1); }
function listAt(target) {
  const script = scripts.find((item) => item.id === target.scriptId);
  let list = script.blocks;
  for (let depth = 0; depth < target.path.length - 1; depth += 1) {
    const parent = list[target.path[depth]];
    list = target.branch === "else" && depth === target.path.length - 2 ? parent.elseChildren : parent.children;
  }
  return list;
}
function findBlockLocation(blockId, blocks, scriptId, path = [], branch = "main") {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.id === blockId) return { scriptId, path: [...path, index], branch, list: blocks, index };
    const nested = block.children && findBlockLocation(blockId, block.children, scriptId, [...path, index], "main");
    const alternate = block.elseChildren && findBlockLocation(blockId, block.elseChildren, scriptId, [...path, index], "else");
    if (nested || alternate) return nested || alternate;
  }
  return null;
}
function selectedStackLocation() {
  for (const script of scripts) {
    const location = findBlockLocation(selectedBlockId, script.blocks, script.id);
    if (location) return location;
  }
  for (const freeBlock of freeBlocks) {
    const location = findBlockLocation(selectedBlockId, freeBlock.blocks, null);
    if (location) return { ...location, freeId: freeBlock.id };
  }
  return null;
}
function openFunctionDialog() {
  if (!selectedBlockId) return showToast("Select the first block to save as a function");
  const location = selectedStackLocation();
  if (!location) return showToast("Select the first block in a stack");
  const count = location.list.length - location.index;
  document.querySelector("#functionDescription").textContent = `The selected block and ${count === 1 ? "no block" : `${count - 1} block${count === 2 ? "" : "s"} below it`} will become one reusable function.`;
  const input = document.querySelector("#functionNameInput");
  input.value = "";
  functionDialog.hidden = false;
  input.focus();
}
function saveSelectedFunction(name) {
  const location = selectedStackLocation();
  if (!location) return showToast("Select the first block in a stack");
  const safeName = String(name || "").trim();
  if (!safeName) return;
  if (functions.some((definition) => definition.name.toLowerCase() === safeName.toLowerCase())) return showToast("A function with that name already exists");
  snapshot();
  const definition = { id: uid(), name: safeName, blocks: cloneBlocks(location.list.slice(location.index)) };
  functions.push(definition);
  location.list.splice(location.index, location.list.length - location.index, functionCall(definition));
  selectedBlockId = location.list[location.index].id;
  selectedCategory = "functions";
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.category === "functions"));
  document.querySelector("#categoryTitle").textContent = "Functions";
  renderPalette();
  renderWorkspace();
  showToast(`${safeName} saved as a function`);
}
function copySelectedStack() {
  const location = selectedStackLocation();
  if (!location) return showToast("Select a block to copy");
  blockClipboard = cloneBlocks(location.list.slice(location.index));
  showToast(`${blockClipboard.length} block${blockClipboard.length === 1 ? "" : "s"} copied`);
}
function pasteBelowSelectedBlock() {
  if (!blockClipboard?.length) return showToast("Copy a block stack first");
  const location = selectedStackLocation();
  if (!location) return showToast("Select a block to paste below");
  snapshot();
  const pasted = cloneBlocks(blockClipboard);
  location.list.splice(location.index + 1, 0, ...pasted);
  selectedBlockId = pasted[0].id;
  renderWorkspace();
  showToast("Stack pasted below selected block");
}
function deleteContextBlock() {
  if (!selectedBlockId) return;
  snapshot();
  if (deleteSelectedBlock(selectedBlockId)) { selectedBlockId = null; renderWorkspace(); showToast("Block deleted"); }
}
function showBlockContextMenu(event, blockId, path) {
  event.preventDefault();
  selectedBlockId = blockId;
  if (path) selectedScriptId = decode(path).scriptId;
  blockContextMenu.hidden = false;
  blockContextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 178)}px`;
  blockContextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 170)}px`;
}
function hideBlockContextMenu() { blockContextMenu.hidden = true; }
function moveBlockStack(source, target, insertIndex) {
  const sourceList = listAt(source);
  const sourceIndex = source.path.at(-1);
  const moved = sourceList.splice(sourceIndex);
  const destination = blockList(target);
  if (sourceList === destination && sourceIndex < insertIndex) insertIndex -= moved.length;
  destination.splice(insertIndex, 0, ...moved);
}
function moveFreeBlockToRail(freeId, target, insertIndex) {
  const source = freeBlocks.find((item) => item.id === freeId);
  if (!source) return;
  const sourceIndex = Number.isInteger(target.sourceIndex) ? target.sourceIndex : 0;
  const moved = source.blocks.splice(sourceIndex);
  const destination = blockList(target);
  if (destination === source.blocks && sourceIndex < insertIndex) insertIndex -= moved.length;
  destination.splice(insertIndex, 0, ...moved);
  if (!source.blocks.length) freeBlocks = freeBlocks.filter((item) => item !== source);
}
function moveBlockToCanvas(source, x, y) {
  if (source.freeId) {
    const item = freeBlocks.find((freeBlock) => freeBlock.id === source.freeId);
    if (!item) return;
    const index = Number.isInteger(source.sourceIndex) ? source.sourceIndex : 0;
    if (index === 0) { item.x = x; item.y = y; return; }
    freeBlocks.push({ id: uid(), blocks: item.blocks.splice(index), x, y });
    return;
  }
  const blocks = listAt(source).splice(source.path.at(-1));
  freeBlocks.push({ id: uid(), blocks, x, y });
}
function deleteSelectedBlock(id) {
  for (const script of scripts) if (removeBlock(script.blocks, id)) return true;
  for (let groupIndex = freeBlocks.length - 1; groupIndex >= 0; groupIndex -= 1) {
    if (removeBlock(freeBlocks[groupIndex].blocks, id)) {
      if (!freeBlocks[groupIndex].blocks.length) freeBlocks.splice(groupIndex, 1);
      return true;
    }
  }
  return false;
}
function isSourceBoundary(rail, source) {
  const target = decode(rail.dataset.insertTarget);
  if (!source) return false;
  if (source.freeId) return target.freeId === source.freeId && Number(rail.dataset.insertIndex) >= source.sourceIndex;
  const sourceList = listAt(source);
  const destination = blockList(target);
  const index = Number(rail.dataset.insertIndex);
  return sourceList === destination && index >= source.path.at(-1);
}
function findSnapRail(x, y, source = null, excludeRoot = null) {
  const rails = [...document.querySelectorAll(".insertion-rail")].filter((rail) => !isSourceBoundary(rail, source) && !excludeRoot?.contains(rail));
  const railCenter = (rail) => { const rect = rail.getBoundingClientRect(); return rect.top + rect.height / 2; };
  const usable = (rail) => rail && rails.includes(rail) ? rail : null;
  const nearestInZone = (zone) => rails.filter((rail) => rail.parentElement === zone).sort((left, right) => Math.abs(y - railCenter(left)) - Math.abs(y - railCenter(right)))[0] || null;
  const stack = document.elementsFromPoint(x, y);
  const direct = stack.find((item) => item.classList?.contains("insertion-rail") && rails.includes(item));
  if (direct) return direct;
  for (const item of stack) {
    if (item.matches?.(".drop-zone, .free-drop-zone")) {
      const rail = nearestInZone(item);
      if (rail) return rail;
    } else if (item.matches?.(".container-head")) {
      const body = item.parentElement.querySelector(":scope > .container-body");
      const rail = body && !item.parentElement.classList.contains("drag-source") ? usable(body.querySelector(":scope > .insertion-rail")) : null;
      if (rail) return rail;
    } else if (item.matches?.(".else-label")) {
      const rail = usable(item.nextElementSibling?.querySelector(":scope > .insertion-rail"));
      if (rail) return rail;
    } else if (item.matches?.(".macro-block, .container-block") && !item.classList.contains("drag-source")) {
      const blockRect = item.getBoundingClientRect();
      const rail = usable(y < blockRect.top + blockRect.height / 2 ? item.previousElementSibling : item.nextElementSibling);
      if (rail) return rail;
    }
  }
  return rails
    .map((rail) => ({ rail, rect: rail.getBoundingClientRect() }))
    .filter(({ rect }) => x >= rect.left - 80 && x <= rect.right + 80 && Math.abs(y - (rect.top + rect.height / 2)) <= 38)
    .sort((left, right) => Math.abs(y - (left.rect.top + left.rect.height / 2)) - Math.abs(y - (right.rect.top + right.rect.height / 2)))[0]?.rail;
}
function dragGroupElements(element, source) {
  if (source.freeId) {
    const siblings = [...element.closest(".free-block").children].filter((item) => item.matches(".macro-block, .container-block"));
    return siblings.slice(siblings.indexOf(element));
  }
  const siblings = [...element.parentElement.children].filter((item) => item.matches(".macro-block, .container-block"));
  return siblings.slice(siblings.indexOf(element));
}
function createDragGhost(element, source) {
  const ghost = document.createElement("div");
  ghost.className = "pointer-drag-ghost pointer-drag-group";
  dragGroupElements(element, source).forEach((item) => {
    const clone = item.cloneNode(true);
    clone.classList.remove("selected-block", "drag-source");
    clone.querySelectorAll(".insertion-rail").forEach((rail) => rail.remove());
    ghost.append(clone);
  });
  const boardRect = element.closest(".free-block")?.getBoundingClientRect() || element.getBoundingClientRect();
  ghost.style.width = `${boardRect.width / zoom}px`;
  ghost.style.transformOrigin = "0 0";
  ghost.style.transform = `scale(${zoom})`;
  document.body.append(ghost);
  return ghost;
}
function dropPaletteBlock(raw, clientX, clientY) {
  const conditionSlot = raw.kind === "detection" ? document.elementsFromPoint(clientX, clientY).find((element) => element.classList?.contains("condition-input")) : null;
  if (conditionSlot) {
    snapshot();
    setCondition(conditionSlot.dataset.conditionTarget, raw.value || defaults[raw.label]);
    renderWorkspace();
    return;
  }
  const rail = raw.trigger ? null : findSnapRail(clientX, clientY);
  snapshot();
  if (rail) {
    const target = decode(rail.dataset.insertTarget);
    blockList(target).splice(Number(rail.dataset.insertIndex), 0, makeBlock(raw));
  } else {
    const rect = workspace.getBoundingClientRect();
    const x = (clientX - rect.left - pan.x) / zoom;
    const y = (clientY - rect.top - pan.y) / zoom;
    if (raw.trigger) {
      scripts.push(createTriggerScript(raw, x, y));
      selectedScriptId = scripts.at(-1).id;
    } else {
      const block = makeBlock(raw);
      freeBlocks.push({ id: uid(), blocks: [block], x, y });
      selectedBlockId = block.id;
    }
  }
  renderWorkspace();
}
let activeDrag = null;
function cancelActiveDrag() {
  const drag = activeDrag;
  if (!drag) return;
  activeDrag = null;
  drag.dispose();
}
// Drag sessions listen on window so a re-render, lost capture or stray click can never strand a ghost.
function beginPointerDrag(pointerId, { onMove, onDrop, cleanup }) {
  cancelActiveDrag();
  const finish = (event, commit) => {
    if (activeDrag !== drag) return;
    activeDrag = null;
    drag.dispose();
    if (commit) onDrop(event);
  };
  const handlers = {
    pointermove: (event) => {
      if (event.pointerId !== pointerId) return;
      if (event.pointerType === "mouse" && !(event.buttons & 1)) return finish(event, true);
      if (event.pointerType === "mouse" && event.buttons !== 1) return finish(event, false);
      onMove(event);
    },
    pointerup: (event) => { if (event.pointerId === pointerId) finish(event, true); },
    pointercancel: (event) => { if (event.pointerId === pointerId) finish(event, false); },
    pointerdown: (event) => { if (event.pointerId !== pointerId || event.button !== 0) finish(event, false); },
    contextmenu: (event) => finish(event, false),
    keydown: (event) => { if (event.key === "Escape") finish(event, false); },
    blur: (event) => finish(event, false)
  };
  const drag = {
    dispose() {
      Object.entries(handlers).forEach(([type, handler]) => window.removeEventListener(type, handler, true));
      cleanup();
    }
  };
  activeDrag = drag;
  Object.entries(handlers).forEach(([type, handler]) => window.addEventListener(type, handler, true));
}
function bindPaletteDrag(element, raw) {
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    cancelActiveDrag();
    document.body.classList.add("dragging-blocks");
    const startX = event.clientX;
    const startY = event.clientY;
    let hasMoved = false;
    const ghost = document.createElement("div");
    ghost.className = `pointer-drag-ghost palette-drag-ghost macro-block ${raw.color}`;
    ghost.textContent = raw.label;
    document.body.append(ghost);
    beginPointerDrag(event.pointerId, {
      onMove: (pointer) => {
        hasMoved ||= Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > 5;
        if (!hasMoved) return;
        ghost.style.visibility = "visible";
        ghost.style.left = `${pointer.clientX - 22}px`;
        ghost.style.top = `${pointer.clientY - 18}px`;
        const rail = raw.trigger ? null : findSnapRail(pointer.clientX, pointer.clientY);
        document.querySelectorAll(".insertion-rail.pointer-target").forEach((item) => item.classList.remove("pointer-target"));
        rail?.classList.add("pointer-target");
      },
      onDrop: (pointer) => {
        if (!hasMoved) return;
        element.dataset.justDragged = "true";
        dropPaletteBlock(raw, pointer.clientX, pointer.clientY);
      },
      cleanup: () => {
        document.body.classList.remove("dragging-blocks");
        ghost.remove();
        document.querySelectorAll(".insertion-rail.pointer-target").forEach((item) => item.classList.remove("pointer-target"));
      }
    });
  });
}
function setBlockValue(id, value) {
  for (const script of scripts) { const block = findBlock(script.blocks, id); if (block) { block.value = value; persistMacroState(); return; } }
  for (const freeBlock of freeBlocks) { const block = findBlock(freeBlock.blocks, id); if (block) { block.value = value; persistMacroState(); return; } }
}
function findBlockValue(id, condition = false) {
  for (const script of scripts) { const block = findBlock(script.blocks, id); if (block) return condition ? block.condition?.value : block.value; }
  for (const freeBlock of freeBlocks) { const block = findBlock(freeBlock.blocks, id); if (block) return condition ? block.condition?.value : block.value; }
  return "";
}
function setCondition(id, value) {
  for (const script of scripts) { const block = findBlock(script.blocks, id); if (block) { block.condition = { kind: "detection", value }; block.value = ""; persistMacroState(); return; } }
  for (const freeBlock of freeBlocks) { const block = findBlock(freeBlock.blocks, id); if (block) { block.condition = { kind: "detection", value }; block.value = ""; persistMacroState(); return; } }
}
function removeCondition(id) {
  for (const script of scripts) { const block = findBlock(script.blocks, id); if (block) { block.condition = null; persistMacroState(); return; } }
  for (const freeBlock of freeBlocks) { const block = findBlock(freeBlock.blocks, id); if (block) { block.condition = null; persistMacroState(); return; } }
}
function updateDetectionEditor(editor, mutate) {
  const condition = Boolean(editor.dataset.conditionId);
  const owner = editor.dataset.conditionId || editor.dataset.valueId;
  const next = mutate(detectionValue(findBlockValue(owner, condition)));
  if (condition) setCondition(owner, JSON.stringify(next)); else setBlockValue(owner, JSON.stringify(next));
  return next;
}
function keyName(event) {
  const named = { " ": "Space", Esc: "Escape", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
  return named[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
}
function findBlock(blocks, id) { for (const block of blocks) { if (block.id === id) return block; const nested = block.children && findBlock(block.children, id); const alternate = block.elseChildren && findBlock(block.elseChildren, id); if (nested || alternate) return nested || alternate; } return null; }
function removeBlock(blocks, id) { const index = blocks.findIndex((block) => block.id === id); if (index >= 0) return blocks.splice(index, 1)[0]; for (const block of blocks) { const found = block.children && removeBlock(block.children, id); const alternate = block.elseChildren && removeBlock(block.elseChildren, id); if (found || alternate) return found || alternate; } return null; }
function insertBlock(block, target = null) {
  snapshot();
  if (selectedBlockId) {
    for (const script of scripts) { const index = script.blocks.findIndex((item) => item.id === selectedBlockId); if (index >= 0) { script.blocks.splice(index + 1, 0, block); renderWorkspace(); return; } }
  }
  if (target) blockList(target).push(block); else {
    const script = selectedScript();
    if (script) script.blocks.push(block); else scripts.push({ id: uid(), x: 130 - pan.x, y: 90 - pan.y, runnable: false, blocks: [block] });
  }
  renderWorkspace();
}
function addInsertionRails() {
  document.querySelectorAll(".drop-zone[data-insert], .free-drop-zone[data-free-insert]").forEach((zone) => {
    const target = zone.dataset.insert ? decode(zone.dataset.insert) : { freeId: zone.dataset.freeInsert };
    const blockElements = [...zone.children].filter((element) => element.matches(".macro-block, .container-block"));
    blockElements.forEach((element, index) => {
      const rail = document.createElement("div");
      rail.className = "insertion-rail";
      rail.dataset.insertIndex = index;
      rail.dataset.insertTarget = JSON.stringify(target).replaceAll('"', "&quot;");
      element.before(rail);
    });
    const rail = document.createElement("div");
    rail.className = "insertion-rail";
    rail.dataset.insertIndex = blockElements.length;
    rail.dataset.insertTarget = JSON.stringify(target).replaceAll('"', "&quot;");
    const marker = zone.querySelector(":scope > .stack-insert, :scope > .nest-label");
    if (marker) marker.before(rail); else zone.append(rail);
    void target;
  });
  document.querySelectorAll(".insertion-rail").forEach((rail) => {
    rail.addEventListener("dragover", (event) => { event.preventDefault(); document.querySelectorAll(".insertion-rail.active").forEach((item) => item.classList.remove("active")); rail.classList.add("active"); });
    rail.addEventListener("dragleave", () => rail.classList.remove("active"));
    rail.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      rail.classList.remove("active");
      const target = decode(rail.dataset.insertTarget);
      const raw = event.dataTransfer.getData("application/x-macro-block");
      const movedPath = event.dataTransfer.getData("application/x-move-stack");
      if (!raw && !movedPath) return;
      snapshot();
      const moved = raw ? [makeBlock(JSON.parse(raw))] : [];
      let insertIndex = Number(rail.dataset.insertIndex);
      if (movedPath) {
        const source = decode(movedPath);
        moveBlockStack(source, target, insertIndex);
      } else {
        blockList(target).splice(insertIndex, 0, ...moved);
      }
      selectedBlockId = null;
      renderWorkspace();
    });
  });
}
function bindBoardEvents() {
  document.querySelectorAll("[data-select-script]").forEach((button) => button.addEventListener("click", () => { if (!commitDirtyCode()) return; selectedScriptId = button.dataset.selectScript; selectedBlockId = null; renderWorkspace(); showToast("Script selected for Code view"); }));
  document.querySelectorAll("[data-block-id]").forEach((element) => {
    element.addEventListener("click", (event) => { if (event.target.closest(".macro-block, .container-block") !== element) return; if (suppressBlockClick) { suppressBlockClick = false; return; } if (event.target.closest("button, input")) return; if (!commitDirtyCode()) return; selectedBlockId = element.dataset.blockId; if (element.dataset.path) selectedScriptId = decode(element.dataset.path).scriptId; renderWorkspace(); });
    element.addEventListener("contextmenu", (event) => { if (event.target.closest(".macro-block, .container-block") !== element) return; showBlockContextMenu(event, element.dataset.blockId, element.dataset.path); });
  });
  document.querySelectorAll("input.block-field[data-value-id]").forEach((input) => {
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => { snapshot(); setBlockValue(input.dataset.valueId, input.value); });
    if (input.classList.contains("coordinate-capture")) input.addEventListener("keydown", async (event) => {
      if (event.key !== "F9") return;
      event.preventDefault();
      const point = await window.macroStudio?.getCursorPosition?.();
      if (!point) return showToast("Coordinate picking is available in the desktop app");
      snapshot(); setBlockValue(input.dataset.valueId, `${point.x}, ${point.y}`); renderWorkspace(); showToast(`Picked ${point.x}, ${point.y}`);
    });
  });
  document.querySelectorAll(".scope-app-picker").forEach((button) => button.addEventListener("click", () => {
    pendingAppPickerBlockId = button.dataset.scopeId;
    openAppPicker();
  }));
  document.querySelectorAll("[data-condition-value-id]").forEach((input) => {
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => { snapshot(); setBlockValue(input.dataset.conditionValueId, input.value); });
  });
  document.querySelectorAll(".detection-editor").forEach((editor) => {
    editor.addEventListener("pointerdown", (event) => { event.stopPropagation(); activeDetectionEditor = editor; });
    editor.addEventListener("focusin", () => { activeDetectionEditor = editor; });
    editor.querySelector(".detection-color-button")?.addEventListener("click", () => { const palette = editor.querySelector(".detection-palette"); palette.hidden = !palette.hidden; if (!palette.hidden) editor.focus(); });
    editor.querySelectorAll(".detection-swatch").forEach((button) => button.addEventListener("click", () => { const color = button.dataset.color; snapshot(); updateDetectionEditor(editor, (value) => ({ ...value, color })); editor.querySelector(".detection-hex").value = color; editor.querySelector(".detection-color-button").style.setProperty("--picked-color", color); editor.querySelector(".detection-palette").hidden = true; }));
    editor.querySelector(".detection-screen-color")?.addEventListener("click", async () => { const color = await window.macroStudio?.getCursorColor?.(); if (!/^#[0-9A-F]{6}$/i.test(color || "")) return showToast("Screen color picking is available in the desktop app"); snapshot(); updateDetectionEditor(editor, (value) => ({ ...value, color })); editor.querySelector(".detection-hex").value = color; editor.querySelector(".detection-color-button").style.setProperty("--picked-color", color); });
    editor.querySelector(".detection-text")?.addEventListener("change", (event) => { snapshot(); updateDetectionEditor(editor, (value) => ({ ...value, text: event.target.value })); });
    editor.querySelector(".detection-hex")?.addEventListener("change", (event) => { if (!/^#[0-9A-F]{6}$/i.test(event.target.value)) return showToast("Use a hex color such as #FF0000"); snapshot(); updateDetectionEditor(editor, (value) => ({ ...value, color: event.target.value.toUpperCase() })); renderWorkspace(); });
    editor.querySelector(".detection-range")?.addEventListener("input", (event) => { const tolerance = Number(event.target.value); editor.querySelector("output").value = tolerance; editor.querySelector("output").textContent = tolerance; updateDetectionEditor(editor, (value) => ({ ...value, tolerance })); });
  });
  document.querySelectorAll(".press-key-editor").forEach((editor) => {
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    editor.addEventListener("click", (event) => event.stopPropagation());
    editor.querySelector(".key-capture")?.addEventListener("keydown", (event) => {
      event.preventDefault();
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      snapshot(); updatePressKeyEditor(editor, (value) => ({ ...value, key: keyName(event) })); renderWorkspace();
    });
    editor.querySelector(".press-key-hold")?.addEventListener("change", (event) => {
      snapshot(); updatePressKeyEditor(editor, (value) => ({ ...value, holdMs: Math.max(0, Math.round(Number(event.target.value) || 0)) }));
    });
  });
  document.querySelectorAll(".move-mouse-editor").forEach((editor) => {
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    editor.addEventListener("click", (event) => event.stopPropagation());
    editor.querySelector(".move-position")?.addEventListener("keydown", async (event) => {
      if (event.key !== "F9") return;
      event.preventDefault();
      const point = await window.macroStudio?.getCursorPosition?.();
      if (!point) return showToast("Coordinate picking is available in the desktop app");
      snapshot(); updateMoveMouseEditor(editor, (value) => ({ ...value, x: point.x, y: point.y })); renderWorkspace(); showToast(`Picked ${point.x}, ${point.y}`);
    });
    editor.querySelector(".move-mode")?.addEventListener("change", (event) => {
      snapshot(); updateMoveMouseEditor(editor, (value) => ({ ...value, mode: event.target.value })); renderWorkspace();
    });
    editor.querySelector(".move-duration")?.addEventListener("change", (event) => {
      snapshot(); updateMoveMouseEditor(editor, (value) => ({ ...value, duration: Math.max(0, Math.round(Number(event.target.value) || 0)) }));
    });
  });
  document.querySelectorAll(".relative-move-editor").forEach((editor) => {
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    editor.addEventListener("click", (event) => event.stopPropagation());
    const pickTarget = async () => {
      const point = await window.macroStudio?.getCursorPosition?.();
      const display = await window.macroStudio?.getPrimaryDisplay?.();
      if (!point || !display) return showToast("Target picking is available in the desktop app");
      const centerX = display.x + display.width / 2;
      const centerY = display.y + display.height / 2;
      const deltaX = point.x - centerX;
      const deltaY = point.y - centerY;
      const angle = (Math.atan2(deltaY, deltaX) * 180 / Math.PI + 360) % 360;
      const direction = relativeDirections[Math.round(angle / 45) % relativeDirections.length];
      const pixels = Math.round(Math.hypot(deltaX, deltaY));
      snapshot(); updateRelativeMoveEditor(editor, (value) => ({ ...value, direction, pixels })); renderWorkspace(); showToast(`Picked ${direction}, ${pixels} px from center`);
    };
    editor.querySelector(".relative-move-capture")?.addEventListener("click", pickTarget);
    editor.addEventListener("keydown", (event) => { if (event.key === "F9") { event.preventDefault(); void pickTarget(); } });
    editor.querySelector(".relative-move-direction")?.addEventListener("change", (event) => {
      snapshot(); updateRelativeMoveEditor(editor, (value) => ({ ...value, direction: event.target.value }));
    });
    editor.querySelector(".relative-move-pixels")?.addEventListener("change", (event) => {
      snapshot(); updateRelativeMoveEditor(editor, (value) => ({ ...value, pixels: Math.max(0, Math.round(Number(event.target.value) || 0)) }));
    });
    editor.querySelector(".relative-move-duration")?.addEventListener("change", (event) => {
      snapshot(); updateRelativeMoveEditor(editor, (value) => ({ ...value, duration: Math.max(0, Math.round(Number(event.target.value) || 0)) }));
    });
  });
  document.querySelectorAll(".click-mouse-editor").forEach((editor) => {
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    editor.addEventListener("click", (event) => event.stopPropagation());
    editor.querySelector(".click-position")?.addEventListener("keydown", async (event) => {
      if (event.key !== "F9") return;
      event.preventDefault();
      const point = await window.macroStudio?.getCursorPosition?.();
      if (!point) return showToast("Coordinate picking is available in the desktop app");
      snapshot(); updateClickMouseEditor(editor, (value) => ({ ...value, x: point.x, y: point.y })); renderWorkspace(); showToast(`Picked ${point.x}, ${point.y}`);
    });
    editor.querySelector(".click-button")?.addEventListener("change", (event) => {
      snapshot(); updateClickMouseEditor(editor, (value) => ({ ...value, button: event.target.value }));
    });
    editor.querySelector(".click-hold")?.addEventListener("change", (event) => {
      snapshot(); updateClickMouseEditor(editor, (value) => ({ ...value, holdMs: Math.max(0, Math.round(Number(event.target.value) || 0)) }));
    });
    editor.querySelector(".click-at-cursor")?.addEventListener("change", (event) => {
      snapshot(); updateClickMouseEditor(editor, (value) => ({ ...value, atCursor: event.target.checked })); renderWorkspace();
    });
  });
  document.querySelectorAll(".macro-block, .container-block").forEach(bindBlockDrag);
  addInsertionRails();
  document.querySelectorAll(".script-stack").forEach(bindStackDrag);
}
document.addEventListener("keydown", async (event) => {
  if (event.key !== "F9") return;
  const editor = event.target.closest?.(".detection-editor") || activeDetectionEditor;
  if (!editor?.isConnected) return;
  event.preventDefault();
  const palette = editor.querySelector(".detection-palette");
  if (palette && !palette.hidden) {
    const color = await window.macroStudio?.getCursorColor?.();
    if (!/^#[0-9A-F]{6}$/i.test(color || "")) return showToast("Screen color picking is available in the desktop app");
    snapshot();
    updateDetectionEditor(editor, (value) => ({ ...value, color }));
    editor.querySelector(".detection-hex").value = color;
    editor.querySelector(".detection-color-button").style.setProperty("--picked-color", color);
    showToast(`Picked ${color} from screen`);
    return;
  }
  const point = await window.macroStudio?.getCursorPosition?.();
  if (!point) return showToast("Position picking is available in the desktop app");
  const field = event.target.closest?.(".detection-coordinates");
  const captureKey = `${editor.dataset.conditionId ? "condition" : "block"}:${editor.dataset.conditionId || editor.dataset.valueId}`;
  const target = field?.dataset.detectionPoint || detectionNextPoints.get(captureKey) || "start";
  snapshot();
  updateDetectionEditor(editor, (value) => target === "start" ? { ...value, x1: point.x, y1: point.y } : { ...value, x2: point.x, y2: point.y });
  detectionNextPoints.set(captureKey, target === "start" ? "end" : "start");
  showToast(`${target === "start" ? "First" : "Second"} corner picked`);
  renderWorkspace();
});
function bindBlockDrag(element) {
  element.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".macro-block, .container-block") !== element) return;
    if (event.button !== 0 || event.target.closest("input, button")) return;
    cancelActiveDrag();
    const source = element.dataset.freeBlockId ? { freeId: element.dataset.freeBlockId } : decode(element.dataset.path);
    if (source.freeId) source.sourceIndex = Number(element.dataset.freeIndex || 0);
    const startX = event.clientX;
    const startY = event.clientY;
    let hasMoved = false;
    const sourceElements = dragGroupElements(element, source);
    const ghost = createDragGhost(element, source);
    document.body.classList.add("dragging-blocks");
    const moveGhost = (move) => {
      ghost.style.left = `${move.clientX - 22}px`;
      ghost.style.top = `${move.clientY - 18}px`;
      hasMoved ||= Math.hypot(move.clientX - startX, move.clientY - startY) > 4;
      if (!hasMoved) return;
      ghost.style.visibility = "visible";
      sourceElements.forEach((item) => item.classList.add("drag-source"));
      const nextRail = findSnapRail(move.clientX, move.clientY, source, element);
      document.querySelectorAll(".insertion-rail.pointer-target").forEach((rail) => rail.classList.remove("pointer-target"));
      nextRail?.classList.add("pointer-target");
    };
    const cleanup = () => {
      document.body.classList.remove("dragging-blocks");
      document.querySelectorAll(".insertion-rail.pointer-target").forEach((item) => item.classList.remove("pointer-target"));
      ghost.remove();
      sourceElements.forEach((item) => item.classList.remove("drag-source"));
    };
    const finishDrag = (up) => {
      const conditionSlot = element.classList.contains("detection") ? document.elementsFromPoint(up.clientX, up.clientY).find((item) => item.classList?.contains("condition-input")) : null;
      const rail = findSnapRail(up.clientX, up.clientY, source, element);
      cleanup();
      if (!hasMoved) return;
      suppressBlockClick = true;
      setTimeout(() => { suppressBlockClick = false; }, 80);
      snapshot();
      if (conditionSlot) {
        setCondition(conditionSlot.dataset.conditionTarget, findBlockValue(element.dataset.blockId));
        if (source.freeId) freeBlocks = freeBlocks.filter((item) => item.id !== source.freeId); else deleteAt(source);
      } else if (rail) {
        const target = decode(rail.dataset.insertTarget);
        if (source.freeId) moveFreeBlockToRail(source.freeId, { ...target, sourceIndex: source.sourceIndex }, Number(rail.dataset.insertIndex));
        else moveBlockStack(source, target, Number(rail.dataset.insertIndex));
      } else {
        const workspaceRect = workspace.getBoundingClientRect();
        moveBlockToCanvas(source, (up.clientX - workspaceRect.left - pan.x) / zoom - 22, (up.clientY - workspaceRect.top - pan.y) / zoom - 18);
      }
      selectedBlockId = null;
      renderWorkspace();
    };
    moveGhost(event);
    beginPointerDrag(event.pointerId, { onMove: moveGhost, onDrop: finishDrag, cleanup });
  });
}
function bindStackDrag(element) {
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.target.closest(".drag-handle")) return;
    cancelActiveDrag();
    const script = scripts.find((item) => item.id === element.dataset.scriptId);
    if (!script) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = script.x;
    const originY = script.y;
    let moved = false;
    element.classList.add("dragging");
    document.body.classList.add("dragging-blocks");
    beginPointerDrag(event.pointerId, {
      onMove: (move) => {
        if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < 3) return;
        if (!moved) { moved = true; snapshot(); }
        script.x = Math.max(-pan.x, originX + (move.clientX - startX) / zoom);
        script.y = Math.max(-pan.y, originY + (move.clientY - startY) / zoom);
        element.style.left = `${script.x}px`;
        element.style.top = `${script.y}px`;
      },
      onDrop: () => { if (moved) renderWorkspace(); },
      cleanup: () => { element.classList.remove("dragging"); document.body.classList.remove("dragging-blocks"); }
    });
  });
}
function conditionCode(block) { return block.condition?.kind === "detection" ? `await macro.detect(${block.condition.value})` : block.value || "true"; }
function codeForBlocks(blocks = [], indent = "  ") {
  const inner = `${indent}  `;
  const nested = (children) => codeForBlocks(children || [], inner);
  const wrap = (head, children, tail = "") => `${indent}${head} {\n${nested(children)}${children?.length ? "\n" : ""}${indent}}${tail}`;
  return blocks.map((block) => {
    if (block.kind === "repeat") return wrap(`for (let count = 0; count < ${parseInt(block.value, 10) || 1}; count += 1)`, block.children);
    if (block.kind === "while") return wrap(`while (${conditionCode(block)})`, block.children);
    if (block.kind === "if") return wrap(`if (${conditionCode(block)})`, block.children);
    if (block.kind === "ifElse") return `${wrap(`if (${conditionCode(block)})`, block.children)} else {\n${nested(block.elseChildren)}${block.elseChildren?.length ? "\n" : ""}${indent}}`;
    if (block.kind === "scope") return wrap(`if (await macro.isForegroundApp(${JSON.stringify(block.value || "")}))`, block.children);
    if (block.kind === "function") return wrap(`await macro.callFunction(${JSON.stringify(block.label)}, async () =>`, block.children, ");");
    const value = JSON.stringify(block.value || "");
    if (block.label === "Set variable") { const [, name, assigned] = String(block.value || "").match(/^\s*([^=\s]+)\s*=\s*(.*)\s*$/) || []; if (name) return `${indent}macro.setVariable(${JSON.stringify(name)}, ${JSON.stringify(assigned)});`; }
    if (block.label === "Change variable") { const [, name, operator, amount] = String(block.value || "").match(/^\s*([^+\-\s]+)\s*([+\-])\s*(.+?)\s*$/) || []; if (name) return `${indent}macro.changeVariable(${JSON.stringify(name)}, ${JSON.stringify(operator)}, ${/^\d+(?:\.\d+)?$/.test(amount) ? amount : JSON.stringify(amount)});`; }
    if (block.label === "Press key") { const press = pressKeyValue(block.value); return press.holdMs > 0 ? `${indent}await macro.pressKey(${JSON.stringify(press.key)}, ${press.holdMs});` : `${indent}await macro.pressKey(${JSON.stringify(press.key)});`; }
    if (block.label === "Move mouse") { const move = moveMouseValue(block.value); return move.mode === "smooth" ? `${indent}await macro.moveMouse(${move.x}, ${move.y}, { smooth: true, duration: ${move.duration} });` : `${indent}await macro.moveMouse(${move.x}, ${move.y});`; }
    if (block.label === "Click mouse") { const click = clickMouseValue(block.value); const options = [click.button === "right" ? `button: "right"` : "", click.holdMs > 0 ? `holdMs: ${click.holdMs}` : ""].filter(Boolean); const optionArg = options.length ? `{ ${options.join(", ")} }` : ""; return click.atCursor ? `${indent}await macro.clickAtCursor(${optionArg});` : `${indent}await macro.click(${click.x}, ${click.y}${optionArg ? `, ${optionArg}` : ""});`; }
    if (block.label === "Wait") { const text = String(block.value || "").trim(); return Number.isFinite(parseFloat(text)) && /^[\d.]/.test(text) ? `${indent}await macro.wait(${parseFloat(text) || 1});` : `${indent}await macro.wait(${JSON.stringify(text.replace(/\s+(?:seconds?|secs?|s)$/i, ""))});`; }
    if (block.label === "Random variable") { const [, name, low, high] = String(block.value || "").match(/^\s*([A-Za-z_]\w*)\s*=\s*(?:random\s+)?(.+?)\s+to\s+(.+?)\s*$/i) || []; if (name) return `${indent}macro.randomVariable(${JSON.stringify(name)}, ${JSON.stringify(low)}, ${JSON.stringify(high)});`; }
    const calls = { "Open program": "openProgram", "Open file": "openFile", "Type text": "type", "Focus window": "focusWindow" };
    if (calls[block.label]) return `${indent}await macro.${calls[block.label]}(${value});`;
    return `${indent}await macro.block(${JSON.stringify(block.label)}, ${value});`;
  }).join("\n");
}
function scriptToCode(script) {
  const trigger = script.runnable && script.trigger ? `// trigger: ${JSON.stringify({ label: script.trigger.label, value: script.trigger.value || "" })}\n` : "";
  return `// ${scripts.indexOf(script) + 1}: selected script\n${trigger}// workspace location: x=${Math.round(script.x)}, y=${Math.round(script.y)}\nmacro.run(async () => {\n${codeForBlocks(script.blocks)}${script.blocks.length ? "\n" : ""}});\n`;
}
function codeArguments(text) {
  const args = [];
  let depth = 0; let quote = ""; let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) { current += char; if (char === "\\") current += text[++index] ?? ""; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if ("({[".includes(char)) depth += 1;
    if (")}]".includes(char)) depth -= 1;
    if (char === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args.map((arg) => {
    if (/^"/.test(arg)) { try { return JSON.parse(arg); } catch { return arg.slice(1, -1); } }
    if (/^'/.test(arg)) return arg.slice(1, -1);
    if (/^\{/.test(arg)) { try { return JSON.parse(arg.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')); } catch { return {}; } }
    if (arg !== "" && Number.isFinite(Number(arg))) return Number(arg);
    return arg;
  });
}
function conditionFromCode(text) {
  const detect = text.match(/^await\s+macro\.detect\(([\s\S]*)\)$/);
  if (!detect) return { value: text.trim() || "true", condition: null };
  try { return { value: "", condition: { kind: "detection", value: JSON.stringify(JSON.parse(detect[1])) } }; }
  catch { throw new Error(`Invalid detection in condition: ${text}`); }
}
function blockFromCall(name, args, line) {
  const wait = (value) => `${value} ${value === 1 ? "second" : "seconds"}`;
  switch (name) {
    case "openProgram": return action("Open program", "files", String(args[0] ?? ""));
    case "openFile": return action("Open file", "files", String(args[0] ?? ""));
    case "type": return action("Type text", "input", String(args[0] ?? ""));
    case "focusWindow": return action("Focus window", "window", String(args[0] ?? ""));
    case "wait": return action("Wait", "system", typeof args[0] === "string" && args[0] !== "" ? `${args[0]} seconds` : wait(Number(args[0]) || 1));
    case "setVariable": return action("Set variable", "variables", `${args[0] ?? ""} = ${args[1] ?? ""}`);
    case "randomVariable": return action("Random variable", "variables", `${args[0] ?? ""} = ${args[1] ?? 1} to ${args[2] ?? 6}`);
    case "changeVariable": return action("Change variable", "variables", `${args[0] ?? ""} ${args[1] === "-" ? "-" : "+"} ${args[2] ?? 1}`);
    case "pressKey": return action("Press key", "input", JSON.stringify({ key: String(args[0] ?? ""), holdMs: Math.max(0, Math.round(Number(args[1]) || 0)) }));
    case "moveMouse": { const options = args[2] || {}; return action("Move mouse", "input", JSON.stringify({ x: Math.round(Number(args[0]) || 0), y: Math.round(Number(args[1]) || 0), mode: options.smooth ? "smooth" : "instant", duration: Number(options.duration) || 300 })); }
    case "click": return action("Click mouse", "input", JSON.stringify({ x: Math.round(Number(args[0]) || 0), y: Math.round(Number(args[1]) || 0), button: args[2]?.button === "right" ? "right" : "left",     atCursor: false, holdMs: Math.max(0, Math.round(Number(args[2]?.holdMs) || 0)) }));
        case "clickAtCursor": return action("Click mouse", "input", JSON.stringify({ x: 640, y: 360, button: args[0]?.button === "right" ? "right" : "left", atCursor: true, holdMs: Math.max(0, Math.round(Number(args[0]?.holdMs) || 0)) }));
    case "block": {
      const raw = Object.values(categoryBlocks).flat().find((item) => item.label === args[0]);
      return makeBlock({ label: String(args[0] ?? ""), color: raw?.color || "system", kind: raw?.kind, value: String(args[1] ?? "") });
    }
    default: throw new Error(`Unsupported code: ${line}`);
  }
}
function blocksFromCode(body) {
  const root = [];
  const stack = [{ list: root }];
  const current = () => stack.at(-1);
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const repeat = line.match(/^for\s*\(let count = 0;\s*count < (\d+);\s*count \+= 1\)\s*\{$/);
    const scope = line.match(/^if\s*\(await macro\.isForegroundApp\(([\s\S]*)\)\)\s*\{$/);
    const call = line.match(/^await macro\.callFunction\(([\s\S]*?),\s*async\s*\(\)\s*=>\s*\{$/);
    const conditional = line.match(/^(if|while)\s*\(([\s\S]*)\)\s*\{$/);
    let opened = null;
    if (repeat) opened = container("Repeat", "repeat", `${repeat[1]} times`);
    else if (scope) opened = container("Only in app", "scope", String(codeArguments(scope[1])[0] ?? ""));
    else if (call) opened = { id: uid(), label: String(codeArguments(call[1])[0] ?? "Function"), color: "functions", kind: "function", children: [] };
    else if (conditional) {
      const { value, condition } = conditionFromCode(conditional[2]);
      opened = container(conditional[1] === "if" ? "If" : "While condition", conditional[1], value);
      opened.condition = condition;
    }
    if (opened) { current().list.push(opened); stack.push({ block: opened, list: opened.children }); continue; }
    if (/^\}\s*else\s*\{$/.test(line)) {
      const frame = current();
      if (!frame.block || frame.block.kind !== "if" || frame.block.elseChildren) throw new Error("Unexpected else in code");
      frame.block.kind = "ifElse"; frame.block.label = "If / else"; frame.block.elseChildren = [];
      frame.list = frame.block.elseChildren;
      continue;
    }
    if (/^\}\)?;?$/.test(line)) {
      if (stack.length === 1) throw new Error("Unexpected closing brace in code");
      stack.pop();
      continue;
    }
    const statement = line.match(/^(?:await\s+)?macro\.(\w+)\(([\s\S]*)\);?$/);
    if (!statement) throw new Error(`Unsupported code: ${line}`);
    current().list.push(blockFromCall(statement[1], codeArguments(statement[2]), line));
  }
  if (stack.length > 1) throw new Error("Missing closing brace in code");
  return root;
}
function parseCode() {
  const script = selectedScript();
  if (!script) throw new Error("Select a script before applying code.");
  const run = codeEditor.value.match(/macro\.run\(async\s*\(\)\s*=>\s*\{([\s\S]*)\}\);?\s*$/);
  if (!run) throw new Error("Use macro.run(async () => { ... });");
  const blocks = blocksFromCode(run[1]);
  const location = codeEditor.value.match(/workspace location:\s*x\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*y\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const triggerLine = codeEditor.value.match(/^\/\/ trigger:\s*(\{.*\})\s*$/m);
  snapshot();
  if (location) { script.x = Number(location[1]); script.y = Number(location[2]); }
  if (triggerLine && script.runnable) { try { const parsed = JSON.parse(triggerLine[1]); script.trigger = trigger(String(parsed.label || "When run"), String(parsed.value || "")); } catch { /* keep existing trigger */ } }
  script.blocks = blocks;
  renderWorkspace();
}
function setEditorMode(visual) { document.querySelectorAll(".mode").forEach((mode) => { const active = visual === (mode.textContent.trim() === "Visual blocks"); mode.classList.toggle("active", active); mode.setAttribute("aria-selected", active); }); workspace.hidden = !visual; codeView.hidden = visual; if (!visual) refreshCodeViewIfVisible(); }
workspace.addEventListener("pointerdown", (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  const movePan = (move) => {
    pan.x = start.panX + move.clientX - start.x;
    pan.y = start.panY + move.clientY - start.y;
    updateBoardTransform();
  };
  const stopPan = () => {
    workspace.classList.remove("panning");
    workspace.removeEventListener("pointermove", movePan);
    workspace.removeEventListener("pointerup", stopPan);
    workspace.removeEventListener("pointercancel", stopPan);
    workspace.removeEventListener("lostpointercapture", stopPan);
  };
  workspace.setPointerCapture(event.pointerId);
  workspace.classList.add("panning");
  workspace.addEventListener("pointermove", movePan);
  workspace.addEventListener("pointerup", stopPan);
  workspace.addEventListener("pointercancel", stopPan);
  workspace.addEventListener("lostpointercapture", stopPan);
});
workspace.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = workspace.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const nextZoom = Math.min(1.8, Math.max(0.5, zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
  const ratio = nextZoom / zoom;
  pan.x = cursorX - (cursorX - pan.x) * ratio;
  pan.y = cursorY - (cursorY - pan.y) * ratio;
  zoom = nextZoom;
  updateBoardTransform();
}, { passive: false });
workspace.addEventListener("dragover", (event) => {
  if (event.target !== workspace && !event.target.classList.contains("workspace-grid")) return;
  const rawText = event.dataTransfer.getData("application/x-macro-block");
  if (rawText) event.preventDefault();
});
workspace.addEventListener("drop", (event) => {
  if (event.target !== workspace && !event.target.classList.contains("workspace-grid")) return;
  const rawText = event.dataTransfer.getData("application/x-macro-block");
  if (!rawText) return;
  const raw = JSON.parse(rawText);
  event.preventDefault();
  event.stopPropagation();
  const rect = workspace.getBoundingClientRect();
  snapshot();
  const x = (event.clientX - rect.left - pan.x) / zoom;
  const y = (event.clientY - rect.top - pan.y) / zoom;
  if (raw.trigger) {
    scripts.push(createTriggerScript(raw, x, y));
    selectedScriptId = scripts.at(-1).id;
  } else {
    const block = makeBlock(raw);
    freeBlocks.push({ id: uid(), blocks: [block], x, y });
    selectedBlockId = block.id;
  }
  renderWorkspace();
});
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active")); button.classList.add("active"); selectedCategory = button.dataset.category; document.querySelector("#categoryTitle").textContent = button.textContent.trim(); document.querySelector("#blockSearch").value = ""; renderPalette(); }));
document.querySelector("#blockSearch").addEventListener("input", (event) => renderPalette(event.target.value));
document.querySelector("#undoButton").addEventListener("click", undo);
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
  const key = event.key.toLowerCase();
  const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
  if (key !== "z" && !wantsRedo) return;
  event.preventDefault();
  if (document.querySelector(".dragging-blocks")) return;
  if (wantsRedo) redo(); else undo();
});
blockContextMenu.addEventListener("click", (event) => {
  const action = event.target.dataset.menuAction;
  if (!action) return;
  hideBlockContextMenu();
  if (action === "function") openFunctionDialog();
  if (action === "copy") copySelectedStack();
  if (action === "paste") pasteBelowSelectedBlock();
  if (action === "delete") deleteContextBlock();
});
document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#blockContextMenu")) hideBlockContextMenu(); });
document.querySelector("#cancelFunction").addEventListener("click", () => { functionDialog.hidden = true; });
document.querySelector("#functionForm").addEventListener("submit", (event) => { event.preventDefault(); const name = document.querySelector("#functionNameInput").value; functionDialog.hidden = true; saveSelectedFunction(name); });
const aiActionLabels = new Set(["Open program", "Open file", "Save active file", "Wait", "Show notification", "Type text", "Press key", "Click mouse", "Set variable", "Change variable"]);
const aiContainerLabels = { repeat: "Repeat", if: "If", ifElse: "If / else", while: "While condition" };
function normalizeAiDetection(value) {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (raw.mode === "text") {
    const text = String(raw.text || "").trim().slice(0, 200);
    const area = { x1: Number(raw.x1), y1: Number(raw.y1), x2: Number(raw.x2), y2: Number(raw.y2) };
    if (!text || !Object.values(area).every(Number.isFinite)) throw new Error("AI returned invalid text Detection settings");
    return JSON.stringify({ ...area, mode: "text", text });
  }
  const detector = { x1: Number(raw.x1), y1: Number(raw.y1), x2: Number(raw.x2), y2: Number(raw.y2), color: String(raw.color || "").toUpperCase(), tolerance: Number(raw.tolerance ?? 20) };
  if (![detector.x1, detector.y1, detector.x2, detector.y2, detector.tolerance].every(Number.isFinite) || !/^#[0-9A-F]{6}$/.test(detector.color)) throw new Error("AI returned invalid Detection settings");
  detector.tolerance = Math.max(0, Math.min(255, Math.round(detector.tolerance)));
  return JSON.stringify(detector);
}
function normalizeAiBlocks(rawBlocks, depth = 0) {
  if (!Array.isArray(rawBlocks) || depth > 6 || rawBlocks.length > 80) throw new Error("AI returned an invalid block structure");
  return rawBlocks.map((raw) => {
    if (aiContainerLabels[raw?.kind]) {
      const block = container(aiContainerLabels[raw.kind], raw.kind, String(raw.value || defaults[aiContainerLabels[raw.kind]]));
      block.children = normalizeAiBlocks(raw.children || [], depth + 1);
      if (raw.kind === "ifElse") block.elseChildren = normalizeAiBlocks(raw.elseChildren || [], depth + 1);
      if (raw.condition?.kind === "detection") block.condition = { kind: "detection", value: normalizeAiDetection(raw.condition.value) };
      return block;
    }
    if (!aiActionLabels.has(raw?.label)) throw new Error(`AI returned an unsupported block: ${raw?.label || "unknown"}`);
    const value = String(raw.value ?? defaults[raw.label] ?? "").trim();
    if (raw.label === "Set variable" && !/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*.+$/.test(value)) throw new Error("AI returned an invalid Set variable value. It must look like ready = true.");
    if (raw.label === "Change variable" && !/^[A-Za-z_][A-Za-z0-9_]*\s*[+-]\s*\d+(?:\.\d+)?$/.test(value)) throw new Error("AI returned an invalid Change variable value. It must look like count + 1.");
    const paletteItem = Object.values(categoryBlocks).flat().find((item) => item.label === raw.label);
    return action(raw.label, paletteItem.color, value);
  });
}
function openFreeStackPosition() {
  const occupied = [...scripts, ...freeBlocks];
  let x = 130 - pan.x;
  let y = 90 - pan.y;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const overlaps = occupied.some((item) => Math.abs(item.x - x) < 315 && Math.abs(item.y - y) < 120);
    if (!overlaps) return { x, y };
    x += 42;
    y += 34;
  }
  return { x, y };
}
document.querySelector("#aiButton").addEventListener("click", async () => {
  const providers = await window.macroStudio?.getAiProviders?.();
  const selector = document.querySelector("#aiGenerationProvider");
  selector.value = providers?.selectedProvider || "github";
  const config = await window.macroStudio?.getAiConfig?.(selector.value);
  const providerNames = { github: "GitHub Models", openai: "OpenAI", gemini: "Google Gemini", anthropic: "Anthropic Claude", local: "Local server" };
  document.querySelector("#aiMessage").textContent = config?.configured ? `Using ${providerNames[config.provider] || config.provider}${config.model ? ` (${config.model})` : ""}. Generated blocks will be added as a separate stack.` : "Configure an AI provider in Settings first.";
  aiDialog.hidden = false;
  document.querySelector("#aiPromptInput").focus();
});
document.querySelector("#aiGenerationProvider").addEventListener("change", async (event) => {
  const config = await window.macroStudio?.getAiConfig?.(event.target.value);
  const names = { github: "GitHub Models", openai: "OpenAI", gemini: "Google Gemini", anthropic: "Anthropic Claude", local: "Local server" };
  document.querySelector("#aiMessage").textContent = config?.configured ? `Using ${names[event.target.value]}${config.model ? ` (${config.model})` : ""}.` : `${names[event.target.value]} is not configured. Open Settings, select it, paste its key, and save.`;
});
document.querySelector("#cancelAi").addEventListener("click", () => { aiDialog.hidden = true; });
document.querySelector("#aiForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#generateAiBlocks");
  button.disabled = true;
  document.querySelector("#aiMessage").textContent = "Generating visual blocks...";
  try {
    const provider = document.querySelector("#aiGenerationProvider").value;
    const response = await window.macroStudio?.generateBlocksWithAi?.(document.querySelector("#aiPromptInput").value, document.querySelector("#aiIncludeScreen").checked, provider);
    const blocks = normalizeAiBlocks(response?.blocks);
    if (!blocks.length) throw new Error("AI did not return any blocks");
    snapshot();
    const position = openFreeStackPosition();
    const script = { id: uid(), ...position, runnable: true, trigger: trigger("When run"), blocks };
    scripts.push(script);
    selectedScriptId = script.id;
    selectedBlockId = blocks[0].id;
    aiDialog.hidden = true;
    renderWorkspace();
    showToast(`${blocks.length} AI block${blocks.length === 1 ? "" : "s"} added`);
  } catch (error) { document.querySelector("#aiMessage").textContent = error.message || "Could not generate blocks"; }
  finally { button.disabled = false; }
});
document.querySelector("#saveButton").addEventListener("click", () => {
  const macro = activeMacro();
  document.querySelector("#macroNameInput").value = macro?.name || "";
  document.querySelector("#macroSaveDialog").hidden = false;
  document.querySelector("#macroNameInput").focus();
});
document.querySelector("#cancelMacroSave").addEventListener("click", () => { document.querySelector("#macroSaveDialog").hidden = true; });
document.querySelector("#macroSaveForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!commitDirtyCode()) return;
  saveNamedMacro(document.querySelector("#macroNameInput").value);
  document.querySelector("#macroSaveDialog").hidden = true;
});
document.querySelector("#runButton").addEventListener("click", runScripts);
stopButton.addEventListener("click", stopRunningMacro);
document.querySelector("#settingsButton").addEventListener("click", async () => {
  const shortcut = await window.macroStudio?.getRunShortcut?.() || runShortcutInput.value;
  const providers = await window.macroStudio?.getAiProviders?.();
  const aiConfig = await window.macroStudio?.getAiConfig?.(providers?.selectedProvider);
  runShortcutInput.value = shortcut;
  document.querySelector("#aiProviderInput").value = aiConfig?.provider || providers?.selectedProvider || "github";
  document.querySelector("#aiModelInput").value = aiConfig?.model || "";
  document.querySelector("#aiEndpointInput").value = aiConfig?.endpoint || "";
  document.querySelector("#aiTokenInput").value = "";
  document.querySelector("#aiConfigMessage").textContent = aiConfig?.configured ? `${aiConfig.provider} is configured. Enter a new key only to replace it.` : "Provider keys are stored with Windows credential encryption.";
  shortcutMessage.textContent = "Press a key or key combination to set the global shortcut.";
  settingsDialog.hidden = false;
  updateAiProviderFields();
  runShortcutInput.focus();
});
document.querySelector("#closeSettings").addEventListener("click", () => { settingsDialog.hidden = true; });
function updateAiProviderFields() {
  const provider = document.querySelector("#aiProviderInput").value;
  const labels = { github: "GitHub Models token", openai: "OpenAI API key", gemini: "Google Gemini API key", anthropic: "Anthropic API key", local: "Local server API key" };
  const key = document.querySelector("#aiTokenInput");
  document.querySelector("#aiTokenField").firstChild.textContent = labels[provider];
  key.placeholder = provider === "local" ? "Optional for this local server" : `Paste ${labels[provider]}`;
  key.required = provider !== "local";
  document.querySelector("#aiEndpointInput").placeholder = provider === "local" ? "http://127.0.0.1:1234/v1/chat/completions" : "Used only for local server";
}
document.querySelector("#aiProviderInput").addEventListener("change", updateAiProviderFields);
document.querySelector("#aiProviderInput").addEventListener("change", async (event) => {
  const config = await window.macroStudio?.getAiConfig?.(event.target.value);
  document.querySelector("#aiModelInput").value = config?.model || "";
  document.querySelector("#aiEndpointInput").value = config?.endpoint || "";
  document.querySelector("#aiTokenInput").value = "";
  document.querySelector("#aiConfigMessage").textContent = config?.configured ? `${event.target.value} is configured. Enter a new key only to replace it.` : `Configure ${event.target.value} with its own API key.`;
});
document.querySelector("#saveAiConfig").addEventListener("click", async () => {
  const message = document.querySelector("#aiConfigMessage");
  try {
    const provider = document.querySelector("#aiProviderInput").value;
    const current = await window.macroStudio?.getAiConfig?.(provider);
    const enteredToken = document.querySelector("#aiTokenInput").value.trim();
    if (!enteredToken && provider !== "local" && current?.provider !== provider) throw new Error(`Paste a ${provider === "gemini" ? "Google Gemini" : provider} API key before saving.`);
    const token = enteredToken || (current?.provider === provider ? "__keep__" : "");
    const config = { provider, model: document.querySelector("#aiModelInput").value, endpoint: document.querySelector("#aiEndpointInput").value, token };
    const saved = await window.macroStudio?.setAiConfig?.(config);
    document.querySelector("#aiTokenInput").value = "";
    message.textContent = `${saved.provider} configuration saved with Windows credential encryption. AI requests will use ${saved.provider}.`;
  } catch (error) { message.textContent = error.message || "Could not save AI configuration."; }
});
document.querySelector("#openExecutionLog").addEventListener("click", () => window.macroStudio?.openExecutionLog?.());
runShortcutInput.addEventListener("keydown", async (event) => {
  event.preventDefault();
  const shortcut = shortcutFromEvent(event);
  if (!shortcut) { shortcutMessage.textContent = "Use F1-F12, a letter, or a number."; return; }
  try {
    if (window.macroStudio?.setRunShortcut) await window.macroStudio.setRunShortcut(shortcut);
    runShortcutInput.value = shortcut;
    shortcutMessage.textContent = `${shortcut} will run your macro.`;
  } catch {
    shortcutMessage.textContent = `${shortcut} is unavailable. Choose another shortcut.`;
  }
});
window.macroStudio?.onRunShortcut?.(runScripts);
window.macroStudio?.onPauseShortcut?.(async () => {
  if (!macroRunning) return;
  const paused = await window.macroStudio.toggleMacroPaused();
  document.querySelector("#runStatus").textContent = paused ? "PAUSED" : "RUNNING";
  stopButton.textContent = paused ? "Paused" : "Stop";
});
window.macroStudio?.onUpdateStatus?.((payload) => {
  if (payload?.status === "available") showToast(`Update ${payload.detail} found, downloading...`);
  if (payload?.status === "ready" && confirm(`Update ${payload.detail} is ready. Restart BlockT now to install it?`)) window.macroStudio.quitAndInstallUpdate();
});
document.addEventListener("keydown", (event) => {
  if (window.macroStudio || event.target.matches("input, textarea, [contenteditable='true']")) return;
  if (event.key === runShortcutInput.value) { event.preventDefault(); runScripts(); }
});
document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => {
  const visual = button.textContent.trim() === "Visual blocks";
  if (visual && codeDirty) {
    try { parseCode(); codeDirty = false; showToast("Visual blocks updated from JavaScript"); }
    catch (error) { showToast(error.message); return; }
  }
  if (!visual) codeDirty = false;
  setEditorMode(visual);
}));
codeEditor.addEventListener("input", () => { codeDirty = true; });
document.querySelector("#applyCode").addEventListener("click", () => { try { parseCode(); codeDirty = false; setEditorMode(true); showToast("Selected script updated from JavaScript"); } catch (error) { showToast(error.message); } });
document.querySelector("#newMacro").addEventListener("click", () => { if (!commitDirtyCode()) return; syncActiveMacro(); activeMacroId = null; clearCurrentMacro(); codeDirty = false; renderWorkspace(); showToast("New flow ready. Use Save to name it."); });
document.querySelector("#openFlowLibrary").addEventListener("click", () => { renderFlowLibrary(); document.querySelector("#flowLibraryDialog").hidden = false; });
document.querySelector("#closeFlowLibrary").addEventListener("click", () => { document.querySelector("#flowLibraryDialog").hidden = true; });
document.querySelector("#cancelAppPicker").addEventListener("click", () => { pendingAppPickerBlockId = null; document.querySelector("#appPickerDialog").hidden = true; });
document.querySelector("#refreshOpenApps").addEventListener("click", openAppPicker);
document.querySelector("#cancelDelete").addEventListener("click", () => { pendingDeleteScriptId = null; confirmDialog.hidden = true; });
document.querySelector("#confirmDelete").addEventListener("click", () => {
  const scriptIndex = scripts.findIndex((script) => script.id === pendingDeleteScriptId);
  confirmDialog.hidden = true;
  if (scriptIndex < 0) return;
  snapshot();
  scripts.splice(scriptIndex, 1);
  selectedScriptId = scripts[scriptIndex]?.id || scripts.at(-1)?.id || null;
  selectedBlockId = null;
  pendingDeleteScriptId = null;
  renderWorkspace();
  showToast("Script deleted");
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Backspace" && event.key !== "Delete") return;
  if (event.target.matches?.(".detection-hex, .detection-text")) return;
  const conditionEditor = event.target.closest?.(".detection-editor[data-condition-id]") || (activeDetectionEditor?.matches?.(".detection-editor[data-condition-id]") && activeDetectionEditor);
  if (conditionEditor?.isConnected) {
    event.preventDefault();
    snapshot();
    removeCondition(conditionEditor.dataset.conditionId);
    activeDetectionEditor = null;
    renderWorkspace();
    showToast("Detection condition removed");
    return;
  }
  if (event.target.matches("input, textarea, [contenteditable='true']")) return;
  if (selectedBlockId) {
    event.preventDefault();
    snapshot();
    if (deleteSelectedBlock(selectedBlockId)) {
      selectedBlockId = null;
      renderWorkspace();
      showToast("Block deleted");
    }
    return;
  }
  const scriptIndex = scripts.findIndex((script) => script.id === selectedScriptId);
  if (scriptIndex < 0) return;
  event.preventDefault();
  pendingDeleteScriptId = selectedScriptId;
  confirmDialog.hidden = false;
  document.querySelector("#cancelDelete").focus();
});
window.addEventListener("pagehide", () => { if (stateLoaded) persistMacroStateNow(); });
async function restoreSavedMacro() {
  try {
    const saved = await window.macroStudio?.loadMacroState?.();
    if (saved?.version === 2 && Array.isArray(saved.macros)) {
      macros = saved.macros.filter((macro) => macro?.id && macro?.name && macro?.document);
      activeMacroId = macros.some((macro) => macro.id === saved.activeMacroId) ? saved.activeMacroId : macros[0]?.id || null;
      if (activeMacro()) applyMacroDocument(activeMacro().document);
    } else if (saved?.version === 1) {
      restore(saved);
      macros = [{ id: uid(), name: "Recovered flow", updatedAt: Date.now(), document: macroDocument() }];
      activeMacroId = macros[0].id;
    }
  } catch { showToast("Saved macro could not be restored"); }
  stateLoaded = true;
  renderPalette();
  renderWorkspace();
}
restoreSavedMacro();
