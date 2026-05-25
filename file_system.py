import json
import base64
import yaml
import copy
from typing import Dict, Optional, List, Tuple

from models import FileNode, TYPE_DIRECTORY
from Pan123Database import Pan123Database

# 读取配置文件
with open("settings.yaml", "r", encoding="utf-8") as f:
    settings_data = yaml.safe_load(f.read())

# 决定是否分桶
SPLIT_FOLDER = settings_data.get('SPLIT_FOLDER')

# 分桶过滤配置
BUCKET_FOLDERS = settings_data.get('BUCKET_FOLDERS', [])
if BUCKET_FOLDERS is None:
    BUCKET_FOLDERS = []

# 当前激活的桶列表（运行时可修改）
ACTIVE_BUCKETS = list(BUCKET_FOLDERS)

# 路径筛选配置: {rootFolderName: [path_prefixes]}
# 空列表 = 该桶内全选, 缺失 = 不筛选
_PATH_FILTERS: Dict[str, List[str]] = {}

# 子目录分桶配置: {rootFolderName: True}（运行时，非 SPLIT_FOLDER 模式）
# 为 True 的桶，其子目录直接变成 WebDAV 顶级目录
SUBFOLDER_BUCKETS: Dict[str, bool] = {}

def _get_path_filters():
    """获取当前路径筛选配置"""
    return dict(_PATH_FILTERS)

def _get_subfolder_buckets():
    """获取当前子目录分桶配置"""
    return dict(SUBFOLDER_BUCKETS)

# 桶根重分桶: 指定一个文件夹名，其直接子目录按名 hash 重新分配到 256 个桶（SPLIT_FOLDER 模式）
BUCKET_ROOT = settings_data.get('BUCKET_ROOT', '') or ''
# 桶根子目录树缓存: {child_name: FileNode} —— 该子目录的完整文件树
BUCKET_ROOT_CHILD_TREES: Dict[str, 'FileNode'] = {}  # type: ignore

# 子桶映射（非 SPLIT_FOLDER 模式）: {child_name: rootFolderName}
SUBFOLDER_MAP: Dict[str, str] = {}

# 初始化缓存结构
MEMORY_CACHE_BY_NAME: Dict[str, Tuple[str, str]] = {}
MEMORY_CACHE_BY_BUCKET: Dict[str, List[str]] = {}
MEMORY_CACHE_NAMES_LIST: List[str] = []  # 平铺模式下的全部 rootFolderName
HASH_BUCKET_NAMES: List[str] = [f"{i:02x}" for i in range(256)]

