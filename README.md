# 123Pan WebDAV

基于 [123Pan-Unlimited-WebDAV](https://github.com/realcwj/123Pan-Unlimited-WebDAV) 的 Docker 部署版本，支持 Web 管理界面和多种格式导入。

## ✨ 功能特性

- 🎬 **WebDAV 服务** — 挂载到播放器直接播放
- 🌐 **Web 管理界面** — 暗黑主题，支持资源列表、搜索、导入
- 📥 **多种导入格式** — 123FastLink JSON/文本、123share
- 📂 **年份目录拆分** — 自动按年份分组，便于浏览
- 🔄 **缓存刷新** — 导入后自动刷新，无需重启
- 🚀 **Docker 一键部署** — 简单配置即可使用

## 🚀 快速开始

### 1. 拉取镜像

```bash
docker pull ghcr.io/ssabv/123pan-webdav:v2.2.0
```

### 2. 创建数据目录

```bash
mkdir -p ~/123pan-webdav/data
```

### 3. 下载数据库

从 [Releases](https://github.com/ldohgfsdu/M1racle-123pan-share/releases/tag/database) 下载数据库文件：

```bash
# 下载数据库（约 158MB）
wget -O ~/123pan-webdav/data/PAN123DATABASE.db \
  https://github.com/ldohgfsdu/M1racle-123pan-share/releases/download/database/PAN123DATABASE.latest.db
```

或者使用空数据库（通过 Web 界面导入数据）：

```bash
# 创建空数据库
touch ~/123pan-webdav/data/PAN123DATABASE.db
```

### 4. 创建配置文件

```bash
cat > ~/123pan-webdav/settings.yaml << 'EOF'
# 数据库路径
DATABASE_PATH: "/app/data/PAN123DATABASE.db"

# WebDAV 配置
WEBDAV_USERNAME: "admin"
WEBDAV_PASSWORD: "你的密码"
WEBDAV_HOST: "0.0.0.0"
WEBDAV_PORT: 8000

# Web 管理界面端口
WEB_UI_PORT: 8001

# 123云盘账号（用于秒传验证）
123PAN_USERNAME: "手机号"
123PAN_PASSWORD: "密码"

# 是否按哈希前缀分桶（False 则显示所有资源名称）
SPLIT_FOLDER: True
EOF
```

### 5. 启动容器

```bash
docker run -d \
  --name 123pan-webdav \
  -p 8000:8000 \
  -p 8001:8001 \
  -v ~/123pan-webdav/data:/app/data \
  -v ~/123pan-webdav/settings.yaml:/app/settings.yaml \
  --restart unless-stopped \
  ghcr.io/ssabv/123pan-webdav:v2.2.0
```

### 6. 访问服务

- **Web 管理界面**: http://你的IP:8001/
- **WebDAV 服务**: http://你的IP:8000/
- **API 文档**: http://你的IP:8001/docs

## 📖 使用教程

### 导入数据

#### 方法一：Web 界面导入（推荐）

1. 打开管理界面 http://你的IP:8001/
2. 点击「📥 导入资源」按钮
3. 拖拽文件或点击选择文件
4. 支持的格式：
   - **123FastLink JSON** — 导出的 `.json` 文件
   - **123FastLink 文本** — `123FLCPV2$hash#size#filename` 格式
   - **多行文本** — 每行一条资源
   - **123share** — `.123share` 文件

#### 方法二：命令行导入

```bash
# 进入容器
docker exec -it 123pan-webdav bash

# 导入 JSON 文件
python3 -c "
import json
from Pan123Database import Pan123Database

db = Pan123Database(dbpath='/app/data/PAN123DATABASE.db')
with open('/app/data/your_file.json') as f:
    data = json.load(f)
result = db.importFromJson(data)
print(result)
db.close()
"
```

### 挂载到播放器

#### Infuse (iOS/macOS)

1. 打开 Infuse → 设置 → 共享
2. 添加 WebDAV：
   - 名称：123云盘
   - 地址：`http://你的IP:8000/`
   - 用户名：`admin`
   - 密码：`你在 settings.yaml 设置的密码`
3. 保存后即可浏览和播放

#### VidHub (iOS/macOS)

1. 打开 VidHub → 文件源
2. 添加 WebDAV：
   - 地址：`http://你的IP:8000/`
   - 用户名：`admin`
   - 密码：`你的密码`
3. 保存后自动刮削元数据

#### Kodi (Android/Windows/Linux)

1. 打开 Kodi → 文件管理
2. 添加网络位置 → WebDAV：
   - 服务器：`你的IP`
   - 端口：`8000`
   - 用户名：`admin`
   - 密码：`你的密码`
3. 浏览文件并播放

#### PotPlayer (Windows)

1. 打开 PotPlayer → 打开 → 打开 URL
2. 输入：`http://admin:你的密码@你的IP:8000/`
3. 浏览文件并播放

#### OpenList

1. 打开 OpenList → 存储
2. 添加 WebDAV：
   - 链接：`http://你的IP:8000/`
   - 用户名：`admin`
   - 密码：`你的密码`
3. 保存后即可浏览

### 数据格式说明

#### 123FastLink JSON 格式

```json
{
  "scriptVersion": "1.0.0",
  "exportVersion": "1.0.0",
  "usesBase62EtagsInExport": true,
  "commonPath": "原盘电影合集/",
  "totalFilesCount": 22848,
  "files": [
    {
      "path": "2022/电影名称 (2022)/movie.iso",
      "size": 49456087040,
      "etag": "abc123..."
    }
  ]
}
```

**注意**：当 `commonPath` 非空时，会自动按第一级目录（年份）拆分导入。

#### 123FastLink 文本格式

```
123FLCPV2$6cae3f1ac1af53626c489f268d1864f6#7472158879#黑袍纠察队.2019.S01E01.第1集.2160p.HDR10.H.265.10-bit.23.976fps.DDP 5.1.mkv
123FLCPV2$abc123...#12345678#电影名称.iso
```

格式：`123FLCPV2$<hash>#<size>#<filename>`

## 🔧 配置说明

### settings.yaml

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `DATABASE_PATH` | 数据库文件路径 | `/app/data/PAN123DATABASE.db` |
| `WEBDAV_USERNAME` | WebDAV 用户名 | `admin` |
| `WEBDAV_PASSWORD` | WebDAV 密码 | `password` |
| `WEBDAV_HOST` | 监听地址 | `0.0.0.0` |
| `WEBDAV_PORT` | WebDAV 端口 | `8000` |
| `WEB_UI_PORT` | Web 管理界面端口 | `8001` |
| `123PAN_USERNAME` | 123云盘账号 | - |
| `123PAN_PASSWORD` | 123云盘密码 | - |
| `SPLIT_FOLDER` | 是否按哈希分桶 | `True` |

### 端口说明

- **8000** — WebDAV 服务（播放器挂载用）
- **8001** — Web 管理界面（浏览器访问用）

### 环境变量

可以通过环境变量覆盖配置：

```bash
docker run -d \
  -e DATABASE_PATH="/app/data/PAN123DATABASE.db" \
  -e WEBDAV_USERNAME="admin" \
  -e WEBDAV_PASSWORD="your_password" \
  -p 8000:8000 \
  -p 8001:8001 \
  -v ~/123pan-webdav/data:/app/data \
  ghcr.io/ssabv/123pan-webdav:v2.2.0
```

## 📊 API 接口

### 资源管理

- `GET /api/resources` — 获取资源列表（分页）
- `GET /api/resources/{hash}` — 获取资源详情
- `POST /api/resources/import` — 导入资源
- `DELETE /api/resources/{hash}` — 删除资源
- `GET /api/stats` — 获取统计信息
- `POST /api/resources/search` — 搜索资源
- `POST /api/refresh` — 刷新缓存

### 请求示例

```bash
# 获取资源列表
curl http://你的IP:8001/api/resources?page=1&page_size=20

# 搜索资源
curl -X POST http://你的IP:8001/api/resources/search \
  -H "Content-Type: application/json" \
  -d '{"query": "电影名称"}'

# 导入资源
curl -X POST http://你的IP:8001/api/resources/import \
  -u admin:password \
  -F "file=@your_file.json"

# 刷新缓存
curl -X POST http://你的IP:8001/api/refresh \
  -u admin:password
```

## 🔄 更新版本

```bash
# 拉取新镜像
docker pull ghcr.io/ssabv/123pan-webdav:latest

# 停止并删除旧容器
docker stop 123pan-webdav
docker rm 123pan-webdav

# 启动新容器
docker run -d \
  --name 123pan-webdav \
  -p 8000:8000 \
  -p 8001:8001 \
  -v ~/123pan-webdav/data:/app/data \
  -v ~/123pan-webdav/settings.yaml:/app/settings.yaml \
  --restart unless-stopped \
  ghcr.io/ssabv/123pan-webdav:latest
```

## 🐛 常见问题

### Q: WebDAV 无法访问？

检查防火墙是否开放端口：
```bash
# Ubuntu/Debian
sudo ufw allow 8000
sudo ufw allow 8001

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --permanent --add-port=8001/tcp
sudo firewall-cmd --reload
```

### Q: 导入数据后 WebDAV 不显示？

刷新缓存：
```bash
curl -X POST http://你的IP:8001/api/refresh -u admin:password
```

或重启容器：
```bash
docker restart 123pan-webdav
```

### Q: CPU 占用过高？

已优化：v2.2.0 版本添加了树缓存，大幅降低 CPU 占用。

### Q: 如何添加更多资源？

1. 打开管理界面 http://你的IP:8001/
2. 点击「📥 导入资源」
3. 选择新的 JSON/TXT 文件导入
4. 导入后自动刷新缓存

### Q: 如何备份数据？

备份数据目录：
```bash
# 备份
tar -czvf 123pan-backup.tar.gz ~/123pan-webdav/

# 恢复
tar -xzvf 123pan-backup.tar.gz -C ~/
```

## 📝 更新日志

### v2.2.0 (2026-05-24)
- ✨ 添加树缓存优化 CPU 占用
- ✨ 按年份目录自动拆分导入
- ✨ 分离 WebDAV 和 Web 管理界面端口
- ✨ 添加缓存刷新功能

### v2.1.0 (2026-05-24)
- ✨ 添加 Web 管理界面
- ✨ 支持多种格式导入
- ✨ 支持 123FastLink 文本格式

### v2.0.0 (2026-05-24)
- 🎉 初始版本
- ✨ 基于 123Pan-Unlimited-WebDAV
- ✨ Docker 部署支持

## 🙏 致谢

- [123Pan-Unlimited-WebDAV](https://github.com/realcwj/123Pan-Unlimited-WebDAV) — 原项目
- [123Pan-Unlimited-Share](https://github.com/realcwj/123Pan-Unlimited-Share) — 秒传资源库
- [M1racle-123pan-share](https://github.com/ldohgfsdu/M1racle-123pan-share) — 数据库来源

## 📄 许可证

MIT License
