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

- Linux / macOS / Windows
- Node.js 18+（推荐 22）
- npm 9+
- Google Cloud 项目 + Service Account 密钥

## 文件结构

```
~/cloudtune/
├── index.html          # 前端页面（SA 模式，无需 OAuth2）
├── server.js           # Express 后端（SA 认证 + Drive API 代理 + Range 流式传输）
├── package.json        # 后端依赖
├── install.sh         # 交互式一键安装脚本
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

## 一键安装（推荐）

```bash
# 下载并运行安装脚本
curl -fsSL https://raw.githubusercontent.com/dakerclaw/CloudTune/main/install.sh | bash
```

脚本会自动完成以下步骤（全部交互式）：
1. 检测系统环境（包管理器、init 系统）
2. 检查 / 安装 Node.js（支持 apt/yum/dnf/nvm）
3. 选择安装目录（默认 `~/cloudtune`）
4. 克隆项目并安装依赖
5. 交互式配置：
   - 端口号（默认 3296）
   - Google Drive 文件夹 ID（支持粘贴完整 URL，自动提取 ID）
   - SA 密钥（支持粘贴 JSON 内容或暂时跳过）
6. 可选配置 systemd 开机自启 + 防火墙

---

## 手动安装

### 1. 克隆项目

```bash
# 安装到当前用户主目录下
git clone https://github.com/dakerclaw/CloudTune.git ~/cloudtune
cd ~/cloudtune
```

### 2. 安装 Node.js

#### 方式 A：通过 NodeSource 安装（需要 sudo）

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

#### 方式 B：通过 nvm 安装（无需 sudo，推荐）

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
> systemd 服务中需用 `which node` 查看实际路径并替换 `ExecStart` 中的路径。

#### CentOS / RHEL

```bash
sudo yum install -y curl
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs
node -v
```

### 3. 安装依赖

```bash
cd ~/cloudtune
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

有两种方式配置 SA 密钥：

**方式 A：手动放置**

```bash
# 将下载的 JSON 文件放到项目根目录，命名为 sa-key.json
cp ~/Downloads/你的密钥文件.json ~/cloudtune/sa-key.json

# 设置安全权限（仅自己可读）
chmod 600 ~/cloudtune/sa-key.json
```

**方式 B：粘贴 JSON 内容**

如果不方便传输文件，可以直接粘贴 JSON 内容：

```bash
# 编辑 sa-key.json，粘贴完整的 JSON 内容
nano ~/cloudtune/sa-key.json

# 设置安全权限
chmod 600 ~/cloudtune/sa-key.json
```

> **提示**：可以使用 `cat ~/Downloads/你的密钥文件.json | pbcopy`（macOS）或 `cat ~/Downloads/你的密钥文件.json | xclip -selection clipboard`（Linux）复制内容，然后粘贴到远程服务器。

#### 共享音乐文件夹

1. 打开 `sa-key.json`，找到 `client_email` 的值
2. 在 Google Drive 中，右键音乐文件夹 → **共享**
3. 添加 SA 的 email，权限选择 **Viewer（查看者）**
4. 复制文件夹 ID 或完整 URL：
   - **仅 ID**：`FOLDER_ID_HERE`（从 URL `https://drive.google.com/drive/folders/FOLDER_ID_HERE` 中提取）
   - **完整 URL**：`https://drive.google.com/drive/folders/FOLDER_ID_HERE`（install.sh 会自动提取 ID）

> **提示**：在 `install.sh` 交互式配置中，可以直接粘贴完整的 Google Drive 文件夹 URL，脚本会自动提取 FOLDER_ID。

#### 配置环境变量

```bash
cat > ~/cloudtune/.env << 'EOF'
FOLDER_ID=你的文件夹ID
PORT=3296
EOF

chmod 600 ~/cloudtune/.env
```

> **注意**：`server.js` 会自动读取项目根目录下的 `.env` 文件，无需额外安装 `dotenv`。

### 5. 测试启动

```bash
cd ~/cloudtune
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
⚠️  Service Account key file NOT found at: /home/你的用户名/cloudtune/sa-key.json
   Place your sa-key.json file in the project directory to enable music playback.

🎵 CloudTune server running at http://localhost:3296
   ⚠️  SA not configured. Visit http://localhost:3296 for setup instructions.
```

