import uvicorn
import yaml
import threading
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from webdav_router import router as webdav_router
from api_router import router as api_router
from file_system import vfs

# 读取配置文件
with open("settings.yaml", "r", encoding="utf-8") as f:
    settings_data = yaml.safe_load(f.read())

# WebDAV 服务 (端口 8000)
webdav_app = FastAPI(
    title="123Pan WebDAV",
    description="123云盘秒传资源 WebDAV 服务",
    version="2.1.0",
    docs_url=None,
    redoc_url=None,
)
webdav_app.include_router(webdav_router)

# Web 管理界面 (端口 8001)
web_app = FastAPI(
    title="123Pan 管理面板",
    description="123云盘秒传资源管理界面",
    version="2.1.0",
    docs_url="/docs",
    redoc_url=None,
)
web_app.include_router(api_router)
web_app.mount("/static", StaticFiles(directory="static"), name="static")

@web_app.get("/", include_in_schema=False)
async def root():
    """重定向到管理界面"""
    return RedirectResponse(url="/static/index.html")

def run_webdav():
    """启动 WebDAV 服务"""
    uvicorn.run(
        webdav_app,
        host=settings_data.get("WEBDAV_HOST", "0.0.0.0"),
        port=settings_data.get("WEBDAV_PORT", 8000),
        log_level="warning",
        access_log=False
    )

def run_web():
    """启动 Web 管理界面"""
    uvicorn.run(
        web_app,
        host=settings_data.get("WEBDAV_HOST", "0.0.0.0"),
        port=settings_data.get("WEB_UI_PORT", 8001),
        log_level="warning",
        access_log=False
    )

if __name__ == "__main__":
    print("=" * 50)
    print(f"WebDAV 服务: http://0.0.0.0:{settings_data.get('WEBDAV_PORT', 8000)}")
    print(f"管理界面:   http://0.0.0.0:{settings_data.get('WEB_UI_PORT', 8001)}")
    print("=" * 50)
    
    # 同时启动两个服务
    webdav_thread = threading.Thread(target=run_webdav, daemon=True)
    web_thread = threading.Thread(target=run_web, daemon=True)
    
    webdav_thread.start()
    web_thread.start()
    
    # 保持主线程运行
    try:
        webdav_thread.join()
        web_thread.join()
    except KeyboardInterrupt:
        print("\n服务已停止")
