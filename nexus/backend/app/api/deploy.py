from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import os
import socket
import time
import uuid
import json
import subprocess
import threading
import re
from typing import Optional, List, Dict, Any

router = APIRouter(tags=["deploy"])

DEPLOYMENTS_DIR = os.path.join(os.getcwd(), "data", "deployments")
METADATA_FILE = os.path.join(os.getcwd(), "data", "deployments_meta.json")
os.makedirs(DEPLOYMENTS_DIR, exist_ok=True)

# Cloudflare Tunnel Manager
class TunnelManager:
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.public_url: Optional[str] = None
        self.is_running = False
        self.lock = threading.Lock()

    def start_tunnel(self, port: int = None):
        with self.lock:
            if self.is_running and self.public_url:
                return self.public_url

            # Tünel hedefi: konteynerde host.docker.internal:3050 (frontend gateway),
            # native modda localhost:3050. Compose NEXUS_TUNNEL_TARGET ile verir.
            target = os.environ.get("NEXUS_TUNNEL_TARGET", "http://127.0.0.1:3050")

            # Check if cloudflared exists
            has_cf = False
            cmd_bin = "cloudflared"
            for bin_path in ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared", "cloudflared"]:
                if os.path.exists(bin_path) or subprocess.run(f"which {bin_path}", shell=True, capture_output=True).returncode == 0:
                    cmd_bin = bin_path
                    has_cf = True
                    break

            if not has_cf:
                return None

            try:
                self.process = subprocess.Popen(
                    [cmd_bin, "tunnel", "--url", target, "--no-autoupdate"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1
                )
                self.is_running = True

                # Wait for public URL
                t0 = time.time()
                while time.time() - t0 < 10:
                    line = self.process.stderr.readline()
                    if not line and self.process.poll() is not None:
                        break
                    m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                    if m:
                        self.public_url = m.group(0)
                        break

                # Background watcher thread
                def _watch():
                    while self.is_running and self.process and self.process.poll() is None:
                        line = self.process.stderr.readline()
                        if not line:
                            break
                        m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                        if m:
                            self.public_url = m.group(0)

                threading.Thread(target=_watch, daemon=True).start()
                return self.public_url
            except Exception as e:
                print("Failed to start cloudflared tunnel:", e)
                return None

    def stop_tunnel(self):
        with self.lock:
            if self.process:
                try:
                    self.process.terminate()
                except Exception:
                    pass
            self.process = None
            self.public_url = None
            self.is_running = False

tunnel_manager = TunnelManager()

# Not: Tünel OTOMATİK başlatılmaz — yalnızca kullanıcı kontrol panelinden
# 'Canlı Yayın' anahtarını açınca start_tunnel() çağrılır (yerel gizlilik).

def load_metadata() -> Dict[str, Any]:
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_metadata(meta: Dict[str, Any]):
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

class PublishRequest(BaseModel):
    html: str
    title: Optional[str] = "Nexus AI Generated App"


def _yerel_adres() -> str:
    """This machine's LAN address (no traffic is sent), NEXUS_LAN_URL overrides it."""
    env = os.environ.get("NEXUS_LAN_URL", "").rstrip("/")
    if env:
        return env
    port = os.environ.get("NEXUS_PORT", "3050")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        return ""
    # Docker bridge (macOS/Windows): this is the container's own address, useless from a phone.
    # Return nothing; the browser then uses the address it opened Nexus with.
    if os.path.exists("/.dockerenv") and ip.startswith("172."):
        return ""
    return f"http://{ip}:{port}"

@router.post("/api/deploy/publish")
async def publish_deployment(req: PublishRequest, request: Request):
    # Yerel adresi isteğin kendi Host başlığından türet (sabit LAN IP'si YOK)
    req_host = request.headers.get("host", "localhost:3050").split(",")[0].strip()
    if ":" in req_host and not req_host.startswith("["):
        req_host, _, req_port = req_host.rpartition(":")
    else:
        req_port = "80"
    html_content = req.html.strip()
    if not html_content:
        raise HTTPException(status_code=400, detail="HTML content is empty")

    deploy_id = uuid.uuid4().hex[:8]
    file_path = os.path.join(DEPLOYMENTS_DIR, f"{deploy_id}.html")

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    meta = load_metadata()
    # Publishing never opens a tunnel by itself (a tunnel to the backend would expose every /api
    # endpoint). Without an active tunnel the page is shared on the local network only.
    pub_url = tunnel_manager.public_url

    # Yerel adres: hangi Host/Port üzerinden geldiysek o (sabit IP yok)
    local_base = f"http://{req_host}:{req_port}" if req_port not in ("80", 80) else f"http://{req_host}"
    meta[deploy_id] = {
        "id": deploy_id,
        "title": req.title,
        "size_bytes": len(html_content.encode("utf-8")),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "views": 0
    }
    save_metadata(meta)

    return {
        "status": "ok",
        "id": deploy_id,
        "title": req.title,
        "local_path": f"/share/{deploy_id}",
        "local_url": f"{local_base}/share/{deploy_id}",
        "public_url": f"{pub_url}/share/{deploy_id}" if pub_url else f"{local_base}/share/{deploy_id}",
        "tunnel_active": bool(pub_url),
        "tunnel_base": pub_url or ""
    }

@router.get("/share/{deploy_id}", response_class=HTMLResponse)
@router.head("/share/{deploy_id}", response_class=HTMLResponse)
@router.get("/p/{deploy_id}", response_class=HTMLResponse)
@router.head("/p/{deploy_id}", response_class=HTMLResponse)
async def serve_share_page(deploy_id: str):
    file_path = os.path.join(DEPLOYMENTS_DIR, f"{deploy_id}.html")
    if not os.path.exists(file_path):
        return HTMLResponse(
            content="""<!DOCTYPE html><html><head><meta charset='utf-8'><title>404 - Not Found</title><style>body{background:#0b0f19;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}h1{color:#ff4b2b;}</style></head><body><div style='text-align:center;'><h1>404</h1><p>Bu yayınlanmış sayfa bulunamadı veya silinmiş.</p><a href='/' style='color:#00f2fe;'>Nexus AI Studio'ya Dön</a></div></body></html>""",
            status_code=404
        )

    meta = load_metadata()
    if deploy_id in meta:
        meta[deploy_id]["views"] = meta[deploy_id].get("views", 0) + 1
        save_metadata(meta)

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    return HTMLResponse(content=content, status_code=200)

@router.get("/api/deploy/list")
async def list_deployments():
    meta = load_metadata()
    pub_url = tunnel_manager.public_url
    items = []
    for k, v in meta.items():
        items.append({
            **v,
            "local_url": f"{_yerel_adres()}/share/{k}",
            "public_url": f"{pub_url}/share/{k}" if pub_url else f"{_yerel_adres()}/share/{k}"
        })
    return {
        "status": "ok",
        "tunnel_active": bool(pub_url),
        "tunnel_url": pub_url or "",
        "deployments": sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)
    }

