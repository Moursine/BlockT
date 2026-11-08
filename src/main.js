const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, safeStorage, shell, Notification, screen } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");
const execFileAsync = promisify(execFile);
let currentShortcut = "F8";
let executionLogPath = "";
let activeRun = null;
let automationBridge = null;
let macroPaused = false;
let resumeMacro = null;
let aiConfigPath = "";
let legacyGithubTokenPath = "";
let macroStatePath = "";
let activeAiSettings = null;
app.setName("BlockT");
app.setPath("userData", path.join(app.getPath("appData"), "FlowForge"));

function storedAiSettings() {
  if (activeAiSettings) return activeAiSettings;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    if (aiConfigPath && fs.existsSync(aiConfigPath)) {
      const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(aiConfigPath)));
      activeAiSettings = saved.configs ? saved : { selectedProvider: saved.provider || "github", configs: { [saved.provider || "github"]: saved } };
    } else if (legacyGithubTokenPath && fs.existsSync(legacyGithubTokenPath)) activeAiSettings = { selectedProvider: "github", configs: { github: { provider: "github", token: safeStorage.decryptString(fs.readFileSync(legacyGithubTokenPath)), endpoint: "", model: "" } } };
  } catch { return null; }
  return activeAiSettings;
}
function storedAiConfig(provider) {
  const settings = storedAiSettings();
  return settings?.configs?.[provider || settings.selectedProvider] || null;
}
function saveAiConfig(config) {
  const provider = String(config?.provider || "github");
  if (!["github", "openai", "gemini", "anthropic", "local"].includes(provider)) throw new Error("Choose a supported AI provider.");
  const settings = storedAiSettings() || { selectedProvider: provider, configs: {} };
  const previous = settings.configs[provider];
  let token = String(config?.token || "").trim();
  if (token === "__keep__" && previous?.provider === provider) token = previous.token || "";
  const endpoint = String(config?.endpoint || "").trim();
  const model = String(config?.model || "").trim();
  if (provider !== "local" && !token) throw new Error("Enter an API key for the selected provider.");
  if (provider === "local" && endpoint && !/^https?:\/\//i.test(endpoint)) throw new Error("Local endpoint must start with http:// or https://.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
  settings.selectedProvider = provider;
  settings.configs[provider] = { provider, token, endpoint, model };
  activeAiSettings = settings;
  fs.writeFileSync(aiConfigPath, safeStorage.encryptString(JSON.stringify(activeAiSettings)));
  return { provider, model, endpoint, configured: Boolean(token || provider === "local") };
}
function aiJson(text) {
  const content = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed?.blocks)) throw new Error("AI did not return a blocks list.");
  return parsed;
}
async function generateBlocksWithAi(prompt, includeScreen, provider) {
  const config = storedAiConfig(provider);
  if (!config || (!config.token && config.provider !== "local")) throw new Error(`Configure ${provider || "the selected"} AI provider in Settings first.`);
  const request = String(prompt || "").trim();
  if (!request || request.length > 2000) throw new Error("Describe the macro in 1 to 2000 characters.");
  const instruction = `Create BlockT visual blocks for this request: ${request}\nReturn JSON only: {"blocks":[...]}. Allowed action labels: Open program, Open file, Save active file, Wait, Show notification, Type text, Press key, Click mouse, Focus window, Resize window, Minimize window, Set variable, Change variable. Set variable values MUST be "valid_name = value" (for example "ready = true"). Change variable values MUST be "valid_name + number" or "valid_name - number". Containers use kind repeat, if, ifElse, or while with children and optional elseChildren. Screen detection must be a container condition shaped {"kind":"detection","value":"{\\"x1\\":0,\\"y1\\":0,\\"x2\\":0,\\"y2\\":0,\\"color\\":\\"#RRGGBB\\",\\"tolerance\\":20}"}. Use a Detection condition only when useful. To check for words on screen use {"kind":"detection","value":"{\\"x1\\":0,\\"y1\\":0,\\"x2\\":0,\\"y2\\":0,\\"mode\\":\\"text\\",\\"text\\":\\"words to find\\"}"}. Do not invent unsupported labels or code.`;
  let imageDataUrl = "";
  if (includeScreen) {
    const source = (await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1280, height: 720 } }))[0];
    if (!source?.thumbnail || source.thumbnail.isEmpty()) throw new Error("Unable to capture the current screen.");
    imageDataUrl = source.thumbnail.toDataURL();
  }
  const models = { github: "openai/gpt-4.1-mini", openai: "gpt-4.1-mini", gemini: "gemini-3.5-flash", anthropic: "claude-sonnet-4-20250514", local: "local-model" };
  const model = config.model || models[config.provider];
  let endpoint; let headers = { "Content-Type": "application/json" }; let payload; let readContent;
  if (["github", "openai", "local"].includes(config.provider)) {
    endpoint = config.provider === "github" ? "https://models.github.ai/inference/chat/completions" : config.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : (config.endpoint || "http://127.0.0.1:1234/v1/chat/completions");
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    if (config.provider === "github") headers["X-GitHub-Api-Version"] = "2022-11-28";
    const content = [{ type: "text", text: instruction }];
    if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
    payload = { model, temperature: 0.2, messages: [{ role: "system", content: "You generate valid BlockT block JSON. Return only JSON." }, { role: "user", content }] };
    readContent = (body) => body.choices?.[0]?.message?.content;
  } else if (config.provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { ...headers, "x-api-key": config.token, "anthropic-version": "2023-06-01" };
    const content = [{ type: "text", text: instruction }];
    if (imageDataUrl) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: imageDataUrl.split(",")[1] } });
    payload = { model, max_tokens: 3000, temperature: 0.2, system: "You generate valid BlockT block JSON. Return only JSON.", messages: [{ role: "user", content }] };
    readContent = (body) => body.content?.find((item) => item.type === "text")?.text;
  } else {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.token)}`;
    const parts = [{ text: instruction }];
    if (imageDataUrl) parts.push({ inlineData: { mimeType: "image/png", data: imageDataUrl.split(",")[1] } });
    payload = { systemInstruction: { parts: [{ text: "You generate valid BlockT block JSON. Return only JSON." }] }, generationConfig: { temperature: 0.2 }, contents: [{ role: "user", parts }] };
    readContent = (body) => body.candidates?.[0]?.content?.parts?.map((item) => item.text || "").join("");
  }
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`${config.provider} request failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
  const body = await response.json();
  return aiJson(readContent(body));
}

