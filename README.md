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
cloudtune/
├── index.html          # 前端页面（SA 模式，无需 OAuth2）
├── server.js           # Express 后端（SA 认证 + Drive API 代理 + Range 流式传输）
├── package.json        # 后端依赖
├── sa-key.json.README  # SA 密钥配置说明
├── .env                # 环境变量（自建，不包含在仓库中）
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

#### 方式 A：通过 NodeSource 安装（推荐）

```bash
# 安装前置依赖（最小化系统可能缺少 curl）
sudo apt update
sudo apt install -y curl ca-certificates gnupg

# 安装 Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node -v   # 应 >= v18
npm -v
```

#### 方式 B：通过 Node 版本管理器安装

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# 安装 Node.js 22
nvm install 22
nvm use 22

# 验证
node -v
npm -v
```

> **注意**：使用 nvm 安装时，node 路径为 `~/.nvm/versions/node/v22.x/bin/node`，
> systemd 服务中需用 `which node` 查看实际路径并替换 `ExecStart` 中的 `/usr/bin/node`。

#### CentOS / RHEL

```bash
sudo yum install -y curl
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs
node -v
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
cat > /opt/cloudtune/.env << 'EOF'
FOLDER_ID=你的文件夹ID
PORT=3296
EOF

chmod 600 /opt/cloudtune/.env
```

> **提示**：`server.js` 会自动读取项目根目录下的 `.env` 文件，无需额外安装 `dotenv`。

### 5. 测试启动

```bash
cd /opt/cloudtune
node server.js
```

**配置成功后**看到以下输出：

```
🔧 Initializing CloudTune server...
✅ Service Account authenticated as: cloudtune-player@your-project.iam.gserviceaccount.com

🎵 CloudTune server running at http://localhost:3296
   SA Email: cloudtune-player@...
   Share your music folder with: cloudtune-player@...
```

**如果 sa-key.json 未配置**，服务也会正常启动，但浏览器会显示配置引导页面：

```
🔧 Initializing CloudTune server...
⚠️  Service Account key file NOT found at: /opt/cloudtune/sa-key.json
   Place your sa-key.json file in the project directory to enable music playback.

🎵 CloudTune server running at http://localhost:3296
   ⚠️  SA not configured. Visit http://localhost:3296 for setup instructions.
```

按 `Ctrl+C` 退出，继续配置 systemd 服务。

### 6. 配置 systemd 服务

```bash
# 查看 node 实际路径（默认安装通常为 /usr/bin/node）
NODE_PATH=$(which node)
echo "Node path: $NODE_PATH"

sudo tee /etc/systemd/system/cloudtune.service << EOF
[Unit]
Description=CloudTune Music Player
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cloudtune
EnvironmentFile=/opt/cloudtune/.env
ExecStart=${NODE_PATH} server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 7. 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudtune
sudo systemctl start cloudtune

# 查看状态
sudo systemctl status cloudtune

# 查看日志
sudo journalctl -u cloudtune -f
```

### 8. 配置 Nginx 反向代理（可选，推荐 HTTPS）

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
        proxy_pass http://127.0.0.1:3296;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    location /api/stream/ {
        proxy_pass http://127.0.0.1:3296;
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
# 停止并移除服务
sudo systemctl stop cloudtune
sudo systemctl disable cloudtune
sudo rm /etc/systemd/system/cloudtune.service
sudo systemctl daemon-reload

# 删除项目文件
sudo rm -rf /opt/cloudtune

# （可选）卸载 Node.js
sudo apt purge -y nodejs
sudo rm -rf /etc/apt/sources.list.d/nodesource.list
sudo rm -rf /etc/apt/keyrings/nodesource.gpg
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3296` | 服务器监听端口 |
| `FOLDER_ID` | 空 | Google Drive 音乐文件夹 ID |
| `SA_KEY_PATH` | `./sa-key.json` | Service Account 密钥文件路径 |

> 环境变量可通过 `.env` 文件配置（server.js 自动加载），也可通过 systemd `EnvironmentFile` 或命令行 `PORT=3296 node server.js` 设置。

## 常见问题

### npm install 失败

```bash
# 清除缓存重试
npm cache clean --force
rm -rf node_modules package-lock.json
npm install

# 如果网络问题，使用淘宝镜像
npm install --registry=https://registry.npmmirror.com
```

### SA 密钥认证失败

```bash
# 检查密钥文件格式
cat /opt/cloudtune/sa-key.json | python3 -m json.tool

# 查看 client_email
cat /opt/cloudtune/sa-key.json | grep client_email

# 查看服务日志
sudo journalctl -u cloudtune --no-pager -n 50
```

### 端口冲突

```bash
# 查看端口占用
sudo lsof -i :3296

# 修改端口
sed -i 's/PORT=3296/PORT=8080/' /opt/cloudtune/.env
sudo systemctl restart cloudtune
```

### systemd 服务启动失败

```bash
# 检查 node 路径是否正确
which node
# 确保与 cloudtune.service 中 ExecStart 路径一致

# 检查 .env 文件格式（不能有引号、不能有 export 前缀）
cat /opt/cloudtune/.env

# 检查文件权限
ls -la /opt/cloudtune/sa-key.json
ls -la /opt/cloudtune/.env
```

### 音频文件未显示

- 确认 `FOLDER_ID` 正确
- 确认文件夹已共享给 SA email（Viewer 权限）
- 确认文件夹中有音频文件（mp3 / wav / flac / m4a / ogg / aac 等）

## License

MIT