@router.get("/api/deploy/tunnel")
@router.get("/api/deploy/studio-tunnel")
async def get_tunnel_status():
    pub_url = tunnel_manager.public_url
    return {
        "status": "ok",
        "active": bool(pub_url),
        "url": pub_url or "",
        "public_studio_url": pub_url or "",
        "public_admin_url": f"{pub_url}/admin.html" if pub_url else "",
        "local_studio_url": _yerel_adres(),
        "local_admin_url": f"{_yerel_adres()}/admin.html",
        "service": "Cloudflare Quick Tunnel (Zero-Config HTTPS)"
    }

@router.post("/api/deploy/tunnel/restart")
@router.post("/api/deploy/studio-tunnel/restart")
async def restart_tunnel():
    tunnel_manager.stop_tunnel()
    pub_url = tunnel_manager.start_tunnel()
    return {
        "status": "ok",
        "active": bool(pub_url),
        "url": pub_url or "",
        "public_studio_url": pub_url or "",
        "public_admin_url": f"{pub_url}/admin.html" if pub_url else ""
    }

@router.post("/api/deploy/studio-tunnel/toggle")
async def toggle_tunnel():
    if tunnel_manager.is_running and tunnel_manager.public_url:
        tunnel_manager.stop_tunnel()
        return {
            "status": "ok",
            "active": False,
            "message": "Dış erişim tüneli kapatıldı. Sistem artık yalnızca yerel ağda (LAN) erişilebilir.",
            "public_studio_url": "",
            "public_admin_url": ""
        }
    else:
        tunnel_manager.stop_tunnel()
        pub_url = tunnel_manager.start_tunnel()
        return {
            "status": "ok",
            "active": bool(pub_url),
            "message": "Dış erişim tüneli başarıyla başlatıldı ve dünyaya açıldı.",
            "public_studio_url": pub_url or "",
            "public_admin_url": f"{pub_url}/admin.html" if pub_url else ""
        }

@router.post("/api/deploy/studio-tunnel/start")
async def start_tunnel_route():
    pub_url = tunnel_manager.start_tunnel()
    return {
        "status": "ok",
        "active": bool(pub_url),
        "public_studio_url": pub_url or "",
        "public_admin_url": f"{pub_url}/admin.html" if pub_url else ""
    }

@router.post("/api/deploy/studio-tunnel/stop")
async def stop_tunnel():
    tunnel_manager.stop_tunnel()
    return {"status": "ok", "active": False, "message": "Tunnel stopped"}

@router.delete("/api/deploy/{deploy_id}")
@router.post("/api/deploy/{deploy_id}/delete")
async def delete_deployment(deploy_id: str):
    file_path = os.path.join(DEPLOYMENTS_DIR, f"{deploy_id}.html")
    if os.path.exists(file_path):
        os.remove(file_path)

    meta = load_metadata()
    if deploy_id in meta:
        del meta[deploy_id]
        save_metadata(meta)

    return {"status": "ok", "message": f"Deployment '{deploy_id}' deleted."}

