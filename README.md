# CloudTune - 云端音乐播放器

基于 Google Drive 的在线音乐播放器，支持 Service Account（无需用户认证）和 OAuth2 双模式，适配手机访问。

## 功能特性

- **Service Account 模式** — 后端代理 Drive API，用户无需认证弹窗，支持流式播放和拖拽快进
- **OAuth2 模式** — 前端 GIS 认证直连 Drive API（SA 不可用时自动降级）
- **完整播放器** — 播放/暂停、上下曲、进度条拖拽、音量控制、循环/随机播放
- **深色主题** — 灵感来自 Spotify 的紫色渐变界面
- **手机适配** — 多断点响应式设计（640px / 380px / 768px）
- **搜索功能** — 本地筛选 + Drive API 服务端搜索
- **文件夹浏览** — 可切换到特定 Drive 文件夹播放
- **键盘快捷键** — 空格播放/暂停、方向键快进/快退、M 静音

## 系统要求

- Linux 服务器（Ubuntu 20.04+ / Debian 11+ / CentOS 8+）
- Node.js 18+（推荐 20+）
- npm 9+
- Google Cloud 项目 + Service Account 密钥（SA 模式）

## 文件结构

```
music-player/
├── index.html          # 主页面
├── server.js           # Express 后端（SA 认证 + Drive API 代理 + Range 流式传输）
├── package.json        # 后端依赖（express, google-auth-library）
├── sa-key.json.README  # SA 密钥配置说明
├── css/
│   └── style.css       # 深色主题样式 + 移动端响应式
└── js/
    ├── config.js       # 配置管理（双模式自动检测）
    ├── auth.js         # 双模式认证（SA: 后端代理 / OAuth2: GIS token）
    ├── drive.js        # 双模式 Drive API（SA: /api/* / OAuth2: 直连 + blob）
    ├── player.js       # 双模式播放器（SA: 流式URL / OAuth2: blob URL）
    └── app.js          # UI 控制器
```

---

## 安装

### 1. 克隆项目

```bash
git clone <你的仓库地址> /opt/cloudtune
cd /opt/cloudtune
```

或直接上传项目文件到 `/opt/cloudtune`。

### 2. 安装 Node.js

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# CentOS / RHEL
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# 验证版本
node -v   # 应 >= 18
npm -v
```

### 3. 安装依赖

```bash
cd /opt/cloudtune
npm install
```

### 4. 配置 Service Account（推荐模式）

#### 创建 SA 密钥

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目或选择已有项目
3. 启用 **Google Drive API**（左侧导航 → APIs & Services → Library → 搜索 Drive → Enable）
4. 进入 **IAM & Admin → Service Accounts**
5. 点击 **Create Service Account**
   - 名称：`cloudtune-player`
   - 角色：无需授予项目角色
6. 点击 **Create Key** → 选择 **JSON** → 下载

#### 放置密钥文件

```bash
# 将下载的 JSON 文件放到项目根目录，命名为 sa-key.json
cp ~/Downloads/你的密钥文件.json /opt/cloudtune/sa-key.json

# 设置安全权限（仅 root 可读）
sudo chmod 600 /opt/cloudtune/sa-key.json
```

#### 共享音乐文件夹

1. 打开 `sa-key.json`，找到 `client_email` 的值（如 `cloudtune-player@your-project.iam.gserviceaccount.com`）
2. 在 Google Drive 中，右键你的音乐文件夹 → **共享**
3. 添加 SA 的 email，权限选择 **Viewer（查看者）**
4. 复制文件夹 URL 中的 ID：
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
   ```
   `FOLDER_ID_HERE` 即为文件夹 ID

#### 配置环境变量

```bash
# 创建环境变量文件
sudo tee /opt/cloudtune/.env << 'EOF'
FOLDER_ID=你的文件夹ID
PORT=3000
EOF

sudo chmod 600 /opt/cloudtune/.env
```

### 5. 配置 systemd 服务

```bash
sudo tee /etc/systemd/system/cloudtune.service << 'EOF'
[Unit]
Description=CloudTune Music Player
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cloudtune
EnvironmentFile=/opt/cloudtune/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 6. 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudtune     # 开机自启
sudo systemctl start cloudtune      # 启动服务

# 查看状态
sudo systemctl status cloudtune

# 查看日志
sudo journalctl -u cloudtune -f
```

启动成功后应看到：

