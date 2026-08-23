const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const preview = new URLSearchParams(location.search).has("preview");
const apk = new URLSearchParams(location.search).has("apk");
const loginView = $("#login-view");
const appView = $("#app-view");
const dialog = $("#result-dialog");
const imageViewerDialog = $("#image-viewer-dialog");
const imageViewerImage = $("#image-viewer-image");
const imageViewerStage = $("#image-viewer-stage");
const tokenKey = "chengda.mobile.admin.token";
const serverKey = "chengda.mobile.server.url";
const visionBaseKey = "chengda.mobile.vision.base";
const visionModelKey = "chengda.mobile.vision.model";
const visionSecretKey = "chengda.mobile.vision.api-key";
const defaultServer = "http://49.233.178.160";
let adminToken = "";
let serverBase = "";
let imageUrls = [];
let imageViewerScale = 1;
const imageViewerPointers = new Map();
let imageViewerGesture = null;

const platformLabels = {
  douyin: "抖音",
  bilibili: "哔哩哔哩",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  shipinhao: "视频号",
  other: "其他平台",
};

const statusLabels = {
  pending: "等待审核",
  approved: "审核通过 · 待发码",
  rewarded: "三天码已发放",
  rejected: "已驳回",
};

const previewSubmissions = [{
  id: "preview-id",
  claimCode: "YQ-8K3P2M",
  platform: "douyin",
  accountName: "清风同学",
  videoUrl: "https://www.douyin.com/video/1234567890",
  qq: "123456789",
  status: "pending",
  submittedAt: new Date().toISOString(),
  confirmedPublishedOneDay: true,
  confirmedFollowedOwner: true,
  confirmedMentionedOwner: true,
  screenshotExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
  screenshotUrl: "",
  aiReview: null,
}];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function normalizeServer(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch { throw new Error("服务器地址格式不正确。"); }
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${serverBase}${path}`;
}

function nativeBridge() {
  return apk && window.ChengdaNative ? window.ChengdaNative : null;
}

function getSavedSecret(key) {
  const native = nativeBridge();
  if (native?.getSecret) return native.getSecret(key) || "";
  return localStorage.getItem(key) || "";
}

function saveSecret(key, value) {
  const native = nativeBridge();
  if (native?.setSecret) native.setSecret(key, value);
  else if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

async function api(path, options = {}) {
  if (preview) {
    if (path === "/api/admin/summary") return { summary: { pending: 2, approved: 1, rewardedToday: 3, reviewMode: "manual", storedScreenshotBytes: 835420 } };
    if (/\/api\/admin\/invitations\/[^/]+\/(approve|reject|reward|ai-result)$/.test(path)) return { ok: true, submission: previewSubmissions[0], code: "CDAI-7K9P-N4TX-WQ2M" };
    if (path.startsWith("/api/admin/invitations")) return { submissions: previewSubmissions, cleanup: { deletedCount: 2, releasedBytes: 524288 } };
    if (path === "/api/admin/settings") return { settings: { reviewMode: "manual", imageRetentionDays: 7 } };
    if (path === "/api/admin/licenses/generate") return { created: [{ code: "CDAI-7K9P-N4TX-WQ2M" }] };
    return { ok: true };
  }
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new Error("服务器没有返回管理接口数据，请确认服务端已升级到 v0.4.3。");
  if (!response.ok) {
    const error = new Error(payload.message || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setLoginMessage(message, error = false) {
  const target = $("#login-message");
  target.textContent = message;
  target.classList.toggle("error", error);
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
}

function showLogin() {
  appView.hidden = true;
  loginView.hidden = false;
}

function switchPanel(panelId) {
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
  $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.panel === panelId));
}

function showCodes(codes) {
  $("#generated-codes").innerHTML = codes.map((code) => `<code>${escapeHtml(code)}</code>`).join("");
  $("#copy-codes").textContent = "复制全部";
  dialog.showModal();
}

function setImageViewerScale(value) {
  imageViewerScale = Math.max(1, Math.min(5, Number(value) || 1));
  imageViewerImage.style.width = `${imageViewerScale * 100}%`;
  imageViewerImage.style.height = `${imageViewerScale * 100}%`;
  $("#image-zoom-reset").textContent = `${Math.round(imageViewerScale * 100)}%`;
  if (imageViewerScale === 1) {
    imageViewerStage.scrollLeft = 0;
    imageViewerStage.scrollTop = 0;
  }
}

function openImageViewer(source, alt = "审核图片") {
  if (!source) return;
  imageViewerImage.src = source;
  imageViewerImage.alt = alt;
  setImageViewerScale(1);
  if (!imageViewerDialog.open) imageViewerDialog.showModal();
}

function closeImageViewer() {
  imageViewerPointers.clear();
  imageViewerGesture = null;
  imageViewerDialog.close();
}

function pointerDistance() {
  const points = [...imageViewerPointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

async function loadProtectedImage(image, path) {
  if (!path || preview) return;
  try {
    const response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error();
    const url = URL.createObjectURL(await response.blob());
    imageUrls.push(url);
    image.src = url;
    image.hidden = false;
    image.previousElementSibling.hidden = true;
  } catch {
    image.previousElementSibling.textContent = "截图加载失败";
  }
}

function actionButtons(item) {
  if (item.status === "pending") return '<button class="secondary" data-action="reject">驳回</button><button class="ai" data-action="ai">AI 初审</button><button class="primary" data-action="approve">通过</button>';
  if (item.status === "approved") return '<button class="primary wide" data-action="reward">生成三天奖励码</button>';
  return "";
}

function renderSubmissions(submissions) {
  if (imageViewerDialog.open) closeImageViewer();
  imageUrls.forEach((url) => URL.revokeObjectURL(url));
  imageUrls = [];
  const list = $("#invitation-list");
  if (!submissions.length) {
    list.innerHTML = '<div class="empty-state"><strong>这里暂时没有记录</strong><span>切换筛选条件或稍后刷新。</span></div>';
    return;
  }
  list.innerHTML = submissions.map((item) => `
    <article class="submission-card" data-id="${escapeHtml(item.id)}">
      <div class="submission-top"><span class="status ${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span><time>${escapeHtml(formatTime(item.submittedAt))}</time></div>
      <h2>${escapeHtml(platformLabels[item.platform] || item.platform)} · ${escapeHtml(item.accountName)}</h2>
      <p>QQ ${escapeHtml(item.qq)} · 领取编号 ${escapeHtml(item.claimCode)}</p>
      <a class="video-link" href="${escapeHtml(item.videoUrl)}" target="_blank" rel="noreferrer">打开提交的视频链接</a>
      <div class="proof-row"><div class="proof-media"><div class="proof-placeholder">${item.screenshotDeletedAt ? "截图已按规则清理" : "评论区 @ 截图"}</div><img alt="用户提交的评论区 @ 截图，点击全屏放大" hidden /></div><div><strong>${item.confirmedFollowedOwner && item.confirmedMentionedOwner ? "已声明关注并 @等风吹" : "等待核验"}</strong><span>${item.aiReview ? `AI：${escapeHtml(item.aiReview.summary)}` : (item.screenshotExpiresAt ? `截图保存至 ${escapeHtml(formatTime(item.screenshotExpiresAt))} · 点击图片可放大` : "截图最多保存 7 天")}</span></div></div>
      ${item.rejectionReason ? `<div class="reject-reason">${escapeHtml(item.rejectionReason)}</div>` : ""}
      ${actionButtons(item) ? `<div class="button-row ${item.status === "approved" ? "single" : "three"}">${actionButtons(item)}</div>` : ""}
    </article>`).join("");
  submissions.forEach((item) => {
    const card = list.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    loadProtectedImage(card.querySelector(".proof-media img"), item.screenshotUrl);
  });
}

async function refreshDashboard() {
  const status = $("#status-filter").value;
  const [summaryResult, listResult, settingsResult] = await Promise.all([
    api("/api/admin/summary"),
    api(`/api/admin/invitations?status=${encodeURIComponent(status)}`),
    api("/api/admin/settings"),
  ]);
  $("#pending-count").textContent = summaryResult.summary.pending;
  $("#approved-count").textContent = summaryResult.summary.approved;
  $("#today-count").textContent = summaryResult.summary.rewardedToday;
  $("#review-mode").value = settingsResult.settings.reviewMode;
  $("#vision-secret-state").textContent = getSavedSecret(visionSecretKey) ? "API Key 已加密保存在这台手机" : "尚未保存视觉 API Key";
  renderSubmissions(listResult.submissions);
}

async function login() {
  const token = $("#admin-token").value.trim();
  if (!token && !preview) { setLoginMessage("请输入管理员口令。", true); return; }
  adminToken = token || "preview";
  try { serverBase = preview ? "" : normalizeServer($("#server-url").value); } catch (error) { setLoginMessage(error.message, true); return; }
  setLoginMessage("正在连接管理端…");
  try {
    await api("/api/admin/summary");
    if (!preview && $("#remember-token").checked) saveSecret(tokenKey, adminToken);
    else sessionStorage.setItem(tokenKey, adminToken);
    if (!preview) localStorage.setItem(serverKey, serverBase);
    showApp();
    await refreshDashboard();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      saveSecret(tokenKey, "");
      sessionStorage.removeItem(tokenKey);
    }
    setLoginMessage(error.message, true);
  }
}

$("#login-button").addEventListener("click", login);
$("#admin-token").addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
$$(".bottom-nav button").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
$("#duration").addEventListener("change", (event) => { $("#custom-duration-row").hidden = event.target.value !== "custom"; });
$("#status-filter").addEventListener("change", () => refreshDashboard().catch((error) => alert(error.message)));
$("#refresh-button").addEventListener("click", () => refreshDashboard().catch((error) => alert(error.message)));

$("#invitation-list").addEventListener("click", async (event) => {
  const proofImage = event.target.closest(".proof-media img");
  if (proofImage && !proofImage.hidden) {
    openImageViewer(proofImage.src, proofImage.alt);
    return;
  }
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-id]");
  if (!button || !card) return;
  const id = card.dataset.id;
  button.disabled = true;
  try {
    if (button.dataset.action === "reject") {
      const reason = prompt("请输入驳回原因", "截图无法证明视频已发布满 24 小时，请重新提交。");
      if (reason === null) return;
      await api(`/api/admin/invitations/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    } else if (button.dataset.action === "approve") {
      await api(`/api/admin/invitations/${encodeURIComponent(id)}/approve`, { method: "POST", body: "{}" });
    } else if (button.dataset.action === "ai") {
      const image = card.querySelector(".proof-media img");
      if (!image?.src || image.hidden) throw new Error("截图尚未加载，无法进行 AI 初审。");
      const result = await runVisionReview(image.src, card.querySelector(".video-link")?.href || "");
      await api(`/api/admin/invitations/${encodeURIComponent(id)}/ai-result`, { method: "POST", body: JSON.stringify(result) });
      alert(`AI 初审完成：${result.summary}\n可信度：${Math.round(result.confidence * 100)}%${result.eligible && result.confidence >= 0.9 ? "\n已自动通过" : "\n保留人工判断"}`);
    } else if (button.dataset.action === "reward") {
      const result = await api(`/api/admin/invitations/${encodeURIComponent(id)}/reward`, { method: "POST", body: "{}" });
      showCodes([result.code]);
    }
    await refreshDashboard();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#generate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const durationId = $("#duration").value;
  const body = {
    count: Number($("#license-count").value || 1),
    note: $("#license-note").value.trim(),
    ...(durationId === "custom" ? { durationSeconds: Number($("#custom-duration").value) } : { durationId }),
  };
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api("/api/admin/licenses/generate", { method: "POST", body: JSON.stringify(body) });
    showCodes(result.created.map((entry) => entry.code));
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#save-settings").addEventListener("click", async () => {
  const button = $("#save-settings");
  button.disabled = true;
  try {
    await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ reviewMode: $("#review-mode").value }) });
    const enteredKey = $("#vision-api-key").value.trim();
    if (enteredKey) {
      saveSecret(visionSecretKey, enteredKey);
      $("#vision-api-key").value = "";
    }
    localStorage.setItem(visionBaseKey, $("#vision-base-url").value.trim().replace(/\/+$/, ""));
    localStorage.setItem(visionModelKey, $("#vision-model").value.trim());
    $("#vision-secret-state").textContent = getSavedSecret(visionSecretKey) ? "API Key 已加密保存在这台手机" : "尚未保存视觉 API Key";
    button.textContent = "已保存";
    setTimeout(() => { button.textContent = "保存全部设置"; }, 1200);
    await refreshDashboard();
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});

