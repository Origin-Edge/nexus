// Nexus AI Studio — Live Artifact Execution & 1-Click Public Deployment Engine
let currentSandboxCode = "";
let currentDeviceMode = "desktop";
let lastPublishData = null;

function openSandbox(code) {
    currentSandboxCode = code || "";
    const modal = document.getElementById("sandboxModal");
    if (!modal) return;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    setDeviceMode("desktop");
    runSandboxCode();
}

function closeSandbox() {
    const modal = document.getElementById("sandboxModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function setDeviceMode(mode) {
    currentDeviceMode = mode;
    const iframeWrapper = document.getElementById("sandboxFrameWrapper");
    const btns = document.querySelectorAll(".device-btn");
    btns.forEach(b => b.classList.remove("active-device"));

    const activeBtn = document.getElementById(`deviceBtn-${mode}`);
    if (activeBtn) activeBtn.classList.add("active-device");

    if (!iframeWrapper) return;
    if (mode === "desktop") {
        iframeWrapper.style.width = "100%";
    } else if (mode === "tablet") {
        iframeWrapper.style.width = "768px";
    } else if (mode === "mobile") {
        iframeWrapper.style.width = "375px";
    }
}

function runSandboxCode() {
    const iframe = document.getElementById("sandboxIframe");
    if (!iframe) return;

    let html = currentSandboxCode || "";

    // If it's not a full HTML document, wrap it
    if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
        html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 1.5rem; background: #0f172a; color: #f8fafc; }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
    } else {
        // Auto-inject Tailwind and Icons if missing
        if (!html.includes("tailwindcss") && !html.includes("tailwind.min.css")) {
            if (html.includes("<head>")) {
                html = html.replace("<head>", '<head>\n  <script src="https://cdn.tailwindcss.com"></script>');
            } else {
                html = `<script src="https://cdn.tailwindcss.com"></script>\n` + html;
            }
        }
        if (!html.includes("font-awesome") && !html.includes("fontawesome")) {
            if (html.includes("</head>")) {
                html = html.replace("</head>", '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">\n</head>');
            }
        }
    }

    iframe.srcdoc = html;
}

