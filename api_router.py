from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Union, List
import yaml

from file_system import vfs, ACTIVE_BUCKETS, BUCKET_FOLDERS
from auth import verify_credentials
from fastapi import Depends

router = APIRouter(prefix="/api", tags=["API"])

# 通过 vfs 获取数据库实例
db = vfs.db


class ImportJsonRequest(BaseModel):
    """导入 JSON 请求模型"""
    scriptVersion: Optional[str] = None
    exportVersion: Optional[str] = None
    usesBase62EtagsInExport: Optional[bool] = True
    commonPath: Optional[str] = ""
    totalFilesCount: Optional[int] = None
    totalSize: Optional[int] = None
    files: list


class ImportTextRequest(BaseModel):
    """导入文本请求模型"""
    text: str


@router.get("/resources")
async def list_resources(
    page: int = 1,
    page_size: int = 50,
    search: str = "",
    credentials=Depends(verify_credentials)
):
    """获取资源列表（分页+搜索）"""
    result = db.listResources(page=page, page_size=page_size, search=search)
    return JSONResponse(content=result)


@router.get("/resources/{code_hash}")
async def get_resource(
    code_hash: str,
    credentials=Depends(verify_credentials)
):
    """获取单个资源详情"""
    resource = db.getResource(code_hash)
    if not resource:
        raise HTTPException(status_code=404, detail="资源未找到")
    return JSONResponse(content=resource)


@router.post("/resources/import")
async def import_resources(
    request: Request,
    credentials=Depends(verify_credentials)
):
    """导入数据，支持多种格式"""
    try:
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type:
            json_data = await request.json()
            result = db.importFromJson(json_data)
        elif "text/plain" in content_type:
            text = await request.body()
            text = text.decode("utf-8")
            result = db.importFromJson(text)
        else:
            # 尝试解析为 JSON
            try:
                json_data = await request.json()
                result = db.importFromJson(json_data)
            except:
                # 尝试解析为文本
                text = await request.body()
                text = text.decode("utf-8")
                result = db.importFromJson(text)
        
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/resources/{code_hash}")
async def delete_resource(
    code_hash: str,
    credentials=Depends(verify_credentials)
):
    """删除资源"""
    success = db.deleteResource(code_hash)
    if not success:
        raise HTTPException(status_code=404, detail="资源未找到或删除失败")
    return JSONResponse(content={"message": "删除成功"})


@router.get("/stats")
async def get_stats(credentials=Depends(verify_credentials)):
    """获取统计信息"""
    stats = db.getStats()
    return JSONResponse(content=stats)


@router.post("/refresh")
async def refresh_cache(credentials=Depends(verify_credentials)):
    """刷新内存缓存（导入数据后需要执行）"""
    try:
        count = vfs.refresh()
        return JSONResponse(content={
            "message": "缓存已刷新",
            "total": count,
            "active_buckets": ACTIVE_BUCKETS if ACTIVE_BUCKETS else ["全部"]
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resources/search")
async def search_resources(
    page: int = 1,
    page_size: int = 50,
    keyword: str = "",
    credentials=Depends(verify_credentials)
):
    """全文搜索资源"""
    if not keyword:
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")
    result = db.listResources(page=page, page_size=page_size, search=keyword)
    return JSONResponse(content=result)


# ==================== 分桶管理 API ====================

class BucketUpdateRequest(BaseModel):
    """更新桶配置请求"""
    buckets: List[str]  # 要激活的桶名列表，空列表 = 加载全部


@router.get("/buckets")
async def list_buckets(credentials=Depends(verify_credentials)):
    """列出所有可用的桶（按 rootFolderName 前缀分组）"""
    buckets = db.listBuckets()
    return JSONResponse(content={
        "buckets": buckets,
        "active": ACTIVE_BUCKETS,
        "config_default": BUCKET_FOLDERS,
    })


@router.get("/buckets/folders")
async def list_bucket_folders(credentials=Depends(verify_credentials)):
    """列出所有根文件夹名（精确桶选择用）"""
    folders = db.listRootFolderNames()
    return JSONResponse(content={
        "folders": folders,
        "active": ACTIVE_BUCKETS,
    })


@router.put("/buckets")
async def update_buckets(
    request: BucketUpdateRequest,
    credentials=Depends(verify_credentials)
):
    """更新激活的桶列表并刷新缓存
    
    buckets: 要激活的桶名列表，空列表 = 加载全部
    """
    try:
        bucket_filter = request.buckets if request.buckets else []
        count = vfs.refresh(bucket_filter=bucket_filter)
        
        # 同步更新 settings.yaml 中的配置
        try:
            with open("settings.yaml", "r", encoding="utf-8") as f:
                settings = yaml.safe_load(f.read())
            settings["BUCKET_FOLDERS"] = bucket_filter
            with open("settings.yaml", "w", encoding="utf-8") as f:
                yaml.dump(settings, f, allow_unicode=True, default_flow_style=False)
        except Exception as e:
            print(f"警告：更新 settings.yaml 失败: {e}")
        
        return JSONResponse(content={
            "message": "桶配置已更新并刷新缓存",
            "active_buckets": bucket_filter if bucket_filter else ["全部"],
            "total_loaded": count
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
