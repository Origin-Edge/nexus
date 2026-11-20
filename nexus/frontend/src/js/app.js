// Nexus AI Studio — Main Controller Engine
const KOPYA_SIMGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
// NOTE: activeProvider, activeModel, getProviderHeaders(), fetchModelsForActiveProvider()
// are defined in providers.js (loaded before this file). Do NOT redeclare them here.
let currentChatId = null;
let chatsHistory = JSON.parse(localStorage.getItem("nexus_chats") || "[]");
let currentMessages = [];
let activeAbortController = null;
let currentPersonaPrompt = "";
// currentLang, setLanguage(), applyTranslations(), t() are defined in i18n.js

document.addEventListener("DOMContentLoaded", () => {
    initChatInterface();
    loadPresets();
    fetchModelsForActiveProvider();
});

function getSessionId() {
    let sid = localStorage.getItem("nexus_session_id");
    if (!sid) {
        sid = "sess_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
        localStorage.setItem("nexus_session_id", sid);
    }
    return sid;
}

async function syncChatsWithServer() {
    try {
        const res = await fetch("/api/chats", {
            headers: { "X-Session-ID": getSessionId() }
        });
        const data = await res.json();
        if (data.status === "ok" && data.chats && data.chats.length > 0) {
            chatsHistory = data.chats;
            localStorage.setItem("nexus_chats", JSON.stringify(chatsHistory));
            renderChatsList();
            if (!currentChatId || !chatsHistory.find(c => c.id === currentChatId)) {
                loadChat(chatsHistory[0].id);
            }
        }
    } catch (e) {
        console.warn("Server chat sync skipped:", e);
    }
}

async function persistChatToServer(chatObj) {
    if (!chatObj) return;
    try {
        await fetch("/api/chats", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Session-ID": getSessionId()
            },
            body: JSON.stringify(chatObj)
        });
    } catch (e) {}
}

function initChatInterface() {
    renderChatsList();
    if (chatsHistory.length > 0) {
        loadChat(chatsHistory[0].id);
    } else {
        createNewChat();
    }
    syncChatsWithServer();

    const input = document.getElementById("promptInput");
    if (input) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        input.addEventListener("input", () => autoResizeInput(input));
    }
}