function downloadSandboxHtml() {
    const blob = new Blob([currentSandboxCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexus-artifact-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function copySandboxCode() {
    navigator.clipboard.writeText(currentSandboxCode);
    showToast(typeof t === 'function' ? t("copied") : "Kopyalandı!");
}

// 1-Click Live Deploy to World via Cloudflare Tunnel
async function publishCurrentArtifact() {
    if (!currentSandboxCode) {
        showToast("Yayınlanacak kod bulunamadı!");
        return;
    }
    await publishDirectCode(currentSandboxCode);
}

async function publishDirectCode(code) {
    const cleanCode = (code || "").trim();
    if (!cleanCode) {
        showToast("Yayınlanacak HTML kodu boş olamaz!");
        return;
    }

    const btn = document.getElementById("publishArtifactBtn");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Yayınlanıyor…</span>';
    }

    try {
        // Extract title if available
        let appTitle = "Nexus AI Generated App";
        const titleMatch = cleanCode.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            appTitle = titleMatch[1].trim();
        }

        const res = await fetch("/api/deploy/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                html: cleanCode,
                title: appTitle
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();
        lastPublishData = data;
        openPublishModal(data);
        showToast("Sayfan yayınlandı.");

    } catch (e) {
        console.error("Publish error:", e);
        showToast(`Yayınlanamadı: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span>Yayınla</span>';
        }
    }
}

function openPublishModal(data) {
    let modal = document.getElementById("publishSuccessModal");
    if (!modal) {
        createPublishModalElement();
        modal = document.getElementById("publishSuccessModal");
    }

    // Sunucu yerel ağ adresini bulamadıysa (Docker bridge) tarayıcının kullandığı adres esas alınır.
    const tam = (u) => (u && u.startsWith("/")) ? location.origin + u : u;
    const localUrl = tam(data.local_url) || location.origin + (data.local_path || "");
    const pubUrl = tam(data.public_url) || localUrl;

    document.getElementById("publishModalTitle").textContent = data.title || "Nexus Web Uygulaması";
    document.getElementById("publishPublicUrlInput").value = pubUrl;
    document.getElementById("publishLocalUrlInput").value = localUrl;
    
    // Status text & badge
    const statusText = document.getElementById("publishStatusBadge");
    if (statusText) {
        if (data.tunnel_active) {
            statusText.className = "nx-rozet";
            statusText.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> İnternetten erişilebilir';
        } else {
            statusText.className = "nx-rozet";
            statusText.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Yalnızca yerel ağda. İnternete açmak için Kontrol paneli › Tünel';
        }
    }

    // QR Code
    const qrImg = document.getElementById("publishQrCodeImg");
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pubUrl)}`;
    }

    // Open button link
    const openBtn = document.getElementById("publishOpenNewTabBtn");
    if (openBtn) {
        openBtn.href = pubUrl;
    }

    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closePublishModal() {
    const modal = document.getElementById("publishSuccessModal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function copyPublishUrl(type) {
    const inputId = type === 'public' ? 'publishPublicUrlInput' : 'publishLocalUrlInput';
    const input = document.getElementById(inputId);
    if (input) {
        navigator.clipboard.writeText(input.value);
        showToast("Bağlantı panoya kopyalandı!");
    }
}

function createPublishModalElement() {
    const div = document.createElement("div");
    div.id = "publishSuccessModal";
    div.className = "fixed inset-0 bg-slate-900/50 backdrop-blur-sm hidden z-50 items-center justify-center p-4";
    div.setAttribute("role", "dialog");
    div.setAttribute("aria-modal", "true");
    div.innerHTML = `
        <div class="nx-kutu w-full max-w-xl p-5 space-y-5 animate-fade-in">
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <h2 class="text-base font-semibold">Sayfan yayında</h2>
                    <div id="publishModalTitle" class="text-sm nx-ikinci truncate">Nexus web uygulaması</div>
                </div>
                <button onclick="closePublishModal()" class="nx-btn nx-btn-hayalet" aria-label="Kapat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div id="publishStatusBadge" class="nx-rozet">Yayında</div>
            <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-5 items-center">
                <div class="flex flex-col items-center gap-1.5">
                    <div class="p-2 bg-white rounded-xl ring-1 ring-slate-200"><img id="publishQrCodeImg" src="" alt="Bağlantının QR kodu" class="w-28 h-28 object-contain"></div>
                    <span class="text-xs nx-soluk">Telefonla tara</span>
                </div>
                <div class="space-y-3 min-w-0">
                    <div>
                        <label for="publishPublicUrlInput" class="nx-etiket">Paylaşım bağlantısı</label>
                        <div class="flex gap-1.5">
                            <input type="text" id="publishPublicUrlInput" readonly class="nx-girdi mono text-xs">
                            <button onclick="copyPublishUrl('public')" class="nx-btn nx-btn-ikinci" title="Kopyala" aria-label="Bağlantıyı kopyala"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
                        </div>
                    </div>
                    <div>
                        <label for="publishLocalUrlInput" class="nx-etiket">Yerel ağ bağlantısı</label>
                        <div class="flex gap-1.5">
                            <input type="text" id="publishLocalUrlInput" readonly class="nx-girdi mono text-xs">
                            <button onclick="copyPublishUrl('local')" class="nx-btn nx-btn-ikinci" title="Kopyala" aria-label="Yerel bağlantıyı kopyala"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 pt-1">
                <button onclick="closePublishModal()" class="nx-btn nx-btn-ikinci">Kapat</button>
                <a id="publishOpenNewTabBtn" href="#" target="_blank" rel="noopener" class="nx-btn nx-btn-ana">Yeni sekmede aç</a>
            </div>
        </div>
    `;
    document.body.appendChild(div);
}

// Global scope window exports
window.openSandbox = openSandbox;
window.closeSandbox = closeSandbox;
window.setDeviceMode = setDeviceMode;
window.runSandboxCode = runSandboxCode;
window.downloadSandboxHtml = downloadSandboxHtml;
window.copySandboxCode = copySandboxCode;
window.publishCurrentArtifact = publishCurrentArtifact;
window.publishDirectCode = publishDirectCode;
window.openPublishModal = openPublishModal;
window.closePublishModal = closePublishModal;
window.copyPublishUrl = copyPublishUrl;

