# CloudTune

基于 Google Drive 的在线音乐播放器，通过 Service Account 认证，无需用户登录，部署简单。

## 功能特性

- **Service Account 模式** — 后端代理 Drive API，无需用户认证，支持流式播放和拖拽快进
- **完整播放器** — 播放/暂停、上下曲、进度条拖拽、音量控制、循环/随机播放
- **深色主题** — 紫色渐变界面，适配手机和桌面
- **搜索功能** — 本地筛选 + Drive API 服务端搜索
- **文件夹浏览** — 可切换 Google Drive 文件夹播放
- **键盘快捷键** — 空格播放/暂停、方向键快进/快退、M 静音

## 系统要求

- Linux 服务器（Ubuntu 20.04+ / Debian 11+ / CentOS 8+）或 macOS / Windows
- Node.js 18+（推荐 20+）
- npm 9+
- Google Cloud 项目 + Service Account 密钥

## 文件结构

```
music-player/
├── index.html          # 前端页面（SA 模式，无需 OAuth2）
├── server.js           # Express 后端（SA 认证 + Drive API 代理 + Range 流式传输）
├── package.json        # 后端依赖
├── sa-key.json.README  # SA 密钥配置说明
├── css/
│   └── style.css       # 深色主题 + 响应式
└── js/
    ├── config.js       # 配置管理（文件夹 ID、音量）
    ├── auth.js         # SA 模式检测
    ├── drive.js        # Drive API（通过后端代理）
    ├── player.js       # 音频播放器（流式播放，支持拖拽）
    └── app.js          # UI 控制器
```

---

## 安装

### 1. 克隆项目

```bash
git clone https://github.com/dakerclaw/CloudTune.git /opt/cloudtune
cd /opt/cloudtune
```

### 2. 安装 Node.js

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# CentOS / RHEL
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# 验证
node -v   # 应 >= 18
npm -v
```

### 3. 安装依赖

```bash
cd /opt/cloudtune
npm install
```

### 4. 配置 Service Account

#### 创建 SA 密钥

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目或选择已有项目
3. 启用 **Google Drive API**（APIs & Services → Library → 搜索 Drive → Enable）
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

1. 打开 `sa-key.json`，找到 `client_email` 的值
2. 在 Google Drive 中，右键音乐文件夹 → **共享**
3. 添加 SA 的 email，权限选择 **Viewer（查看者）**
4. 复制文件夹 URL 中的 ID：
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
   ```

#### 配置环境变量

```bash
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
sudo systemctl enable cloudtune
sudo systemctl start cloudtune

# 查看状态
sudo systemctl status cloudtune

# 查看日志
sudo journalctl -u cloudtune -f
```

启动成功后应看到：

```
✅ Service Account authenticated as: cloudtune-player@your-project.iam.gserviceaccount.com
🎵 CloudTune server running at http://localhost:3000
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
        proxy_buffering off;
        proxy_request_buffering off;
    }

    location /api/stream/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header Range $http_range;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/cloudtune /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 更新

```bash
cd /opt/cloudtune
git pull origin main
npm install
sudo systemctl restart cloudtune
```

## 卸载

```bash
sudo systemctl stop cloudtune
sudo systemctl disable cloudtune
sudo rm /etc/systemd/system/cloudtune.service
sudo systemctl daemon-reload
sudo rm -rf /opt/cloudtune
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器监听端口 |
| `FOLDER_ID` | 空 | Google Drive 音乐文件夹 ID |
| `SA_KEY_PATH` | `./sa-key.json` | Service Account 密钥文件路径 |

## 常见问题

### SA 密钥认证失败

```bash
cat /opt/cloudtune/sa-key.json | jq .client_email
sudo journalctl -u cloudtune --no-pager -n 50
```

### 端口冲突

```bash
sudo lsof -i :3000
echo "PORT=8080" | sudo tee -a /opt/cloudtune/.env
sudo systemctl restart cloudtune
```

### 音频文件未显示

- 确认 `FOLDER_ID` 正确
- 确认文件夹已共享给 SA email（Viewer 权限）
- 确认文件夹中有音频文件（mp3 / wav / flac / m4a / ogg / aac 等）

## License

MIT