function autoResizeInput(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

function createNewChat() {
    currentChatId = "chat_" + Date.now();
    currentMessages = [];
    renderMessages();
    
    const input = document.getElementById("promptInput");
    if (input) {
        input.value = "";
        input.focus();
    }
}

function renderChatsList() {
    const list = document.getElementById("chatsHistoryList");
    if (!list) return;

    list.innerHTML = "";
    const aranan = ((document.getElementById("searchChatInput") || {}).value || "").trim().toLocaleLowerCase("tr");
    chatsHistory.filter(c => !aranan || (c.title || "").toLocaleLowerCase("tr").includes(aranan)).forEach(chat => {
        const item = document.createElement("div");
        const isActive = chat.id === currentChatId;
        item.className = `nx-sohbet${isActive ? " aktif" : ""}`;
        item.innerHTML = `
            <span class="truncate flex-1" onclick="loadChat('${escapeHtml(String(chat.id))}'); if (typeof yanKapat === 'function') yanKapat();">${escapeHtml(chat.title || "Yeni sohbet")}</span>
            <button onclick="deleteChat('${escapeHtml(String(chat.id))}', event)" class="sil" title="Sohbeti sil" aria-label="Sohbeti sil">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
            </button>
        `;
        list.appendChild(item);
    });
}

function loadChat(id) {
    currentChatId = id;
    const chat = chatsHistory.find(c => c.id === id);
    if (chat) {
        currentMessages = chat.messages || [];
    }
    renderChatsList();
    renderMessages();
}

async function deleteChat(id, e) {
    if (e) e.stopPropagation();
    chatsHistory = chatsHistory.filter(c => c.id !== id);
    localStorage.setItem("nexus_chats", JSON.stringify(chatsHistory));
    try {
        await fetch(`/api/chats/${id}`, {
            method: "DELETE",
            headers: { "X-Session-ID": getSessionId() }
        });
    } catch (e) {}
    if (currentChatId === id) {
        if (chatsHistory.length > 0) loadChat(chatsHistory[0].id);
        else createNewChat();
    } else {
        renderChatsList();
    }
}

function renderMessages() {
    const container = document.getElementById("messagesContainer");
    const welcome = document.getElementById("welcomeHero");
    if (!container) return;

    if (currentMessages.length === 0) {
        container.innerHTML = "";
        if (welcome) welcome.classList.remove("hidden");
        return;
    }

    if (welcome) welcome.classList.add("hidden");
    container.innerHTML = "";

    currentMessages.forEach((msg, idx) => {
        const isUser = msg.role === "user";
        const div = document.createElement("div");
        div.className = `flex gap-3 ${isUser ? "justify-end" : "justify-start"} animate-fade-in`;

        if (isUser) {
            div.innerHTML = `
                <div class="nx-mesaj-kullanici">${escapeHtml(msg.content)}</div>
            `;
        } else {
            div.innerHTML = `
                <div class="nx-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18V6l12 12V6"/></svg></div>
                <div class="nx-mesaj-yz markdown-body">
                    ${renderMarkdown(msg.content)}
                </div>
            `;
        }
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
    highlightCodeBlocks();
}

async function sendMessage() {
    const input = document.getElementById("promptInput");
    if (!input || !input.value.trim()) return;

    const userText = input.value.trim();
    input.value = "";
    input.style.height = "auto";

    currentMessages.push({ role: "user", content: userText });
    renderMessages();

    // Auto title chat
    let chatObj = chatsHistory.find(c => c.id === currentChatId);
    if (!chatObj) {
        chatObj = { id: currentChatId, title: userText.slice(0, 30), messages: currentMessages, timestamp: Date.now() };
        chatsHistory.unshift(chatObj);
    } else {
        chatObj.messages = currentMessages;
    }
    localStorage.setItem("nexus_chats", JSON.stringify(chatsHistory));
    persistChatToServer(chatObj);
    renderChatsList();

    // Create assistant message container
    const container = document.getElementById("messagesContainer");
    const aiDiv = document.createElement("div");
    aiDiv.className = "flex gap-3 justify-start animate-fade-in";
    aiDiv.innerHTML = `
        <div class="nx-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18V6l12 12V6"/></svg></div>
        <div class="nx-mesaj-yz markdown-body" id="streamingTarget">
            <span class="streaming-cursor"></span>
        </div>
    `;
    container.appendChild(aiDiv);
    container.scrollTop = container.scrollHeight;

    const target = document.getElementById("streamingTarget");
    let fullResponse = "";

    activeAbortController = new AbortController();
    toggleStopButton(true);

    const historyPayload = [];
    if (currentPersonaPrompt) {
        historyPayload.push({ role: "system", content: currentPersonaPrompt });
    }
    historyPayload.push(...currentMessages);

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getProviderHeaders(),
                "X-Session-ID": getSessionId()
            },
            body: JSON.stringify({
                model: activeModel,
                messages: historyPayload,
                stream: true
            }),
            signal: activeAbortController.signal
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === "[DONE]") continue;
                    try {
                        const parsed = jsonParseSafe(dataStr);
                        if (parsed && parsed.content) {
                            fullResponse += parsed.content;
                            target.innerHTML = renderMarkdown(fullResponse) + '<span class="streaming-cursor"></span>';
                            container.scrollTop = container.scrollHeight;
                        } else if (parsed && parsed.error) {
                            fullResponse += `\n\n> ❌ **Hata:** ${parsed.error}`;
                            target.innerHTML = renderMarkdown(fullResponse);
                        }
                    } catch (e) {}
                }
            }
        }

        target.innerHTML = renderMarkdown(fullResponse);
        highlightCodeBlocks();
        currentMessages.push({ role: "assistant", content: fullResponse });
        chatObj.messages = currentMessages;
        localStorage.setItem("nexus_chats", JSON.stringify(chatsHistory));
        persistChatToServer(chatObj);

    } catch (e) {
        if (e.name === "AbortError") {
            target.innerHTML = renderMarkdown(fullResponse) + '<span class="nx-not">Durduruldu.</span>';
        } else {
            target.innerHTML = `<span class="nx-hata">İstek başarısız: ${escapeHtml(e.message)}</span>`;
        }
    } finally {
        toggleStopButton(false);
        activeAbortController = null;
    }
}