const automationBridgeScript = `
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class MacroFast {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void Click(int x, int y, int button) { SetCursorPos(x, y); if (button == 1) { mouse_event(8, 0, 0, 0, UIntPtr.Zero); mouse_event(16, 0, 0, 0, UIntPtr.Zero); } else { mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); } }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void ButtonDown(int x, int y, int button) { SetCursorPos(x, y); mouse_event(button == 1 ? 8u : 2u, 0, 0, 0, UIntPtr.Zero); }
  public static void ButtonUp(int button) { mouse_event(button == 1 ? 16u : 4u, 0, 0, 0, UIntPtr.Zero); }
  public static bool AreaHasColor(int x, int y, int width, int height, int red, int green, int blue, int tolerance) {
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(x, y, 0, 0, bitmap.Size);
      var rectangle = new Rectangle(0, 0, width, height);
      var data = bitmap.LockBits(rectangle, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      try {
        var stride = Math.Abs(data.Stride); var pixels = new byte[stride * height]; Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        for (var row = 0; row < height; row++) { var rowStart = data.Stride >= 0 ? row * stride : (height - row - 1) * stride; for (var column = 0; column < width; column++) { var offset = rowStart + column * 4; if (Math.Abs(pixels[offset + 2] - red) <= tolerance && Math.Abs(pixels[offset + 1] - green) <= tolerance && Math.Abs(pixels[offset] - blue) <= tolerance) return true; } }
        return false;
      } finally { bitmap.UnlockBits(data); }
    }
  }
}
'@
$script:ocrEngine = $null
function Wait-WinRt($operation, $resultType) {
  $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}
function Initialize-Ocr {
  if ($script:ocrEngine) { return }
  $ProgressPreference = 'SilentlyContinue'
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' })[0]
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { throw 'Windows OCR has no language available. Install a Windows language pack with OCR support.' }
  $script:ocrEngine = $engine
}
function Read-ScreenText([int]$x, [int]$y, [int]$width, [int]$height) {
  Initialize-Ocr
  $scale = 1
  if ($width -le 1500 -and $height -le 800) { $scale = 2 }
  $source = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($source)
  $graphics.CopyFromScreen($x, $y, 0, 0, $source.Size)
  $graphics.Dispose()
  $bitmap = New-Object System.Drawing.Bitmap ($width * $scale), ($height * $scale)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($source, 0, 0, $bitmap.Width, $bitmap.Height)
  $graphics.Dispose()
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $randomAccess = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)
    $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($randomAccess)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Wait-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Wait-WinRt ($script:ocrEngine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
    $result.Text
  } finally { $stream.Dispose(); $bitmap.Dispose(); $source.Dispose() }
}
$input | ForEach-Object {
  try {
    $line = $_.Trim()
    if ([String]::IsNullOrWhiteSpace($line)) { continue }
    $parts = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) -split ','
    if ($parts[0] -eq 'ocr') { $text = [string](Read-ScreenText ([int]$parts[1]) ([int]$parts[2]) ([int]$parts[3]) ([int]$parts[4])); "RESULT:$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))" }
    elseif ($parts[0] -eq 'detect') { $found = [MacroFast]::AreaHasColor([int]$parts[1], [int]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5], [int]$parts[6], [int]$parts[7], [int]$parts[8]); "RESULT:$([int]$found)" }
    elseif ($parts[0] -eq 'click') { [MacroFast]::Click([int]$parts[1], [int]$parts[2], [int]$parts[3]); 'RESULT:OK' }
    elseif ($parts[0] -eq 'down') { [MacroFast]::ButtonDown([int]$parts[1], [int]$parts[2], [int]$parts[3]); 'RESULT:OK' }
    elseif ($parts[0] -eq 'up') { [MacroFast]::ButtonUp([int]$parts[1]); 'RESULT:OK' }
    elseif ($parts[0] -eq 'move') { [MacroFast]::Move([int]$parts[1], [int]$parts[2]); 'RESULT:OK' }
    else { 'RESULT:ERROR:Unknown command' }
  } catch { "RESULT:ERROR:$($_.Exception.Message)" }
}
`;

