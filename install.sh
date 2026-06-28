#!/usr/bin/env bash
#
# CloudTune 交互式一键安装脚本
# 用法: bash install.sh
#

set -uo pipefail

# ─── 修复 curl | bash 时 stdin 被占用的问题 ─────────────
# 如果 stdin 不是终端（被管道占用），自动下载到 /tmp 后重新运行
if [ ! -t 0 ]; then
  TMP_SCRIPT=$(mktemp /tmp/cloudtune-install.XXXXXX.sh 2>/dev/null || echo "/tmp/cloudtune-install.$$.sh")
  printf "\033[1;33m⚠️  检测到 stdin 被管道占用（curl | bash），自动重新启动交互式安装...\033[0m\n"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "https://raw.githubusercontent.com/dakerclaw/CloudTune/main/install.sh" -o "$TMP_SCRIPT" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q "https://raw.githubusercontent.com/dakerclaw/CloudTune/main/install.sh" -O "$TMP_SCRIPT" 2>/dev/null
  fi
  if [ -s "$TMP_SCRIPT" ]; then
    chmod +x "$TMP_SCRIPT"
    exec bash "$TMP_SCRIPT" < /dev/tty
  else
    rm -f "$TMP_SCRIPT"
    printf "\033[0;31m❌ 无法自动下载脚本，请手动执行：\033[0m\n"
    printf "   wget https://raw.githubusercontent.com/dakerclaw/CloudTune/main/install.sh\n"
    printf "   bash install.sh\n"
    exit 1
  fi
fi

# ─── 颜色 ────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { printf "${BLUE}ℹ️  %s${NC}\n" "$*" >&2; }
success(){ printf "${GREEN}✅ %s${NC}\n" "$*" >&2; }
warn()    { printf "${YELLOW}⚠️  %s${NC}\n" "$*" >&2; }
error()   { printf "${RED}❌ %s${NC}\n" "$*" >&2; }
step()    { printf "\n${BOLD}${CYAN}▶ %s${NC}\n" "$*" >&2; }

# ─── 检测包管理器 ─────────────────────────────────────
detect_pkg() {
  if command -v apt >/dev/null 2>&1; then PKG=apt
  elif command -v dnf >/dev/null 2>&1; then PKG=dnf
  elif command -v yum >/dev/null 2>&1; then PKG=yum
  elif command -v pacman >/dev/null 2>&1; then PKG=pacman
  else PKG=unknown
  fi
}

# ─── 检测 init 系统 ─────────────────────────────────────
detect_init() {
  if command -v systemctl >/dev/null 2>&1 && systemctl --version >/dev/null 2>&1; then
    INIT=systemd
  else
    INIT=other
  fi
}

# ─── 询问（带默认值）────────────────────────────────────
ask() {
  local prompt="$1" default="$2" varname="$3"
  local input=""
  if [ -n "$default" ]; then
    printf "${YELLOW}%s ${NC}[%s]: " "$prompt" "$default" >&2
  else
    printf "${YELLOW}%s${NC}: " "$prompt" >&2
  fi
  read -r input
  input="${input:-$default}"
  eval "$varname=\"\$input\""
}

# ─── 询问（是/否）──────────────────────────────────────
ask_yesno() {
  local prompt="$1" default="${2:-Y}" varname="$3"
  local input=""
  while true; do
    if [ "$default" = "Y" ]; then
      printf "${YELLOW}%s ${NC}[Y/n]: " "$prompt" >&2
    else
      printf "${YELLOW}%s ${NC}[y/N]: " "$prompt" >&2
    fi
    read -r input
    input="${input:-$default}"
    case "$input" in
      [Yy]|[Yy][Ee][Ss]) eval "$varname=Y"; break ;;
      [Nn]|[Nn][Oo])   eval "$varname=N"; break ;;
      *) echo "  请输入 Y 或 N" >&2 ;;
    esac
  done
}

# ─── 验证端口号 ─────────────────────────────────────────
validate_port() {
  local port="$1"
  # 检查是否为数字
  if ! [ "$port" -eq "$port" ] 2>/dev/null; then
    return 1
  fi
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    return 1
  fi
  # 检查端口是否被占用
  if command -v lsof >/dev/null 2>&1 && lsof -i:"$port" >/dev/null 2>&1; then
    warn "端口 $port 已被占用"
    return 1
  fi
  return 0
}

# ─── 验证 FOLDER_ID ─────────────────────────────────────
validate_folder_id() {
  local id="$1"
  if [ -z "$id" ]; then
    warn "FOLDER_ID 不能为空"
    return 1
  fi
  return 0
}