def load_data_into_memory(db: Pan123Database, bucket_filter: list = None, path_filters: dict = None, subfolder_buckets: dict = None, bucket_root: str = None):
    """
    数据加载和分组（分桶/平铺）+ 路径筛选
    
    Args:
        db: 数据库实例
        bucket_filter: 桶名过滤列表，为 None 时加载全部，为列表时只加载匹配的桶
        path_filters: {rootFolderName: [path_prefixes]} 每桶内的路径筛选,
                      空列表 = 该桶内全选, None = 不筛选
        bucket_root: 桶根文件夹名，其子目录按名 hash 重新分配到 256 个桶（SPLIT_FOLDER 模式）
    """
    global ACTIVE_BUCKETS, BUCKET_ROOT, BUCKET_ROOT_CHILD_TREES
    
    if bucket_filter is not None:
        ACTIVE_BUCKETS = list(bucket_filter)
    
    if bucket_root is not None:
        BUCKET_ROOT = bucket_root
        BUCKET_ROOT_CHILD_TREES.clear()
    
    active = ACTIVE_BUCKETS
    # 存储路径筛选配置
    if path_filters is not None:
        _PATH_FILTERS.clear()
        _PATH_FILTERS.update(path_filters)
    
    # 存储子目录分桶配置
    if subfolder_buckets is not None:
        SUBFOLDER_BUCKETS.clear()
        SUBFOLDER_BUCKETS.update({k: bool(v) for k, v in subfolder_buckets.items()})
        SUBFOLDER_MAP.clear()  # 将在 load 后重建
    
    if active:
        print(f"分桶模式：只加载以下桶: {active}")
        all_shares_raw = db.listDataByBuckets(active, visibleFlag=True)
        all_shares = [(row[0], row[1], row[2]) for row in all_shares_raw]
    else:
        print("加载全部数据...")
        page = 1
        all_shares = []
        while True:
            print(f"正在读取分享数据 (批次 {page}) ...")
            shares_page, is_end_page = db.listData(visibleFlag=True, page=page, limit=10000)
            all_shares.extend(shares_page)
            if is_end_page:
                break
            page += 1
    
    print(f"共获取 {len(all_shares)} 条分享记录，构建缓存 ...")
    # 清空所有缓存结构
    MEMORY_CACHE_BY_NAME.clear()
    MEMORY_CACHE_BY_BUCKET.clear()
    MEMORY_CACHE_NAMES_LIST.clear()

    # 建桶
    for bucket_name in HASH_BUCKET_NAMES:
        MEMORY_CACHE_BY_BUCKET[bucket_name] = []
    
    temp_name_list = []
    for codeHash, rootFolderName, _ in all_shares:
        data = db.getDataByHash(codeHash)
        if data:
            _rootFolderName, shareCode, _visibleFlag = data[0]
            MEMORY_CACHE_BY_NAME[rootFolderName] = (shareCode, codeHash)
            # 平铺模式要用的全量name
            temp_name_list.append(rootFolderName)
            # 桶模式用的哈希前缀
            bucket = codeHash[:2]
            MEMORY_CACHE_BY_BUCKET[bucket].append(rootFolderName)
        else:
            print(f"警告：无法解析 codeHash 为 {codeHash} 的数据，已跳过")

    MEMORY_CACHE_NAMES_LIST.extend(sorted(temp_name_list))
    for bucket_key in MEMORY_CACHE_BY_BUCKET:
        MEMORY_CACHE_BY_BUCKET[bucket_key].sort()
    
    # ========== 桶根重分桶: 子目录按名 hash 重新分配到 256 个桶 ==========
    if BUCKET_ROOT and MEMORY_CACHE_BY_NAME.get(BUCKET_ROOT):
        print(f"桶根模式: 将 '{BUCKET_ROOT}' 的子目录按名 hash 重新分桶 ...", flush=True)
        shareCode, src_codeHash = MEMORY_CACHE_BY_NAME[BUCKET_ROOT]
        
        try:
            items = json.loads(base64.urlsafe_b64decode(shareCode))
        except Exception as e:
            print(f"桶根 shareCode 解析失败: {e}")
        else:
            # 构建 FileId → FileNode 映射
            nodes_by_id: dict = {}
            for it in items:
                node = FileNode(
                    id=it.get('FileId', 0),
                    parent_id=it.get('parentFileId', 0),
                    name=it.get('FileName', ''),
                    type=it.get('Type', 0),
                    size=int(it.get('Size', 0)) if str(it.get('Size', '0')).lstrip('-').isdigit() else 0,
                    etag=it.get('Etag', ''),
                    abs_path_str=it.get('AbsPath', '')
                )
                nodes_by_id[node.id] = node
            
            # 连接父子关系
            for node in nodes_by_id.values():
                pid = node.parent_id
                if pid in nodes_by_id and pid != node.id:
                    nodes_by_id[pid].children.append(node)
                    node.parent = nodes_by_id[pid]
            
            # 找桶根节点（跳过同名 wrapper 层）
            def _find_bucket_root_node():
                roots = [n for n in nodes_by_id.values() 
                         if n.parent_id not in nodes_by_id or n.parent_id == n.id]
                for rn in roots:
                    if rn.type == TYPE_DIRECTORY and rn.name == BUCKET_ROOT:
                        return rn
                return None
            
            root_node = _find_bucket_root_node()
            if root_node is None:
                # 根节点名不匹配，直接用顶级节点
                root_node_candidates = [n for n in nodes_by_id.values()
                                       if (n.parent_id not in nodes_by_id or n.parent_id == n.id)
                                       and n.type == TYPE_DIRECTORY]
                if root_node_candidates:
                    root_node = root_node_candidates[0]
                    print(f"桶根名不匹配，使用顶级节点: {root_node.name}", flush=True)
                else:
                    print(f"找不到桶根节点", flush=True)
                    root_node = None
            
            if root_node:
                # 重新分配子目录到 256 个桶
                MEMORY_CACHE_BY_BUCKET.clear()
                for bn in HASH_BUCKET_NAMES:
                    MEMORY_CACHE_BY_BUCKET[bn] = []
                BUCKET_ROOT_CHILD_TREES.clear()
                
                for child in root_node.children:
                    if child.type == TYPE_DIRECTORY:
                        # 按子目录名 hash 分桶
                        bucket_idx = hash(child.name) % 256
                        bucket_name = f"{bucket_idx:02x}"
                        MEMORY_CACHE_BY_BUCKET[bucket_name].append(child.name)
                        BUCKET_ROOT_CHILD_TREES[child.name] = child
                
                # 排序
                for bn in HASH_BUCKET_NAMES:
                    MEMORY_CACHE_BY_BUCKET[bn].sort()
                
                # 计算统计
                total_children = len(BUCKET_ROOT_CHILD_TREES)
                nonempty = sum(1 for bn in HASH_BUCKET_NAMES if MEMORY_CACHE_BY_BUCKET[bn])
                print(f"桶根重分桶完成: {total_children} 个子目录 → {nonempty} 个非空桶", flush=True)
            else:
                print(f"未找到桶根节点 '{BUCKET_ROOT}'，保持原有分桶", flush=True)
    
    # 非 SPLIT_FOLDER 的子目录分桶（保留原有功能）: 构建 SUBFOLDER_MAP
    if not SPLIT_FOLDER:
        _subfolder_map: dict = {}
        for root_name, enabled in SUBFOLDER_BUCKETS.items():
            if enabled and root_name in MEMORY_CACHE_BY_NAME:
                shareCode, _ = MEMORY_CACHE_BY_NAME[root_name]
                try:
                    items = json.loads(base64.urlsafe_b64decode(shareCode))
                    nodes = {}
                    for it in items:
                        fid = it.get('FileId', 0)
                        nodes[fid] = {
                            'name': it.get('FileName', ''),
                            'type': it.get('Type', 0),
                            'parent_id': it.get('parentFileId', 0),
                        }
                    for fid, n in nodes.items():
                        pid = n['parent_id']
                        if (pid not in nodes or pid == fid) and n['type'] == 1:
                            if n['name'] == root_name:
                                for cid in [c for c, cn in nodes.items() if cn['parent_id'] == fid and nodes[c]['type'] == 1]:
                                    _subfolder_map[nodes[cid]['name']] = root_name
                            else:
                                _subfolder_map[n['name']] = root_name
                except Exception as e:
                    print(f"构建子桶映射失败 ({root_name}): {e}")
        SUBFOLDER_MAP = _subfolder_map
    
    print(f"内存缓存构建完成，总条目 {len(MEMORY_CACHE_BY_NAME)}.", flush=True)
    if BUCKET_ROOT:
        print(f"桶根: {BUCKET_ROOT}, 子目录: {len(BUCKET_ROOT_CHILD_TREES)}", flush=True)
    elif not SPLIT_FOLDER and SUBFOLDER_MAP:
        print(f"子目录分桶映射: {list(SUBFOLDER_MAP.items())[:10]}", flush=True)

