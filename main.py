import uvicorn
import yaml
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from webdav_router import router as webdav_router
from api_router import router as api_router
from file_system import vfs

# 读取配置文件
with open("settings.yaml", "r", encoding="utf-8") as f:
    settings_data = yaml.safe_load(f.read())

app = FastAPI(
    title="123Pan Unlimited WebDAV",
    description="将 123Pan Unlimited Share 的数据库挂载为WebDAV服务，并提供Web管理界面",
    version="2.0.0",
    docs_url="/docs",
    redoc_url=None,
)

# 注册 API 路由
app.include_router(api_router)

# 注册 WebDAV 路由
app.include_router(webdav_router)

# 挂载静态文件
app.mount("/static", StaticFiles(directory="static"), name="static")

# 根路径重定向到管理界面
from fastapi.responses import RedirectResponse

@app.get("/", include_in_schema=False)
async def root():
    """重定向到管理界面"""
    return RedirectResponse(url="/static/index.html")

if __name__ == "__main__":
    uvicorn.run(
        app, 
        host=settings_data.get("WEBDAV_HOST"), 
        port=settings_data.get("WEBDAV_PORT"), 
        # debug 参数
        # log_level="info",
        # access_log=True
        # 发布参数
        log_level="warning",
        access_log=False
    )