function logExecution(message) {
  if (!executionLogPath) return;
  fs.appendFileSync(executionLogPath, `${new Date().toISOString()} ${message}\n`);
}

function rejectBridgeRequests(error) {
  if (!automationBridge) return;
  const pending = automationBridge.pending.splice(0);
  for (const request of pending) request.reject(error);
}
function startAutomationBridge() {
  if (automationBridge?.process?.exitCode === null) return automationBridge;
  const encoded = Buffer.from(automationBridgeScript, "utf16le").toString("base64");
  const process = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true });
  automationBridge = { process, pending: [], output: "" };
  process.stdout.on("data", (chunk) => {
    automationBridge.output += chunk.toString();
    const lines = automationBridge.output.split(/\r?\n/);
    automationBridge.output = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("RESULT:")) continue;
      const request = automationBridge.pending.shift();
      if (!request) continue;
      const value = line.slice(7);
      if (value.startsWith("ERROR:")) request.reject(new Error(value.slice(6))); else request.resolve(value);
    }
  });
  process.stderr.on("data", (chunk) => logExecution(`Fast automation worker: ${chunk.toString().trim()}`));
  process.once("error", (error) => rejectBridgeRequests(error));
  process.once("exit", (code) => {
    if (automationBridge?.process === process) {
      rejectBridgeRequests(new Error(`Fast automation worker stopped (${code ?? "unknown"})`));
      automationBridge = null;
    }
  });
  return automationBridge;
}
function fastAutomation(command) {
  const bridge = startAutomationBridge();
  return new Promise((resolve, reject) => {
    bridge.pending.push({ resolve, reject });
    bridge.process.stdin.write(`${Buffer.from(command.join(","), "utf8").toString("base64")}\n`);
  });
}