# ─── 验证 SA 密钥 JSON ──────────────────────────────────
validate_sa_key() {
  local content="$1"
  # 用 node 验证 JSON（使用单引号包裹 JS 代码避免引号冲突）
  echo "$content" | node -e '
    let d="";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        if (j.client_email && j.private_key) process.exit(0);
        else process.exit(1);
      } catch(e) { process.exit(1); }
    });
  ' 2>/dev/null
  return $?
}

# ─── nvm 安装 Node.js ─────────────────────────────────────
install_nvm() {
  info "正在通过 nvm 安装 Node.js 22 ..."
  # 检查 nvm 是否已安装
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    info "nvm 已安装，跳过安装步骤"
    . "$HOME/.nvm/nvm.sh"
  else
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  fi
  nvm install 22
  nvm use 22
  success "Node.js $(node -v) 安装成功 (nvm)"
}

# ─── 主流程 ─────────────────────────────────────────────
main() {
  echo -e "${BOLD}${CYAN}"
  echo "╔════════════════════════════════════════════════════╗"
  echo "║                                                  ║"
  echo "║           🎵  CloudTune 一键安装脚本  🎵             ║"
  echo "║                                                  ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  # ── 步骤 1：检测系统 ────────────────────────────────
  step "步骤 1/8 — 检测系统环境"
  detect_pkg
  detect_init
  info "包管理器: $PKG"
  info "Init 系统: $INIT"
  success "系统检测完成"

  # ── 步骤 2：检查 / 安装 Node.js ───────────────────
  step "步骤 2/8 — 检查 Node.js"
  local need_node=true
  if command -v node >/dev/null 2>&1; then
    local node_ver
    node_ver=$(node -v)
    local major="${node_ver#v}"
    major="${major%%.*}"
    if [ "$major" -ge 18 ] 2>/dev/null; then
      need_node=false
      success "Node.js 已安装: $node_ver ($(command -v node))"
    else
      warn "Node.js 版本过低 ($node_ver)，需要 18+"
    fi
  fi

  if $need_node 2>/dev/null; then
    echo ""
    info "未检测到 Node.js 18+，需要安装"
    local can_sudo=false
    if [ "$(id -u)" -eq 0 ] 2>/dev/null; then
      can_sudo=true
    elif sudo -n true 2>/dev/null; then
      can_sudo=true
    fi
    if $can_sudo; then
      ask_yesno "使用系统包管理器安装 Node.js 22？（需要 sudo）" "Y" use_apt
      if [ "$use_apt" = "Y" ]; then
        info "正在安装 Node.js 22 ..."
        case "$PKG" in
          apt)
            sudo apt update -y
            sudo apt install -y curl ca-certificates gnupg
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt install -y nodejs
            ;;
          dnf|yum)
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
            sudo "$PKG" install -y nodejs
            ;;
          pacman)
            sudo pacman -Sy --noconfirm nodejs npm
            ;;
          *)
            error "无法识别的包管理器，请手动安装 Node.js 18+"
            exit 1
            ;;
        esac
        success "Node.js $(node -v) 安装成功"
      else
        install_nvm
      fi
    else
      warn "无 sudo 权限，将通过 nvm 安装 Node.js"
      install_nvm
    fi
  fi

  # 确保 node 在当前 shell 可用（nvm 安装后需要 source）
  if ! command -v node >/dev/null 2>&1; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  fi

  if ! command -v node >/dev/null 2>&1; then
    error "Node.js 未安装，请手动安装后重试"
    exit 1
  fi
  local NODE_PATH
  NODE_PATH="$(command -v node)"

  # ── 步骤 3：选择安装目录 ────────────────────────────
  step "步骤 3/8 — 选择安装目录"
  local INSTALL_DIR=""
  ask "安装目录" "$HOME/cloudtune" INSTALL_DIR
  INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"

  if [ -d "$INSTALL_DIR" ]; then
    warn "目录已存在: $INSTALL_DIR"
    ask_yesno "删除并重新安装？" "N" overwrite
    if [ "$overwrite" = "Y" ]; then
      rm -rf "$INSTALL_DIR"
    else
      error "安装已取消"
      exit 1
    fi
  fi

  # ── 步骤 4：克隆项目 ────────────────────────────────
  step "步骤 4/8 — 克隆 CloudTune 项目"
  if ! command -v git >/dev/null 2>&1; then
    error "git 未安装，请先安装 git"
    exit 1
  fi
  git clone https://github.com/dakerclaw/CloudTune.git "$INSTALL_DIR"
  # 修复 dubious ownership
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  success "项目已克隆到: $INSTALL_DIR"

  # ── 步骤 5：安装依赖 ────────────────────────────────
  step "步骤 5/8 — 安装 npm 依赖"
  cd "$INSTALL_DIR" || { error "无法进入目录 $INSTALL_DIR"; exit 1; }
  if npm install --registry=https://registry.npmmirror.com 2>/dev/null; then
    success "依赖安装完成（淘宝镜像）"
  elif npm install; then
    success "依赖安装完成"
  else
    error "npm install 失败"
    exit 1
  fi

  # ── 步骤 6：交互式配置 ────────────────────────────
  step "步骤 6/8 — 交互式配置"

  # 6.1 端口号
  echo ""
  info "6.1 配置监听端口"
  local port="3296"
  while true; do
    ask "服务端口号 (1-65535)" "$port" port
    if validate_port "$port"; then
      success "端口 $port 可用"
      break
    else
      warn "端口 $port 不可用，请重新输入"
    fi
  done

  # 6.2 Google Drive 文件夹 ID
  echo ""
  info "6.2 配置 Google Drive 音乐文件夹 ID"
  info "   获取方式：打开 Drive 文件夹 → 复制 URL 中的 ID"
  info "   示例: https://drive.google.com/drive/folders/1AbC2DeF3GhI4JkL5"
  local folder_id=""
  while true; do
    ask "FOLDER_ID" "$folder_id" folder_id
    if validate_folder_id "$folder_id"; then
      success "FOLDER_ID: $folder_id"
      break
    else
      warn "请输入有效的 FOLDER_ID"
    fi
  done

  # 6.3 Service Account 密钥
  echo ""
  info "6.3 配置 Service Account 密钥"
  echo ""
  info "请选择 SA 密钥输入方式："
  echo "  ${CYAN}1${NC}) 直接粘贴 JSON 内容（推荐，从 Windows 复制后粘贴）"
  echo "  ${CYAN}2${NC}) 跳过，稍后手动配置"
  echo ""
  local sa_key_content=""
  local sa_input_method=""
  while true; do
    printf "${YELLOW}请选择 [1/2，默认 1]${NC}: "
    read -r sa_input_method
    sa_input_method="${sa_input_method:-1}"
    case "$sa_input_method" in
      1)
        echo ""
        info "请将 SA 密钥 JSON 内容粘贴到下方"
        info "  （从 Windows 下载的 JSON 文件，用记事本打开后全选复制，右键粘贴到此处）"
        info "  （粘贴后单独输入 done 并回车确认）"
        echo ""
        sa_key_content=""
        local paste_line
        while IFS= read -r paste_line; do
          [ "$paste_line" = "done" ] && break
          if [ -z "$sa_key_content" ]; then
            sa_key_content="$paste_line"
          else
            sa_key_content="${sa_key_content}