```
✅ Service Account authenticated as: cloudtune-player@your-project.iam.gserviceaccount.com
🎵 CloudTune server running at http://localhost:3000
   Mode: Service Account
   SA Email: cloudtune-player@...
   Share your music folder with: cloudtune-player@...
```

### 7. 配置 Nginx 反向代理（可选，推荐 HTTPS）

```bash
sudo apt install -y nginx

sudo tee /etc/nginx/sites-available/cloudtune << 'EOF'
server {
    listen 80;
    server_name music.yourdomain.com;

    # 强制 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name music.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 音频流式传输支持
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # /api/stream 路径需要支持 Range 请求
    location /api/stream/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header Range $http_range;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/cloudtune /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

如果使用 Let's Encrypt：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d music.yourdomain.com
```

---

## 更新

### 方式一：Git 拉取更新

```bash
cd /opt/cloudtune
git pull origin main

# 更新依赖（如有变化）
npm install

# 重启服务
sudo systemctl restart cloudtune

# 验证
sudo systemctl status cloudtune
```

### 方式二：手动文件替换

```bash
# 备份当前版本
sudo cp -r /opt/cloudtune /opt/cloudtune.bak.$(date +%Y%m%d)

# 上传新文件到 /opt/cloudtune（覆盖旧文件）
# 注意：不要覆盖 sa-key.json 和 .env

# 更新依赖
cd /opt/cloudtune && npm install

# 重启服务
sudo systemctl restart cloudtune
```

### 版本检查

```bash
curl -s http://localhost:3000/api/status | jq .
```

返回示例：

```json
{
  "mode": "service-account",
  "saEmail": "cloudtune-player@your-project.iam.gserviceaccount.com",
  "folderId": "1aBc...xYz",
  "version": "1.0.0"
}
```

---

## 卸载

### 1. 停止并移除服务

```bash
sudo systemctl stop cloudtune
sudo systemctl disable cloudtune
sudo rm /etc/systemd/system/cloudtune.service
sudo systemctl daemon-reload
```

### 2. 移除 Nginx 配置（如已配置）

```bash
sudo rm /etc/nginx/sites-available/cloudtune
sudo rm /etc/nginx/sites-enabled/cloudtune
sudo nginx -t && sudo systemctl reload nginx
```

### 3. 删除项目文件

```bash
sudo rm -rf /opt/cloudtune
```

### 4. 删除 SA 密钥相关资源（Google Cloud Console）

1. 进入 **IAM & Admin → Service Accounts**
2. 删除 `cloudtune-player` Service Account
3. 进入 **APIs & Services → Library**
4. 禁用 **Google Drive API**（如不再需要）

### 5. 卸载 Node.js（如不再需要）

```bash
# Ubuntu / Debian
sudo apt remove -y nodejs
sudo rm -rf /etc/apt/sources.list.d/nodesource.list

# CentOS / RHEL
sudo yum remove -y nodejs
```

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器监听端口 |
| `FOLDER_ID` | 空 | Google Drive 音乐文件夹 ID（SA 模式必填） |
| `SA_KEY_PATH` | `./sa-key.json` | Service Account 密钥文件路径 |

## 认证模式说明

| 模式 | 用户体验 | 播放方式 | 适用场景 |
|------|----------|----------|----------|
| **Service Account** | 无需认证，直接播放 | 流式 URL，支持拖拽快进 | 自用 / 少量用户共享 |
| **OAuth2** | 需弹窗授权 | Blob 下载后播放，不支持快进 | 多用户各自 Drive |

当 `sa-key.json` 存在且有效时，自动使用 SA 模式；否则降级为 OAuth2 模式。可在前端设置中手动切换。

## 常见问题

### SA 密钥认证失败

```bash
# 检查密钥文件是否存在且格式正确
cat /opt/cloudtune/sa-key.json | jq .client_email

# 检查是否共享了文件夹给 SA
# 在 Google Drive 中确认 SA email 有 Viewer 权限

# 查看服务日志
sudo journalctl -u cloudtune --no-pager -n 50
```

### 端口冲突

```bash
# 查看占用 3000 端口的进程
sudo lsof -i :3000

# 更换端口
echo "PORT=8080" | sudo tee -a /opt/cloudtune/.env
sudo systemctl restart cloudtune
```

### 音频文件未显示

- 确认 `FOLDER_ID` 正确（从 Drive 文件夹 URL 提取）
- 确认文件夹已共享给 SA email（查看者权限）
- 确认文件夹中有音频文件（mp3 / wav / flac / m4a / ogg / aac 等格式）

## License

MIT