const inputBridge = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MacroInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit, Size=32)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void TypeText(string text) { var inputs = new INPUT[text.Length * 2]; for (var index = 0; index < text.Length; index++) { var character = text[index]; inputs[index * 2] = new INPUT { type = 1, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = character, dwFlags = 4 } } }; inputs[index * 2 + 1] = new INPUT { type = 1, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = character, dwFlags = 6 } } }; } if (inputs.Length > 0 && SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  public static void MoveRelative(int dx, int dy) { var inputs = new INPUT[1]; inputs[0] = new INPUT { type = 0, U = new INPUTUNION { mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = 1 } } }; if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
  public static void KeyEvent(ushort vk, bool up) { var scan = (ushort)MapVirtualKey(vk, 0); if (scan == 0) throw new ArgumentException("Windows could not map this key to a scan code."); var extended = vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24 || vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2D || vk == 0x2E || vk == 0x6F; var flags = 8u | (uint)(up ? 2 : 0) | (uint)(extended ? 1 : 0); var inputs = new INPUT[1]; inputs[0] = new INPUT { type = 1, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = scan, dwFlags = flags } } }; if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
}
'@
`;

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function ensureRunActive(run) {
  if (run?.cancelled) throw new Error("Macro stopped");
}
async function pausableDelay(milliseconds, run) {
  let remaining = milliseconds;
  while (remaining > 0) {
    ensureRunActive(run);
    await waitIfPaused(run);
    const slice = Math.min(remaining, 100);
    await delay(slice);
    remaining -= slice;
  }
}
async function waitIfPaused(run) {
  while (macroPaused) {
    ensureRunActive(run);
    await new Promise((resolve) => { resumeMacro = resolve; });
  }
}
function toggleMacroPaused() {
  if (!activeRun) return false;
  macroPaused = !macroPaused;
  if (!macroPaused && resumeMacro) { const resume = resumeMacro; resumeMacro = null; resume(); }
  logExecution(`Macro ${macroPaused ? "paused" : "resumed"}.`);
  return macroPaused;
}
function stopMacro() {
  if (!activeRun) return false;
  activeRun.cancelled = true;
  macroPaused = false;
  if (resumeMacro) { const resume = resumeMacro; resumeMacro = null; resume(); }
  logExecution("Macro stop requested.");
  return true;
}
function powerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true });
}
function sendText(text) {
  const value = Buffer.from(String(text), "utf8").toString("base64");
  return powerShell(`${inputBridge}\n$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${value}')); [MacroInput]::TypeText($text)`);
}
async function foregroundWindowDescription() {
  const script = `Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class ForegroundWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder text, int count); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId); }\n'@; $handle = [ForegroundWindow]::GetForegroundWindow(); $builder = New-Object Text.StringBuilder 512; [ForegroundWindow]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null; $id = 0; [ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$id) | Out-Null; $process = Get-Process -Id $id -ErrorAction SilentlyContinue; \"$($process.ProcessName) | $($builder.ToString())\"`;
  const { stdout } = await powerShell(script);
  return stdout.trim() || "unknown foreground window";
}
async function foregroundAppName() {
  const script = `Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class ForegroundProcess { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId); }\n'@; $id = 0; [ForegroundProcess]::GetWindowThreadProcessId([ForegroundProcess]::GetForegroundWindow(), [ref]$id) | Out-Null; $process = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($process) { \"$($process.ProcessName).exe\" }`;
  const { stdout } = await powerShell(script);
  return stdout.trim();
}
async function openApps() {
  const script = `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Sort-Object ProcessName | ForEach-Object { [PSCustomObject]@{ executable = "$($_.ProcessName).exe"; title = $_.MainWindowTitle } } | ConvertTo-Json -Compress`;
  const { stdout } = await powerShell(script);
  const parsed = JSON.parse(stdout.trim() || "[]");
  const apps = Array.isArray(parsed) ? parsed : [parsed];
  return apps.filter((app) => app?.executable && app?.title);
}
function sendKey(key, holdMs = 0) {
  const trimmedKey = String(key).trim();
  const hold = Math.max(0, Math.round(Number(holdMs) || 0));
  const vk = virtualKeyCode(trimmedKey);
  if (vk != null) {
    const script = `${inputBridge}\n[MacroInput]::KeyEvent(${vk}, $false); Start-Sleep -Milliseconds ${hold}; [MacroInput]::KeyEvent(${vk}, $true)`;
    return powerShell(script);
  }
  if (hold > 0) throw new Error(`"${trimmedKey}" cannot be held down; use a letter, a number, or a named key such as Enter, Tab, or an arrow key.`);
  if (trimmedKey.length === 1) return sendText(trimmedKey);
  const specialKeys = { Enter: "{ENTER}", Tab: "{TAB}", Escape: "{ESC}", Space: " ", Backspace: "{BACKSPACE}", Delete: "{DELETE}", Up: "{UP}", Down: "{DOWN}", Left: "{LEFT}", Right: "{RIGHT}" };
  const value = specialKeys[trimmedKey] || (/^F(?:[1-9]|1[0-2])$/.test(trimmedKey) ? `{${trimmedKey}}` : trimmedKey);
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return powerShell(`Add-Type -AssemblyName System.Windows.Forms; $key = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); [System.Windows.Forms.SendKeys]::SendWait($key)`);
}
function virtualKeyCode(key) {
  const specialVk = { Enter: 0x0D, Tab: 0x09, Escape: 0x1B, Space: 0x20, Backspace: 0x08, Delete: 0x2E, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27 };
  if (specialVk[key] !== undefined) return specialVk[key];
  const functionMatch = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (functionMatch) return 0x6F + Number(functionMatch[1]);
  if (/^[A-Za-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0);
  return null;
}
async function smoothMoveMouse(targetX, targetY, durationMs, run) {
  const start = screen.getCursorScreenPoint();
  const totalSteps = Math.max(1, Math.round(durationMs / 15));
  for (let step = 1; step <= totalSteps; step += 1) {
    ensureRunActive(run);
    await waitIfPaused(run);
    const progress = step / totalSteps;
    const x = Math.round(start.x + (targetX - start.x) * progress);
    const y = Math.round(start.y + (targetY - start.y) * progress);
    await fastAutomation(["move", x, y]);
    if (step < totalSteps) await delay(durationMs / totalSteps);
  }
}
const relativeDirectionVectors = { up: [0, -1], "up-right": [1, -1], right: [1, 0], "down-right": [1, 1], down: [0, 1], "down-left": [-1, 1], left: [-1, 0], "up-left": [-1, -1] };
function moveMouseRelative(direction, pixels, durationMs) {
  const [vectorX, vectorY] = relativeDirectionVectors[direction] || relativeDirectionVectors.right;
  const distance = Math.max(0, Math.round(Number(pixels) || 0));
  const scale = vectorX && vectorY ? Math.SQRT1_2 : 1;
  const targetX = Math.round(vectorX * distance * scale);
  const targetY = Math.round(vectorY * distance * scale);
  const steps = Math.max(1, Math.round(Math.max(0, Number(durationMs) || 0) / 15));
  const stepDelay = Math.max(0, Math.round(Math.max(0, Number(durationMs) || 0) / steps));
  const script = `${inputBridge}\n$targetX = ${targetX}; $targetY = ${targetY}; $steps = ${steps}; $delay = ${stepDelay}; $movedX = 0; $movedY = 0; for ($step = 1; $step -le $steps; $step += 1) { $nextX = [Math]::Round($targetX * $step / $steps); $nextY = [Math]::Round($targetY * $step / $steps); [MacroInput]::MoveRelative([int]($nextX - $movedX), [int]($nextY - $movedY)); $movedX = $nextX; $movedY = $nextY; if ($step -lt $steps -and $delay -gt 0) { Start-Sleep -Milliseconds $delay } }`;
  return powerShell(script);
}
function evaluateCondition(condition, variables) {
  const expression = String(condition || "").trim();
  const comparison = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(===|==|!==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparison) {
    const [, name, operator, expected] = comparison;
    const actual = variables[name];
    const right = expected.replace(/^['"]|['"]$/g, "");
    const leftNumber = Number(actual);
    const rightNumber = Number(right);
    const [left, target] = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? [leftNumber, rightNumber] : [String(actual ?? ""), right];
    return ({ "==": left === target, "===": left === target, "!=": left !== target, "!==": left !== target, ">": left > target, ">=": left >= target, "<": left < target, "<=": left <= target })[operator];
  }
  const value = variables[expression];
  return value === true || value === "true" || (Number.isFinite(Number(value)) && Number(value) !== 0);
}
const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
function resolveNumber(token, variables, context) {
  const text = String(token ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (variableNamePattern.test(text)) {
    if (!(text in variables)) throw new Error(`${context}: variable "${text}" has no value yet. Use Set variable first.`);
    const stored = Number(variables[text]);
    if (!Number.isFinite(stored)) throw new Error(`${context}: variable "${text}" is "${variables[text]}", not a number.`);
    return stored;
  }
  const number = Number(text);
  if (text === "" || !Number.isFinite(number)) throw new Error(`${context}: "${text}" is not a number or a variable name.`);
  return number;
}
function randomBetween(minToken, maxToken, variables, context) {
  let low = resolveNumber(minToken, variables, context);
  let high = resolveNumber(maxToken, variables, context);
  if (low > high) [low, high] = [high, low];
  if (Number.isInteger(low) && Number.isInteger(high)) return Math.floor(Math.random() * (high - low + 1)) + low;
  return Math.round((low + Math.random() * (high - low)) * 100) / 100;
}
const randomRangePattern = /^(?:random\s+)?(.+?)\s+to\s+(.+)$/i;
function waitSeconds(value, variables) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const unit = "(?:seconds?|secs?|s)";
  const amount = (text.match(new RegExp(`^(\\d*\\.?\\d+)\\s*${unit}$`, "i")) || text.match(new RegExp(`^(["'][^"']+["'])\\s*${unit}$`, "i")) || text.match(new RegExp(`^(.+?)\\s+${unit}$`, "i")) || [])[1] ?? text;
  return Math.max(0, resolveNumber(amount, variables, "Wait"));
}
function repeatCount(value, variables) {
  const text = String(value ?? "").trim().replace(/\s*times?$/i, "");
  const count = variableNamePattern.test(text) ? resolveNumber(text, variables, "Repeat") : parseInt(text, 10) || 0;
  return Math.min(100, Math.max(0, Math.floor(count)));
}
async function areaHasText(detector) {
  const { x1, y1, x2, y2, text } = detector;
  const wanted = String(text ?? "");
  if (![x1, y1, x2, y2].every(Number.isFinite) || !wanted.trim()) throw new Error("Text detection needs two positions and the words to find");
  const x = Math.min(x1, x2); const y = Math.min(y1, y2); const width = Math.max(1, Math.abs(x2 - x1) + 1); const height = Math.max(1, Math.abs(y2 - y1) + 1);
  if (width * height > 4000000) throw new Error("Detection area is too large; select a smaller area");
  const found = Buffer.from(await fastAutomation(["ocr", x, y, width, height]), "base64").toString("utf8");
  const normalize = (input) => input.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  return normalize(found).includes(normalize(wanted));
}
async function areaHasColor(value) {
  let detector;
  try { detector = JSON.parse(value); } catch { throw new Error("Detection settings are invalid"); }
  if (detector.mode === "text") return areaHasText(detector);
  const { x1, y1, x2, y2, color, tolerance = 0 } = detector;
  if (![x1, y1, x2, y2, tolerance].every(Number.isFinite) || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Detection needs two positions, a color, and tolerance");
  const x = Math.min(x1, x2); const y = Math.min(y1, y2); const width = Math.max(1, Math.abs(x2 - x1) + 1); const height = Math.max(1, Math.abs(y2 - y1) + 1);
  if (width * height > 1000000) throw new Error("Detection area is too large; select a smaller area");
  const rgb = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((component) => parseInt(component, 16));
  const threshold = Math.max(0, Math.min(255, tolerance));
  return (await fastAutomation(["detect", x, y, width, height, ...rgb, threshold])) === "1";
}
async function runBlock(block, result, run) {
  ensureRunActive(run);
  await waitIfPaused(run);
  if (block.kind === "repeat") {
    const times = repeatCount(block.value, result.variables);
    for (let index = 0; index < times; index += 1) for (const child of block.children || []) await runBlock(child, result, run);
    return;
  }
  if (block.kind === "function") {
    for (const child of block.children || []) await runBlock(child, result, run);
    return;
  }
  if (block.kind === "if" || block.kind === "ifElse") {
    const matched = block.condition?.kind === "detection" ? await areaHasColor(block.condition.value) : evaluateCondition(block.value, result.variables);
    const branch = matched ? block.children : block.elseChildren;
    for (const child of branch || []) await runBlock(child, result, run);
    return;
  }
  if (block.kind === "scope") {
    const target = String(block.value || "").trim().toLowerCase();
    const active = target ? (await foregroundWindowDescription()).toLowerCase().includes(target) : false;
    if (active) for (const child of block.children || []) await runBlock(child, result, run);
    return;
  }
  if (block.kind === "while") {
    let iterations = 0;
    while (true) {
      await waitIfPaused(run);
      const matches = block.condition?.kind === "detection" ? await areaHasColor(block.condition.value) : evaluateCondition(block.value, result.variables);
      if (!matches) break;
      ensureRunActive(run);
      if (iterations++ >= 1000000) throw new Error("While condition stopped after 1000000 iterations.");
      for (const child of block.children || []) await runBlock(child, result, run);
      if (iterations % 100 === 0) await delay(0);
    }
    return;
  }
  const value = String(block.value || "");
  if (block.label === "Wait") await pausableDelay(waitSeconds(value, result.variables) * 1000, run);
  else if (block.label === "Create variable" || block.label === "Set variable") {
    const assignment = value.match(/^\s*([^=\s]+)\s*=\s*(.*)\s*$/);
    if (!assignment) throw new Error(`${block.label} needs a name and value, such as count = 0`);
    result.variables[assignment[1]] = assignment[2];
  } else if (block.label === "Random variable") {
    const random = value.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:random\s+)?(.+?)\s+to\s+(.+?)\s*$/i);
    if (!random) throw new Error("Random variable needs a value such as roll = 1 to 6");
    result.variables[random[1]] = String(randomBetween(random[2], random[3], result.variables, "Random variable"));
  } else if (block.label === "Change variable") {
    const change = value.match(/^\s*([^+\-\s]+)\s*([+\-])\s*(.+?)\s*$/);
    if (!change) throw new Error("Change variable needs a value such as count + 1");
    const range = change[3].match(randomRangePattern);
    const amount = range ? randomBetween(range[1], range[2], result.variables, "Change variable") : resolveNumber(change[3], result.variables, "Change variable");
    const current = Number(result.variables[change[1]] || 0);
    result.variables[change[1]] = String(Math.round((current + (change[2] === "+" ? 1 : -1) * amount) * 1e9) / 1e9);
  }
  else if (block.label === "Open program" || block.label === "Open file") {
    const error = await shell.openPath(value);
    if (error) throw new Error(error);
  } else if (block.label === "Type text") {
    logExecution(`Typing ${value.length} character(s).`);
    await sendText(value);
    logExecution(`Typing completed; foreground window: ${await foregroundWindowDescription()}`);
  }
  else if (block.label === "Press key") {
    let press;
    try { press = JSON.parse(value); } catch { press = { key: value.trim(), holdMs: 0 }; }
    await sendKey(String(press.key || "").trim(), Number(press.holdMs) || 0);
  }
  else if (block.label === "Run command") await powerShell(value);
  else if (block.label === "Show notification") new Notification({ title: "BlockT", body: value || "Flow completed" }).show();
  else if (block.label === "Click mouse") {
    let click;
    try { const parsed = JSON.parse(value); click = parsed && typeof parsed === "object" ? parsed : null; } catch { click = null; }
    if (!click) { const [legacyX, legacyY] = value.split(",").map((part) => Number(part.trim())); click = { x: legacyX, y: legacyY, button: "left", atCursor: false }; }
    const point = click.atCursor ? screen.getCursorScreenPoint() : { x: Number(click.x), y: Number(click.y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Click mouse needs coordinates such as 640, 360, or choose "here" to click the current cursor position.');
    const holdMs = Math.max(0, Math.round(Number(click.holdMs) || 0));
    const clickX = Math.round(point.x); const clickY = Math.round(point.y); const button = click.button === "right" ? 1 : 0;
    if (holdMs > 0) {
      await fastAutomation(["down", clickX, clickY, button]);
      try { await pausableDelay(holdMs, run); } finally { await fastAutomation(["up", button]); }
    } else await fastAutomation(["click", clickX, clickY, button]);
  } else if (block.label === "Move mouse") {
    let move;
    try { move = JSON.parse(value); } catch { throw new Error("Move mouse needs a position; capture one with F9."); }
    const x = Number(move.x); const y = Number(move.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Move mouse needs a position such as 640, 360");
    if (move.mode === "smooth") await smoothMoveMouse(x, y, Math.max(0, Number(move.duration) || 0), run);
    else await fastAutomation(["move", Math.round(x), Math.round(y)]);
  } else if (block.label === "Move mouse relative") {
    let move;
    try { move = JSON.parse(value); } catch { throw new Error("Move mouse relative needs a direction, pixel distance, and duration."); }
    await moveMouseRelative(move.direction, move.pixels, move.duration);
  } else result.skipped.push(block.label);
  result.completed += 1;
}
async function runMacros(scripts) {
  const result = { completed: 0, skipped: [], variables: Object.create(null) };
  const run = { cancelled: false };
  activeRun = run;
  macroPaused = false;
  logExecution(`Run started with ${scripts.length} script(s).`);
  try {
    await Promise.all(scripts.map(async (script, index) => {
      logExecution(`Script ${index + 1} started.`);
      for (const block of script.blocks || []) await runBlock(block, result, run);
      logExecution(`Script ${index + 1} completed.`);
    }));
    logExecution(`Run completed: ${result.completed} action(s); skipped: ${result.skipped.join(", ") || "none"}.`);
    return result;
  } catch (error) {
    logExecution(`Run failed: ${error.message}`);
    throw error;
  } finally {
    if (activeRun === run) activeRun = null;
  }
}

function registerRunShortcut(shortcut) {
  globalShortcut.unregister(currentShortcut);
  if (!globalShortcut.register(shortcut, () => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("run-shortcut")))) {
    throw new Error(`Unable to register ${shortcut}`);
  }
  currentShortcut = shortcut;
  return currentShortcut;
}
function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#171819",
    icon: path.join(__dirname, "assets", "blockt-icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") }
  });
  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "Pause") window.webContents.send("pause-shortcut");
  });
  window.loadFile("index.html");
}