function stopStreaming() {
    if (activeAbortController) {
        activeAbortController.abort();
    }
}

function toggleStopButton(isStreaming) {
    const sendBtn = document.getElementById("sendBtn");
    const stopBtn = document.getElementById("stopBtn");
    if (!sendBtn || !stopBtn) return;

    if (isStreaming) {
        sendBtn.classList.add("hidden");
        stopBtn.classList.remove("hidden");
    } else {
        sendBtn.classList.remove("hidden");
        stopBtn.classList.add("hidden");
    }
}

function renderMarkdown(raw) {
    if (!raw) return "";

    // Parse <think> reasoning tags
    let processed = raw;
    processed = processed.replace(/<think>([\s\S]*?)<\/think>/gi, (match, thinkContent) => {
        return `<details class="thinking-box">
            <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg><span>${t("thinking")}</span></summary>
            <div class="icerik">${escapeHtml(thinkContent.trim())}</div>
        </details>`;
    });

    if (window.marked) {
        return window.marked.parse(processed);
    }
    return escapeHtml(processed).replace(/\n/g, "<br>");
}

function highlightCodeBlocks() {
    document.querySelectorAll("pre code").forEach(block => {
        if (window.hljs) window.hljs.highlightElement(block);

        // Add Live Preview, Deploy & Copy header if not already added
        const pre = block.parentElement;
        if (pre && !pre.querySelector(".code-header")) {
            const lang = ((block.className.match(/language-([\w+#-]+)/) || [])[1] || "").trim();
            const code = block.textContent;

            const header = document.createElement("div");
            header.className = "code-header";

            const isWeb = ["html", "javascript", "js", "svg", "css"].includes(lang.toLowerCase()) || code.includes("<!DOCTYPE") || code.includes("<html") || code.includes("<body") || code.includes("<div") || code.includes("<script");

            header.innerHTML = `
                <span class="dil">${escapeHtml(lang || "kod")}</span>
                <div class="islemler">
                    ${isWeb ? `
                        <button type="button" class="btn-publish-direct" title="Bağlantıyla paylaş">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span>Yayınla</span>
                        </button>
                        <button type="button" class="btn-open-sandbox ana">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>${t("live_preview")}</span>
                        </button>
                    ` : ""}
                    <button type="button" class="btn-copy-code">
                        ${KOPYA_SIMGE}<span>${t("copy_code")}</span>
                    </button>
                </div>
            `;
            pre.insertBefore(header, block);

            // Bind listeners directly
            const publishBtn = header.querySelector(".btn-publish-direct");
            if (publishBtn) {
                publishBtn.onclick = (e) => {
                    e.preventDefault();
                    publishDirectCode(block.textContent);
                };
            }
            const sandboxBtn = header.querySelector(".btn-open-sandbox");
            if (sandboxBtn) {
                sandboxBtn.onclick = (e) => {
                    e.preventDefault();
                    openSandbox(block.textContent);
                };
            }
            const copyBtn = header.querySelector(".btn-copy-code");
            if (copyBtn) {
                copyBtn.onclick = (e) => {
                    e.preventDefault();
                    copyCodeFromBlock(copyBtn);
                };
            }
        }
    });
}

function copyCodeFromBlock(btn) {
    const pre = btn.closest("pre");
    const code = pre ? pre.querySelector("code") : null;
    if (code) {
        navigator.clipboard.writeText(code.textContent);
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>${t("copied")}</span>`;
        setTimeout(() => {
            btn.innerHTML = `${KOPYA_SIMGE}<span>${t("copy_code")}</span>`;
        }, 2000);
    }
}

async function loadPresets() {
    try {
        const res = await fetch("/api/presets");
        const data = await res.json();
        const container = document.getElementById("presetsCarousel");
        if (!container || !data.presets) return;

        container.innerHTML = "";
        data.presets.forEach(p => {
            const card = document.createElement("button");
            card.className = "nx-sablon";
            card.type = "button";
            card.onclick = () => selectPreset(p);
            card.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <span class="simge"><i class="${escapeHtml(p.icon || "fa-solid fa-wand-magic-sparkles")}"></i></span>
                    ${p.badge ? `<span class="nx-rozet">${escapeHtml(p.badge)}</span>` : ""}
                </div>
                <div class="baslik">${escapeHtml(currentLang === "tr" ? p.title_tr : p.title)}</div>
                <div class="aciklama">${escapeHtml(currentLang === "tr" ? p.desc_tr : p.desc_en)}</div>
            `;
            container.appendChild(card);
        });
    } catch (e) {}
}

function selectPreset(preset) {
    currentPersonaPrompt = preset.prompt;
    showToast(`${preset.title} persona seçildi!`);
    const badge = document.getElementById("activePersonaBadge");
    if (badge) {
        badge.textContent = currentLang === "tr" ? preset.title_tr : preset.title;
        badge.classList.remove("hidden");
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jsonParseSafe(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
}

function showToast(msg) {
    const toast = document.getElementById("toastNotification");
    const text = document.getElementById("toastText");
    if (!toast || !text) return;
    text.textContent = msg;
    toast.classList.remove("opacity-0", "translate-y-4", "pointer-events-none");
    toast.classList.add("opacity-100", "translate-y-0");
    setTimeout(() => {
        toast.classList.remove("opacity-100", "translate-y-0");
        toast.classList.add("opacity-0", "translate-y-4", "pointer-events-none");
    }, 2500);
}


// Settings Modal Handlers
async function openSettingsModal() {
    const modal = document.getElementById("settingsModal");
    if (!modal) return;

    modal.classList.remove("hidden");
    modal.classList.add("flex");

    // Load existing settings
    ['gemini', 'openai', 'groq', 'anthropic'].forEach(prov => {
        const input = document.getElementById(`input_key_${prov}`);
        if (input) {
            input.value = localStorage.getItem(`nexus_key_${prov}`) || "";
        }
    });
    const ollamaInput = document.getElementById("input_url_ollama");
    if (ollamaInput) {
        ollamaInput.value = localStorage.getItem("nexus_url_ollama") || "http://localhost:11434";
    }

    // Also fetch server settings preview
    try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        if (data.status === "ok" && data.providers) {
            Object.keys(data.providers).forEach(prov => {
                const info = data.providers[prov];
                const input = document.getElementById(`input_key_${prov}`);
                if (input && !input.value && info.has_key && info.key_preview) {
                    input.placeholder = `Sunucuda Kayıtlı (${info.key_preview})`;
                }
            });
        }
    } catch (e) {}
}

function closeSettingsModal() {
    const modal = document.getElementById("settingsModal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

async function saveSettings() {
    const providers = ['gemini', 'openai', 'groq', 'anthropic'];
    for (const prov of providers) {
        const input = document.getElementById(`input_key_${prov}`);
        if (input && input.value.trim()) {
            const val = input.value.trim();
            localStorage.setItem(`nexus_key_${prov}`, val);
            localStorage.setItem(`nexus_${prov}_key`, val);
            try {
                await fetch("/api/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ provider: prov, api_key: val })
                });
            } catch (e) {}
        }
    }

    const ollamaInput = document.getElementById("input_url_ollama");
    if (ollamaInput && ollamaInput.value.trim()) {
        const url = ollamaInput.value.trim();
        localStorage.setItem("nexus_url_ollama", url);
        try {
            await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider: "ollama", base_url: url })
            });
        } catch (e) {}
    }

    closeSettingsModal();
    showToast("Ayarlar ve API anahtarları sunucuya kaydedildi!");
    if (typeof fetchModelsForActiveProvider === "function") {
        fetchModelsForActiveProvider();
    }
}