function parseVisionResult(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("视觉模型没有返回有效 JSON。");
  const parsed = JSON.parse(match[0]);
  return {
    eligible: Boolean(parsed.eligible),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    summary: String(parsed.summary || parsed.reason || "AI 已完成初审。").slice(0, 300),
  };
}

async function runVisionReview(imageUrl, videoUrl) {
  const apiKey = getSavedSecret(visionSecretKey);
  const baseUrl = $("#vision-base-url").value.trim().replace(/\/+$/, "");
  const model = $("#vision-model").value.trim();
  if (!apiKey) throw new Error("请先在设置中保存硅基流动 API Key。");
  if (!model) throw new Error("请填写视觉模型名称。");
  const imageDataUrl = imageUrl.startsWith("data:") ? imageUrl : await fetch(imageUrl).then(async (response) => {
    if (!response.ok) throw new Error("无法读取审核截图。");
    const blob = await response.blob();
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
  });
  const native = nativeBridge();
  if (native?.reviewInvitation) {
    const payload = JSON.parse(native.reviewInvitation(baseUrl, model, imageDataUrl, videoUrl));
    if (!payload.ok) throw new Error(payload.message || "视觉 API 调用失败。");
    return parseVisionResult(payload.content);
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 300, messages: [{ role: "user", content: [
      { type: "text", text: `审核抖音邀请奖励。视频链接：${videoUrl}。判断截图是否像真实评论区，并清楚显示 @等风吹 或 @抖音号31741476172。只返回JSON：{\"eligible\":true或false,\"confidence\":0到1,\"summary\":\"中文短说明\"}。` },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ] }] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `视觉 API 返回 HTTP ${response.status}`);
  return parseVisionResult(payload?.choices?.[0]?.message?.content);
}