function broadcastUpdateStatus(status, detail) {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("update-status", { status, detail }));
}

function initAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => logExecution("Checking for update."));
  autoUpdater.on("update-available", (info) => { logExecution(`Update available: ${info.version}`); broadcastUpdateStatus("available", info.version); });
  autoUpdater.on("update-not-available", () => logExecution("No update available."));
  autoUpdater.on("download-progress", (progress) => broadcastUpdateStatus("downloading", Math.round(progress.percent)));
  autoUpdater.on("update-downloaded", (info) => { logExecution(`Update downloaded: ${info.version}. Will install on quit.`); broadcastUpdateStatus("ready", info.version); });
  autoUpdater.on("error", (error) => logExecution(`Auto-update error: ${error.message}`));
  autoUpdater.checkForUpdates().catch((error) => logExecution(`Auto-update check failed: ${error.message}`));
}

app.whenReady().then(() => {
  executionLogPath = path.join(app.getPath("userData"), "macro-execution.log");
  aiConfigPath = path.join(app.getPath("userData"), "ai-provider-config.bin");
  legacyGithubTokenPath = path.join(app.getPath("userData"), "github-models-token.bin");
  macroStatePath = path.join(app.getPath("userData"), "macro-state.json");
  const legacyMacroStatePaths = [
    path.join(app.getPath("appData"), "FlowForgeuse", "macro-state.json"),
    path.join(app.getPath("appData"), "macro-studio", "macro-state.json")
  ];
  const legacyMacroStatePath = legacyMacroStatePaths.find((statePath) => fs.existsSync(statePath));
  if (!fs.existsSync(macroStatePath) && legacyMacroStatePath) {
    try { fs.copyFileSync(legacyMacroStatePath, macroStatePath); logExecution("Migrated saved flow state to BlockT."); }
    catch (error) { logExecution(`Could not migrate saved flow state: ${error.message}`); }
  }
  logExecution("BlockT started.");
  startAutomationBridge();
  void fastAutomation(["detect", 0, 0, 1, 1, 0, 0, 0, 0])
    .then(() => logExecution("Fast automation worker ready."))
    .catch((error) => logExecution(`Fast automation worker failed: ${error.message}`));
  ipcMain.handle("set-run-shortcut", (_event, shortcut) => registerRunShortcut(shortcut));
  ipcMain.handle("get-run-shortcut", () => currentShortcut);
  ipcMain.handle("run-macros", (_event, scripts) => runMacros(Array.isArray(scripts) ? scripts : []));
  ipcMain.handle("stop-macro", () => stopMacro());
  ipcMain.handle("toggle-macro-paused", () => toggleMacroPaused());
  ipcMain.handle("get-execution-log-path", () => executionLogPath);
  ipcMain.handle("open-execution-log", () => shell.showItemInFolder(executionLogPath));
  ipcMain.handle("get-cursor-position", () => screen.getCursorScreenPoint());
  ipcMain.handle("get-foreground-app", () => foregroundAppName());
  ipcMain.handle("get-open-apps", () => openApps());
  ipcMain.handle("get-primary-display", () => screen.getPrimaryDisplay().bounds);
  ipcMain.handle("load-macro-state", () => {
    try { return fs.existsSync(macroStatePath) ? JSON.parse(fs.readFileSync(macroStatePath, "utf8")) : null; }
    catch (error) { logExecution(`Macro state could not be loaded: ${error.message}`); return null; }
  });
  ipcMain.handle("save-macro-state", (_event, state) => {
    if (!state || typeof state !== "object") throw new Error("Macro state is invalid.");
    fs.writeFileSync(macroStatePath, JSON.stringify(state));
    return true;
  });
  ipcMain.handle("get-cursor-color", async () => {
    const point = screen.getCursorScreenPoint();
    const { stdout } = await powerShell(`Add-Type -AssemblyName System.Drawing; $bitmap = New-Object Drawing.Bitmap 1, 1; $graphics = [Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen(${point.x}, ${point.y}, 0, 0, $bitmap.Size); $pixel = $bitmap.GetPixel(0, 0); $graphics.Dispose(); $bitmap.Dispose(); '#{0:X2}{1:X2}{2:X2}' -f $pixel.R, $pixel.G, $pixel.B`);
    return stdout.trim();
  });
  ipcMain.handle("get-ai-config", (_event, provider) => { const settings = storedAiSettings(); const config = storedAiConfig(provider); return config ? { provider: config.provider, model: config.model, endpoint: config.endpoint, configured: Boolean(config.token || config.provider === "local"), selectedProvider: settings?.selectedProvider || config.provider } : { provider: provider || settings?.selectedProvider || "github", model: "", endpoint: "", configured: false, selectedProvider: settings?.selectedProvider || "github" }; });
  ipcMain.handle("get-ai-providers", () => { const settings = storedAiSettings(); return { selectedProvider: settings?.selectedProvider || "github", configured: Object.fromEntries(Object.entries(settings?.configs || {}).map(([provider, config]) => [provider, Boolean(config.token || provider === "local")])) }; });
  ipcMain.handle("set-ai-config", (_event, config) => saveAiConfig(config));
  ipcMain.handle("generate-blocks-with-ai", (_event, prompt, includeScreen, provider) => generateBlocksWithAi(prompt, Boolean(includeScreen), provider));
  ipcMain.handle("quit-and-install-update", () => autoUpdater.quitAndInstall());
  registerRunShortcut(currentShortcut);
  globalShortcut.register("MediaPlayPause", () => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("pause-shortcut")));
  createWindow();
  initAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { globalShortcut.unregisterAll(); automationBridge?.process?.kill(); });