class VirtualFileSystem:
    """
    虚拟文件系统类，动态支持分桶和平铺两种根目录视图
    """
    def __init__(self, db_path: str):
        self.db = Pan123Database(dbpath=db_path)
        self._tree_cache: Dict[str, List[FileNode]] = {}  # 缓存解码后的树
        load_data_into_memory(self.db)
        self.root = FileNode(id=-1, parent_id=-2, name="ROOT", type=TYPE_DIRECTORY, size=0, etag="", abs_path_str="/")
        print(f"虚拟文件系统已初始化，数据从内存读取。")
        if ACTIVE_BUCKETS:
            print(f"分桶过滤: {ACTIVE_BUCKETS}")
        else:
            print("加载模式: 全部")
        print(f"请通过WebDAV客户端挂载：\n\n")
        print(f"链接（本机访问）: http://127.0.0.1:{settings_data.get('WEBDAV_PORT')}/")
        print(f"链接（局域网访问）: http://本机的局域网IP地址:{settings_data.get('WEBDAV_PORT')}/")
        print(f"链接（公网访问）: http://本机的公网IP地址:{settings_data.get('WEBDAV_PORT')}/")
        print(f"WebDAV 用户名: {settings_data.get('WEBDAV_USERNAME')}")
        print(f"WebDAV 密码: {settings_data.get('WEBDAV_PASSWORD')}")
    
    def refresh(self, bucket_filter: list = None, path_filters: dict = None, 
                subfolder_buckets: dict = None, bucket_root: str = None):
        """刷新内存缓存
        
        Args:
            bucket_filter: 桶名过滤列表，为 None 时保持当前设置，为空列表 [] 时加载全部
            path_filters: {rootFolderName: [path_prefixes]} 每桶内的路径筛选
            subfolder_buckets: {rootFolderName: True} 子目录分桶配置
            bucket_root: 桶根文件夹名，子目录按名 hash 重新分配到 256 个桶
        """
        self._tree_cache.clear()
        return load_data_into_memory(self.db, bucket_filter=bucket_filter, 
                                     path_filters=path_filters, 
                                     subfolder_buckets=subfolder_buckets,
                                     bucket_root=bucket_root)

    def _build_tree_from_share_code(self, share_code: str) -> List[FileNode]:
        """
        解析shareCode（base64）为本地虚拟树形结构，带缓存
        """
        # 检查缓存
        if share_code in self._tree_cache:
            # 返回缓存的副本（因为 children 会被修改）
            return self._copy_tree(self._tree_cache[share_code])
        
        try:
            json_data = json.loads(base64.urlsafe_b64decode(share_code))
        except Exception as e:
            print(f"解析 shareCode 失败: {e}")
            return []
        nodes: Dict[int, FileNode] = {}
        for item in json_data:
            node = FileNode(
                id=item['FileId'],
                parent_id=item['parentFileId'],
                name=item['FileName'],
                type=item['Type'],
                size=item['Size'],
                etag=item['Etag'],
                abs_path_str=item.get('AbsPath', '')
            )
            nodes[item['FileId']] = node
        top_level_nodes = []
        for node in nodes.values():
            if node.parent_id in nodes:
                nodes[node.parent_id].children.append(node)
                node.parent = nodes[node.parent_id]
            else:
                top_level_nodes.append(node)
        
        # 缓存结果
        self._tree_cache[share_code] = top_level_nodes
        return self._copy_tree(top_level_nodes)
    
    def _copy_tree(self, nodes: List[FileNode]) -> List[FileNode]:
        """深拷贝节点树（因为 children 会被修改）"""
        import copy
        return copy.deepcopy(nodes)

    def get_node_by_path(self, path: str) -> Optional[FileNode]:
        """
        路径匹配
        """
        path = path.strip('/')
        parts = path.split('/') if path else []

        # == 根目录 ==
        if not parts:
            self.root.children = []
            if SPLIT_FOLDER:
                # 256分桶
                for i, bucket_name in enumerate(HASH_BUCKET_NAMES):
                    bucket_node = FileNode(
                        id=200000 + i,
                        parent_id=self.root.id,
                        name=bucket_name,
                        type=TYPE_DIRECTORY,
                        size=0,
                        etag=f"bucket_{bucket_name}",
                        abs_path_str=bucket_name,
                        parent=self.root
                    )
                    self.root.children.append(bucket_node)
            else:
                # 平铺
                for i, name in enumerate(MEMORY_CACHE_NAMES_LIST):
                    if SUBFOLDER_BUCKETS.get(name):
                        # 子目录分桶：展开子目录为顶级目录
                        shareCode, codeHash = MEMORY_CACHE_BY_NAME.get(name, (None, None))
                        if shareCode:
                            try:
                                children = self._build_tree_from_share_code(shareCode)
                                # 展开：把子目录变成顶级目錄
                                expanded = []
                                for child in children:
                                    if child.type == TYPE_DIRECTORY:
                                        # 跳过同名打包层（如 动漫电影→动漫电影）
                                        if child.name == name:
                                            for subchild in child.children:
                                                if subchild.type == TYPE_DIRECTORY:
                                                    expanded.append((subchild, codeHash, name))
                                        else:
                                            expanded.append((child, codeHash, name))
                                
                                # 应用 path_filters（如果指定）
                                if name in _PATH_FILTERS and _PATH_FILTERS[name]:
                                    allowed = set(_PATH_FILTERS[name])
                                    expanded = [(ch, chash, pn) for ch, chash, pn in expanded 
                                                if ch.name in allowed or any(ch.name.startswith(a + '/') for a in allowed)]
                                
                                for child, codeHash, parent_name in expanded:
                                    sub_node = FileNode(
                                        id=abs(hash(f"{codeHash}_{child.name}")) % (2**31),
                                        parent_id=self.root.id,
                                        name=child.name,
                                        type=TYPE_DIRECTORY,
                                        size=0,
                                        etag=f"sub_{codeHash[:8]}_{child.name}",
                                        abs_path_str=f"{parent_name}/{child.name}",
                                        parent=self.root
                                    )
                                    self.root.children.append(sub_node)
                            except Exception as e:
                                print(f"展开子桶 {name} 失败: {e}")
                    else:
                        _, codeHash = MEMORY_CACHE_BY_NAME.get(name, (None, None))
                        share_node = FileNode(
                            id=int(codeHash[:8], 16),
                            parent_id=self.root.id,
                            name=name,
                            type=TYPE_DIRECTORY,
                            size=0,
                            etag=codeHash,
                            abs_path_str=name,
                            parent=self.root
                        )
                        self.root.children.append(share_node)
            return self.root

        # == 分桶下一级 ==
        if SPLIT_FOLDER and len(parts) == 1 and parts[0] in HASH_BUCKET_NAMES:
            bucket_name = parts[0]
            bucket_node = FileNode(
                id=200000 + HASH_BUCKET_NAMES.index(bucket_name),
                parent_id=self.root.id,
                name=bucket_name,
                type=TYPE_DIRECTORY,
                size=0,
                etag=f"bucket_{bucket_name}",
                abs_path_str=bucket_name,
                parent=self.root
            )
            
            if BUCKET_ROOT:
                # 桶根模式：显示分配到该桶的子目录名
                child_names = MEMORY_CACHE_BY_BUCKET.get(bucket_name, [])
                bucket_node.children = []
                for child_name in child_names:
                    child_node = FileNode(
                        id=abs(hash(child_name)) % (2**31),
                        parent_id=bucket_node.id,
                        name=child_name,
                        type=TYPE_DIRECTORY,
                        size=0,
                        etag=f"rebucket_{child_name}",
                        abs_path_str=child_name,
                        parent=bucket_node
                    )
                    bucket_node.children.append(child_node)
            else:
                # 正常模式
                share_names = MEMORY_CACHE_BY_BUCKET.get(bucket_name, [])
                bucket_node.children = []
                for name in share_names:
                    _, codeHash = MEMORY_CACHE_BY_NAME.get(name, (None, None))
                    if codeHash:
                        share_folder_node = FileNode(
                            id=int(codeHash[:8], 16),
                            parent_id=bucket_node.id,
                            name=name,
                            type=TYPE_DIRECTORY,
                            size=0,
                            etag=codeHash,
                            abs_path_str=name,
                            parent=bucket_node
                        )
                        bucket_node.children.append(share_folder_node)
            return bucket_node

        # == 子目录分桶：如果第一级匹配子桶映射，从源分享码加载 ==
        if not SPLIT_FOLDER and len(parts) >= 1 and parts[0] in SUBFOLDER_MAP:
            parent_name = SUBFOLDER_MAP[parts[0]]
            share_data = MEMORY_CACHE_BY_NAME.get(parent_name)
            if share_data:
                shareCode, codeHash = share_data
                top_level_nodes = self._build_tree_from_share_code(shareCode)
                
                # 在树中找到对应节点
                def find_node_by_name(nodes, target_name, depth=0):
                    if depth > 20:
                        return None
                    for node in nodes:
                        if node.name == target_name:
                            return node
                        found = find_node_by_name(node.children, target_name, depth + 1)
                        if found:
                            return found
                    return None
                
                target_node = find_node_by_name(top_level_nodes, parts[0])
                if target_node:
                    # 如果有更深路径，用正常方式遍历
                    remaining = parts[1:]
                    current = target_node
                    for part in remaining:
                        found = None
                        for child in current.children:
                            if child.name == part:
                                found = child
                                break
                        if found is None:
                            return None
                        current = found
                    
                    # 应用路径筛选（如果在子桶目录下）
                    if parent_name in _PATH_FILTERS and _PATH_FILTERS[parent_name]:
                        allowed = set(_PATH_FILTERS[parent_name])
                        # user is navigating into a sub-bucket folder; filter children
                        if current != target_node:  # user is past the first level
                            # find which sub-bucket we're in
                            sub_bucket_name = parts[0]
                            if sub_bucket_name in allowed or any(sub_bucket_name.startswith(a) for a in allowed):
                                pass  # include all contents
                            else:
                                # check nested paths
                                pass  # for simplicity, don't filter sub-bucket navigation
                    
                    return current
                else:
                    return None

        # == 桶根模式：从 BUCKET_ROOT_CHILD_TREES 加载子目录树 ==
        if BUCKET_ROOT and SPLIT_FOLDER and len(parts) >= 2 and parts[0] in HASH_BUCKET_NAMES:
            child_name = parts[1]
            child_tree = BUCKET_ROOT_CHILD_TREES.get(child_name)
            if child_tree is not None:
                import copy
                current = copy.deepcopy(child_tree)
                for part in parts[2:]:
                    found = None
                    for c in current.children:
                        if c.name == part:
                            found = c
                            break
                    if found:
                        current = found
                    else:
                        return None
                return current
            # 子目录不存在则 fall through 到正常流程

        # == 进入具体分享 ==
        # - 拆桶时路径是 /xx/分享名/...，平铺时路径是 /分享名/...
        root_folder_name = None
        parent_id = self.root.id
        bucket_name = None
        if SPLIT_FOLDER and len(parts) >= 2 and parts[0] in HASH_BUCKET_NAMES:
            bucket_name = parts[0]
            root_folder_name = parts[1]
            parent_id = 200000 + HASH_BUCKET_NAMES.index(bucket_name)
        elif not SPLIT_FOLDER and len(parts) >= 1:
            root_folder_name = parts[0]
        else:
            return None

        # 获取分享code
        share_data = MEMORY_CACHE_BY_NAME.get(root_folder_name)
        if not share_data:
            print(f"未找到分享: {root_folder_name}")
            return None
        shareCode, codeHash = share_data

        # 拆桶校验（安全健壮性）
        if SPLIT_FOLDER and bucket_name:
            if codeHash[:2] != bucket_name:
                print(f"分桶模式校验失败：分享 {root_folder_name} codeHash {codeHash} 不属于 {bucket_name} 桶")
                return None

        # 构建分享虚拟目录
        top_level_nodes = self._build_tree_from_share_code(shareCode)
        
        # 应用路径筛选（双层分桶）
        if root_folder_name in _PATH_FILTERS and _PATH_FILTERS[root_folder_name]:
            allowed_prefixes = set(_PATH_FILTERS[root_folder_name])
            top_level_nodes = [
                n for n in top_level_nodes
                if any(
                    n.name == p or n.name.startswith(p + '/') or p == n.name
                    for p in allowed_prefixes
                )
            ]
            # 重新设置 parent 关系（因为部分节点被移除了）
            for node in top_level_nodes:
                node.parent_id = None  # 断开原 parent，使其成为顶层
        
        share_root_node = FileNode(
            id=int(codeHash[:8], 16),
            parent_id=parent_id,
            name=root_folder_name,
            type=TYPE_DIRECTORY,
            size=0,
            etag=codeHash,
            abs_path_str=root_folder_name,
            children=top_level_nodes
        )
        for node in top_level_nodes:
            node.parent = share_root_node
        # 仅分享目录
        if (SPLIT_FOLDER and len(parts) == 2) or (not SPLIT_FOLDER and len(parts) == 1):
            return share_root_node
        
        # 分享内部深层
        current_node = share_root_node
        idx_next = 2 if SPLIT_FOLDER else 1
        for part in parts[idx_next:]:
            found_child = None
            for child in current_node.children:
                if child.name == part:
                    found_child = child
                    break
            if found_child:
                current_node = found_child
            else:
                return None
        return current_node

# 实例化
vfs = VirtualFileSystem(db_path=settings_data.get("DATABASE_PATH"))