${paste_line}"
          fi
        done
        if [ -z "$sa_key_content" ]; then
          warn "未检测到输入，请重新选择"
          continue
        fi
        if validate_sa_key "$sa_key_content"; then
          echo "$sa_key_content" > "$INSTALL_DIR/sa-key.json"
          chmod 600 "$INSTALL_DIR/sa-key.json"
          success "sa-key.json 已写入: $INSTALL_DIR/sa-key.json"
          break
        else
          error "JSON 格式验证失败，请重新输入"
          continue
        fi
        ;;
      2)
        warn "跳过 SA 密钥配置"
        info "安装完成后，请将 SA 密钥 JSON 文件命名为 sa-key.json"
        info "放到: $INSTALL_DIR/sa-key.json"
        break
        ;;
      *)
        warn "请输入 1 或 2"
        continue
        ;;
    esac
  done

  # 如果已写入 sa-key.json，提示共享文件夹
  if [ -s "$INSTALL_DIR/sa-key.json" ]; then
    local sa_email=""
    sa_email=$(cat "$INSTALL_DIR/sa-key.json" | node -e '
      let d="";
      process.stdin.on("data",c=>d+=c);
      process.stdin.on("end",()=>{
        try{console.log(JSON.parse(d).client_email||"")}catch(e){}
      });
    ' 2>/dev/null || echo "")
    if [ -n "$sa_email" ]; then
      echo ""
      warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      warn "  重要：请将以下邮箱添加为 Google Drive 音乐文件夹的查看者"
      warn "  $sa_email"
      warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      read -r -p "$(echo -e "${YELLOW}已共享文件夹？按 Enter 继续...${NC}")" _
    fi
  fi

  # 6.4 网络代理（可选）
  echo ""
  info "6.4 配置网络代理（可选，用于访问 Google API）"
  local proxy_url=""
  ask "代理地址 (留空跳过，格式如 http://192.168.1.1:7890)" "" proxy_url
  if [[ -n "$proxy_url" ]]; then
    # 验证代理 URL 格式
    if [[ "$proxy_url" =~ ^https?://[^[:space:]]+:[0-9]+$ ]]; then
      success "将使用代理: $proxy_url"
    else
      # 自动补全 http:// 前缀
      if [[ "$proxy_url" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$ ]] || \
         [[ "$proxy_url" =~ ^localhost:[0-9]+$ ]] || \
         [[ "$proxy_url" =~ ^127\.0\.0\.1:[0-9]+$ ]]; then
        proxy_url="http://${proxy_url}"
        success "自动补全代理地址: $proxy_url"
      else
        warn "代理格式不正确，跳过"
        proxy_url=""
      fi
    fi
  fi

  # 6.5 写入 .env 文件
  echo ""
  info "6.5 写入环境变量配置"
  cat > "$INSTALL_DIR/.env" << EOF
FOLDER_ID=${folder_id}
PORT=${port}
EOF
  if [[ -n "$proxy_url" ]]; then
    echo "HTTPS_PROXY=${proxy_url}" >> "$INSTALL_DIR/.env"
  fi
  chmod 600 "$INSTALL_DIR/.env"
  success ".env 已写入: $INSTALL_DIR/.env"

  # ── 步骤 7：启动测试 ────────────────────────────────
  step "步骤 7/8 — 启动测试"
  echo ""
  info "正在启动 CloudTune 服务进行测试 ..."
  cd "$INSTALL_DIR" || { error "无法进入目录 $INSTALL_DIR"; exit 1; }
  node server.js > /tmp/cloudtune-test.log 2>&1 &
  local server_pid=$!
  sleep 5

  if kill -0 "$server_pid" 2>/dev/null; then
    success "服务启动成功！"
    echo ""
    info "服务日志："
    tail -10 /tmp/cloudtune-test.log
    echo ""
    info "本地访问地址: http://localhost:${port}"
    echo ""
    read -r -p "$(echo -e "${YELLOW}按 Enter 停止测试服务并继续...${NC}")" _
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  else
    error "服务启动失败，查看日志："
    cat /tmp/cloudtune-test.log
    warn "你可以手动运行以下命令排查问题："
    echo "  cd $INSTALL_DIR && node server.js"
  fi

  # ── 步骤 8：配置 systemd（可选）────────────────────
  step "步骤 8/8 — 配置开机自启（可选）"
  if [ "$INIT" = "systemd" ]; then
    ask_yesno "配置 systemd 开机自启？" "Y" setup_systemd
    if [ "$setup_systemd" = "Y" ]; then
      local current_user=""
      current_user=$(whoami)
      local service_file="/etc/systemd/system/cloudtune.service"
      sudo tee "$service_file" > /dev/null << SVC
[Unit]
Description=CloudTune Music Player
After=network.target

[Service]
Type=simple
User=${current_user}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NODE_PATH} ${INSTALL_DIR}/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC
      sudo systemctl daemon-reload
      sudo systemctl enable cloudtune
      sudo systemctl start cloudtune
      sleep 2
      if sudo systemctl is-active --quiet cloudtune; then
        success "systemd 服务已启动并设置为开机自启"
        info "管理命令："
        echo "  查看状态: sudo systemctl status cloudtune"
        echo "  查看日志: sudo journalctl -u cloudtune -f"
        echo "  重启服务: sudo systemctl restart cloudtune"
      else
        error "systemd 服务启动失败"
        sudo systemctl status cloudtune --no-pager || true
      fi
    fi
  else
    info "当前系统不支持 systemd，跳过开机自启配置"
    info "每次手动启动: cd $INSTALL_DIR && node server.js"
  fi

  # ── 开放防火墙端口 ──────────────────────────────────
  echo ""
  ask_yesno "是否开放防火墙端口 ${port}？" "Y" open_fw
  if [ "$open_fw" = "Y" ]; then
    if command -v ufw >/dev/null 2>&1; then
      sudo ufw allow "${port}/tcp"
      sudo ufw reload 2>/dev/null || true
      success "防火墙端口 $port 已开放 (ufw)"
    elif command -v firewall-cmd >/dev/null 2>&1; then
      sudo firewall-cmd --permanent --add-port="${port}/tcp"
      sudo firewall-cmd --reload
      success "防火墙端口 $port 已开放 (firewalld)"
    else
      warn "未检测到 ufw / firewalld，请手动开放端口 $port"
    fi
  fi

  # ── 安装完成 ────────────────────────────────────────
  echo ""
  echo -e "${BOLD}${GREEN}"
  echo "╔════════════════════════════════════════════════════╗"
  echo "║                                                  ║"
  echo "║             🎉  安装完成！  🎉                      ║"
  echo "║                                                  ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo ""
  info "安装目录: $INSTALL_DIR"
  local server_ip=""
  server_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")
  info "访问地址: http://${server_ip}:${port}"
  info "本地访问: http://localhost:${port}"
  echo ""
  if [ "${setup_systemd:-N}" != "Y" ]; then
    info "启动服务: cd ${INSTALL_DIR} && node server.js"
  else
    info "服务管理: sudo systemctl status cloudtune"
  fi
  echo ""
  warn "云服务器请注意：还需在云控制台安全组中开放端口 ${port}"
  echo ""
}

main "$@"
