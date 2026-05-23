from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import yaml

from file_system import vfs
from auth import verify_credentials
from fastapi import Depends

router = APIRouter(prefix="/api", tags=["API"])

# 通过 vfs 获取数据库实例
db = vfs.db


class ImportRequest(BaseModel):
    """导入请求模型"""
    scriptVersion: Optional[str] = None
    exportVersion: Optional[str] = None
    usesBase62EtagsInExport: Optional[bool] = True
    commonPath: Optional[str] = ""
    totalFilesCount: Optional[int] = None
    totalSize: Optional[int] = None
    files: list


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
    import_req: ImportRequest,
    credentials=Depends(verify_credentials)
):
    """导入 JSON 数据"""
    try:
        json_data = import_req.model_dump()
        result = db.importFromJson(json_data)
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