此时访问 `http://服务器IP:3296`，会看到友好的配置引导页面，提示如何配置 SA 密钥和 FOLDER_ID。

---

### 6. 配置 systemd 服务（开机自启，可选）

> 如果不需要开机自启，每次手动运行 `node server.js` 即可。

```bash
# 查看 node 实际路径
NODE_PATH=$(which node)
echo "Node path: $NODE_PATH"

# 创建 systemd 服务文件（将 YOUR_USER 替换为你的用户名）
sudo tee /etc/systemd/system/cloudtune.service << EOF
[Unit]
Description=CloudTune Music Player
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/cloudtune
EnvironmentFile=/home/YOUR_USER/cloudtune/.env
ExecStart=${NODE_PATH} /home/YOUR_USER/cloudtune/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

然后启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudtune
sudo systemctl start cloudtune

# 查看状态
sudo systemctl status cloudtune

# 查看日志
sudo journalctl -u cloudtune -f
```

> **提示**：将 `YOUR_USER` 替换为实际用户名，可以用 `whoami` 命令查看。

### 7. 开放防火墙端口

```bash
# Ubuntu / Debian
sudo ufw allow 3296/tcp
sudo ufw reload
sudo ufw status

# CentOS / RHEL
sudo firewall-cmd --permanent --add-port=3296/tcp
sudo firewall-cmd --reload
```

### 8. 云服务器安全组（如适用）

如果使用阿里云、腾讯云、AWS 等云服务器，还需在云控制台的**安全组**中手动开放 **3296** 端口（TCP 入站）。

---

## 更新

```bash
cd ~/cloudtune
git pull origin main
npm install
# 如果配置了 systemd：
sudo systemctl restart cloudtune
```

## 卸载

```bash
# 停止并移除服务（如果配置了 systemd）
sudo systemctl stop cloudtune
sudo systemctl disable cloudtune
sudo rm /etc/systemd/system/cloudtune.service
sudo systemctl daemon-reload

# 删除项目文件
rm -rf ~/cloudtune

# （可选）卸载 Node.js
# 方式 A（NodeSource）：
sudo apt purge -y nodejs
sudo rm -rf /etc/apt/sources.list.d/nodesource.list
sudo rm -rf /etc/apt/keyrings/nodesource.gpg

# 方式 B（nvm）：
rm -rf ~/.nvm
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3296` | 服务器监听端口 |
| `FOLDER_ID` | 空 | Google Drive 音乐文件夹 ID（支持从完整 URL 自动提取） |
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
# 检查密钥文件是否存在
ls -la ~/cloudtune/sa-key.json

# 检查密钥文件格式
cat ~/cloudtune/sa-key.json | python3 -m json.tool

# 查看 client_email
cat ~/cloudtune/sa-key.json | grep client_email

# 查看服务日志（如果配置了 systemd）
sudo journalctl -u cloudtune --no-pager -n 50
```

**常见原因**：
1. **密钥文件格式错误**：确保是有效的 JSON 文件
2. **文件夹未共享给 SA**：确认已将文件夹共享给 `client_email` 中的邮箱
3. **网络问题**：确保服务器可以访问 Google API（Drive API）

### 端口冲突

```bash
# 查看端口占用
sudo lsof -i :3296

# 修改端口
echo "PORT=8080" >> ~/cloudtune/.env
# 然后重启服务
```

### systemd 服务启动失败

```bash
# 检查 node 路径是否正确
which node
# 确保与 cloudtune.service 中 ExecStart 路径一致

# 检查 .env 文件格式（不能有引号、不能有 export 前缀）
cat ~/cloudtune/.env

# 检查文件权限
ls -la ~/cloudtune/sa-key.json
ls -la ~/cloudtune/.env
```

### git pull 报错 `dubious ownership`

```bash
# 添加 safe.directory 例外
git config --global --add safe.directory ~/cloudtune
# 然后重新 pull
cd ~/cloudtune && git pull origin main
```

### 音频文件未显示

- 确认 `FOLDER_ID` 正确
- 确认文件夹已共享给 SA email（Viewer 权限）
- 确认文件夹中有音频文件（mp3 / wav / flac / m4a / ogg / aac 等）

## License

MIT