$("#test-vision").addEventListener("click", async () => {
  const button = $("#test-vision");
  button.disabled = true;
  try {
    const entered = $("#vision-api-key").value.trim();
    if (entered) saveSecret(visionSecretKey, entered);
    const apiKey = getSavedSecret(visionSecretKey);
    if (!apiKey) throw new Error("请先输入硅基流动 API Key。");
    const native = nativeBridge();
    if (native?.testSiliconFlow) {
      const result = JSON.parse(native.testSiliconFlow($("#vision-base-url").value.trim().replace(/\/+$/, ""), $("#vision-model").value.trim()));
      if (!result.ok) throw new Error(result.message);
    } else {
      const response = await fetch(`${$("#vision-base-url").value.trim().replace(/\/+$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`API 返回 HTTP ${response.status}`);
    }
    button.textContent = "配置可用";
    $("#vision-secret-state").textContent = "API Key 已保存，连接测试成功";
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; setTimeout(() => { button.textContent = "测试视觉 API 配置"; }, 1500); }
});

$("#cleanup-images").addEventListener("click", async () => {
  const result = await api("/api/admin/invitations/cleanup", { method: "POST", body: "{}" });
  alert(`清理完成：删除 ${result.cleanup.deletedCount} 张截图，释放 ${(result.cleanup.releasedBytes / 1024 / 1024).toFixed(2)} MB。`);
  await refreshDashboard();
});

$("#close-dialog").addEventListener("click", () => dialog.close());
$("#close-image-viewer").addEventListener("click", closeImageViewer);
$("#image-zoom-in").addEventListener("click", () => setImageViewerScale(imageViewerScale + 0.5));
$("#image-zoom-out").addEventListener("click", () => setImageViewerScale(imageViewerScale - 0.5));
$("#image-zoom-reset").addEventListener("click", () => setImageViewerScale(1));
document.addEventListener("click", (event) => {
  const image = event.target.closest("img[data-viewer-image]");
  if (image) openImageViewer(image.src, image.alt);
});
imageViewerImage.addEventListener("pointerdown", (event) => {
  imageViewerImage.setPointerCapture(event.pointerId);
  imageViewerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (imageViewerPointers.size === 2) imageViewerGesture = { distance: pointerDistance(), scale: imageViewerScale };
});
imageViewerImage.addEventListener("pointermove", (event) => {
  const previous = imageViewerPointers.get(event.pointerId);
  if (!previous) return;
  imageViewerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (imageViewerPointers.size >= 2 && imageViewerGesture?.distance) {
    setImageViewerScale(imageViewerGesture.scale * pointerDistance() / imageViewerGesture.distance);
  } else if (imageViewerScale > 1) {
    imageViewerStage.scrollLeft += previous.x - event.clientX;
    imageViewerStage.scrollTop += previous.y - event.clientY;
  }
});
function releaseImagePointer(event) {
  imageViewerPointers.delete(event.pointerId);
  if (imageViewerPointers.size < 2) imageViewerGesture = null;
}
imageViewerImage.addEventListener("pointerup", releaseImagePointer);
imageViewerImage.addEventListener("pointercancel", releaseImagePointer);
$("#copy-codes").addEventListener("click", async () => {
  await navigator.clipboard?.writeText($("#generated-codes").innerText);
  $("#copy-codes").textContent = "已复制";
});
$("#logout-button").addEventListener("click", () => {
  saveSecret(tokenKey, "");
  sessionStorage.removeItem(tokenKey);
  adminToken = "";
  $("#admin-token").value = "";
  showLogin();
});

if (preview) {
  serverBase = "";
  adminToken = "preview";
  showApp();
  refreshDashboard();
} else {
  serverBase = localStorage.getItem(serverKey) || defaultServer;
  $("#server-url").value = serverBase;
  $("#vision-base-url").value = localStorage.getItem(visionBaseKey) || "https://api.siliconflow.cn/v1";
  $("#vision-model").value = localStorage.getItem(visionModelKey) || "Qwen/Qwen3-VL-32B-Instruct";
  adminToken = sessionStorage.getItem(tokenKey) || getSavedSecret(tokenKey) || "";
  if (adminToken) {
    $("#admin-token").value = adminToken;
    $("#remember-token").checked = true;
    setLoginMessage("正在使用本机加密保存的管理员口令自动登录…");
    login().catch(() => {});
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}
