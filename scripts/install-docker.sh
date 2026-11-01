#!/usr/bin/env bash
# ============================================================================
# Incudal 面板一键部署脚本（Docker 模式）
#
# 功能：
#   - 自动安装 Docker Engine 和 Docker Compose
#   - 从 GitHub Container Registry (ghcr.io) 拉取预构建镜像
#   - 自动配置 docker-compose.yml、环境变量
#   - 外部 PostgreSQL + 容器内 Redis 7
#   - 支持 Nginx+Certbot / Cloudflare Tunnel / 纯端口 三种外部访问方案
#   - 支持升级和卸载
#
# 用法：
#   安装：  sudo bash install-docker.sh
#   升级：  sudo bash install-docker.sh --upgrade
#   卸载：  sudo bash install-docker.sh --uninstall
#
# 项目地址: https://github.com/ashvvvvv/incudal-
# ============================================================================
set -euo pipefail

# ========================== 全局常量 ==========================
readonly SCRIPT_VERSION="1.0.0"
readonly GITHUB_REPO="ashvvvvv/incudal-"
readonly DOCKER_IMAGE="ghcr.io/${GITHUB_REPO}"
readonly INSTALL_DIR="/opt/incudal"
readonly ENV_FILE="${INSTALL_DIR}/.env"
readonly COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
readonly DEFAULT_PORT=3000
PURGE_DATA="false"
DATABASE_URL=""
DATABASE_HOST=""
DATABASE_PORT="5432"
DATABASE_NAME="incudal"
DATABASE_USER="incudal"
DATABASE_PASSWORD=""
DATABASE_SSL_MODE="require"

# ========================== 颜色定义 ==========================
readonly RED='\033[1;31m'
readonly GREEN='\033[1;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[1;36m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m'

# ========================== 工具函数 ==========================
# 所有日志输出到 stderr，避免在 $() 子 shell 中被捕获
log()   { echo -e "${GREEN}[✓]${NC} $1" >&2; }
info()  { echo -e "${CYAN}[i]${NC} $1" >&2; }
warn()  { echo -e "${YELLOW}[!]${NC} $1" >&2; }
error() { echo -e "${RED}[✗]${NC} $1" >&2; }
step()  { echo -e "\n${CYAN}[▶]${NC} ${BOLD}$1${NC}" >&2; }

divider() {
    echo -e "${DIM}────────────────────────────────────────────────────${NC}" >&2
}

# 生成随机密码
gen_password() {
    openssl rand -hex 64 | cut -c "1-${1:-24}"
}

gen_secret() {
    printf 'A1!%s' "$(openssl rand -hex 64)" | cut -c "1-${1:-48}"
}

get_env_value() {
    local key="$1"
    if [[ ! -f "$ENV_FILE" ]]; then
        return 0
    fi
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d'=' -f2- || true
}

set_env_if_missing() {
    local key="$1"
    local value="$2"
    local label="$3"
    local current
    current="$(get_env_value "$key")"

    if [[ -n "$current" ]]; then
        return 0
    fi

    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        local tmp_file
        tmp_file="$(mktemp)"
        awk -v key="$key" -v value="$value" '
            BEGIN { replaced = 0 }
            $0 ~ "^" key "=" && replaced == 0 {
                print key "=" value
                replaced = 1
                next
            }
            { print }
        ' "$ENV_FILE" > "$tmp_file"
        cat "$tmp_file" > "$ENV_FILE"
        rm -f "$tmp_file"
    else
        printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi

    log "已自动补充 ${label}: ${key}"
}

ensure_env_keys() {
    if [[ ! -f "$ENV_FILE" ]]; then
        return 0
    fi

    set_env_if_missing "REDIS_PASSWORD" "$(gen_password 24)" "Redis 密码"
    set_env_if_missing "JWT_SECRET" "$(gen_secret 48)" "JWT 密钥"
    set_env_if_missing "COOKIE_SECRET" "$(gen_secret 48)" "Cookie 密钥"
    set_env_if_missing "ENCRYPTION_KEY" "$(openssl rand -base64 32)" "敏感数据加密密钥"
    set_env_if_missing "ADMIN_PASSWORD" "$(gen_password 16)" "管理员初始密码"

    chmod 600 "$ENV_FILE"
}

# ========================== 系统检查 ==========================
check_root() {
    if [[ "$EUID" -ne 0 ]]; then
        error "请以 root 权限运行此部署脚本！"
        error "用法: sudo bash $0"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        error "无法检测操作系统（/etc/os-release 不存在）"
        exit 1
    fi

    source /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-unknown}"
    ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)

    # 仅支持 Ubuntu 和 Debian
    if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
        error "不支持的操作系统: ${OS_ID}"
        error "本脚本仅支持 Ubuntu 和 Debian 系统"
        exit 1
    fi

    # 架构检查
    case "$ARCH" in
        amd64|x86_64) ARCH="amd64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)
            error "不支持的系统架构: ${ARCH}"
            error "仅支持 amd64 (x86_64) 和 arm64 (aarch64)"
            exit 1
            ;;
    esac

    log "系统检测通过: ${OS_ID} ${OS_VERSION} (${ARCH})"
}

# ========================== 显示横幅 ==========================
show_banner() {
    echo -e "${CYAN}" >&2
    echo "╔══════════════════════════════════════════════════╗" >&2
    echo "║                                                  ║" >&2
    echo "║          Incudal 面板一键部署脚本                ║" >&2
    echo "║          Docker Compose Deploy                   ║" >&2
    echo "║                                                  ║" >&2
    echo "╚══════════════════════════════════════════════════╝" >&2
    echo -e "${NC}" >&2
    echo -e "  版本: ${BOLD}${SCRIPT_VERSION}${NC}  |  仓库: ${DIM}${GITHUB_REPO}${NC}" >&2
    echo "" >&2
}

# ========================== 安装 Docker ==========================
install_docker() {
    step "安装 Docker..."

    if command -v docker &>/dev/null; then
        local docker_version
        docker_version=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
        log "Docker ${docker_version} 已安装，跳过"
    else
        info "正在安装 Docker Engine..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq >/dev/null 2>&1

        # 安装前置依赖
        apt-get install -y -qq ca-certificates curl gnupg >/dev/null 2>&1

        # 添加 Docker 官方 GPG 密钥
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc

        # 添加 Docker 仓库
        echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${OS_ID} ${VERSION_CODENAME:-$(. /etc/os-release && echo "$VERSION_CODENAME")} stable" \
            > /etc/apt/sources.list.d/docker.list

        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null 2>&1

        # 确保 Docker 启动
        systemctl enable docker >/dev/null 2>&1
        systemctl start docker

        log "Docker 安装完成"
    fi

    # 检查 Docker Compose
    if docker compose version &>/dev/null; then
        log "Docker Compose 已可用"
    else
        error "Docker Compose 不可用，请手动安装 docker-compose-plugin"
        exit 1
    fi
}

# ========================== 生成面板客户端证书 ==========================
generate_panel_cert() {
    local cert_dir="${INSTALL_DIR}/server/certs"
    local cert_file="${cert_dir}/client.crt"
    local key_file="${cert_dir}/client.key"

    step "配置面板客户端证书..."

    # 幂等性：证书已存在则跳过
    if [[ -f "$cert_file" && -f "$key_file" ]]; then
        log "面板客户端证书已存在，跳过生成"
        return 0
    fi

    mkdir -p "$cert_dir"

    # 生成自签名客户端证书（用于面板与 Incus API 的 mTLS 通信）
    info "生成面板客户端证书（RSA 4096 位，有效期 10 年）..."
    openssl req -x509 -newkey rsa:4096 \
        -keyout "$key_file" \
        -out "$cert_file" \
        -days 3650 -nodes \
        -subj "/CN=incudal-panel/O=Incudal" \
        2>/dev/null

    chmod 644 "$cert_file" "$key_file"

    log "面板客户端证书生成完成"
}

# ========================== 外部 PostgreSQL 验证 ==========================
urlencode_component() {
    python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

validate_database_input() {
    [[ "$DATABASE_HOST" =~ ^[a-zA-Z0-9._:-]+$ ]] || { error "PostgreSQL 主机名或地址格式无效"; return 1; }
    [[ "$DATABASE_PORT" =~ ^[0-9]+$ ]] && (( DATABASE_PORT >= 1 && DATABASE_PORT <= 65535 )) || { error "PostgreSQL 端口必须为 1-65535"; return 1; }
    [[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$ ]] || { error "数据库名格式无效"; return 1; }
    [[ "$DATABASE_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$ ]] || { error "数据库用户名格式无效"; return 1; }
    [[ "$DATABASE_SSL_MODE" =~ ^(disable|allow|prefer|require|verify-ca|verify-full)$ ]] || { error "SSL 模式无效"; return 1; }
}

build_database_url() {
    local encoded_user encoded_password encoded_database
    encoded_user=$(urlencode_component "$DATABASE_USER")
    encoded_password=$(urlencode_component "$DATABASE_PASSWORD")
    encoded_database=$(urlencode_component "$DATABASE_NAME")
    DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@${DATABASE_HOST}:${DATABASE_PORT}/${encoded_database}?sslmode=${DATABASE_SSL_MODE}"
}

validate_external_database() {
    step "验证外部 PostgreSQL 连接..."
    validate_database_input || return 1
    build_database_url

    local client_image="postgres:16-alpine"
    info "正在验证 ${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME} 的网络、认证和数据库访问权限..."
    if ! docker run --rm --network host \
        -e "PGPASSWORD=${DATABASE_PASSWORD}" \
        "$client_image" \
        psql "host=${DATABASE_HOST} port=${DATABASE_PORT} dbname=${DATABASE_NAME} user=${DATABASE_USER} sslmode=${DATABASE_SSL_MODE} connect_timeout=8" \
        -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null 2>&1; then
        error "PostgreSQL 验证失败：请检查地址、端口、防火墙、数据库名、用户名、密码和 TLS 设置"
        DATABASE_URL=""
        return 1
    fi
    log "外部 PostgreSQL 连接、认证和数据库访问验证通过"
}

prompt_external_database() {
    if [[ -n "$(get_env_value DATABASE_URL)" ]]; then
        DATABASE_URL="$(get_env_value DATABASE_URL)"
        info "检测到已保存的外部 DATABASE_URL；正在验证其可用性"
        if docker run --rm --network host -e "DATABASE_URL=${DATABASE_URL}" postgres:16-alpine \
          sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT 1"' >/dev/null 2>&1; then
            log "已保存的外部 PostgreSQL 连接验证通过"
            return 0
        fi
        error "已保存的 DATABASE_URL 无法连接，请重新输入 PostgreSQL 信息"
    fi

    while true; do
        echo -ne "  PostgreSQL 主机/IP: " >&2; read -r DATABASE_HOST
        echo -ne "  PostgreSQL 端口 [5432]: " >&2; read -r input_port; DATABASE_PORT="${input_port:-5432}"
        echo -ne "  数据库名 [incudal]: " >&2; read -r input_name; DATABASE_NAME="${input_name:-incudal}"
        echo -ne "  数据库用户名 [incudal]: " >&2; read -r input_user; DATABASE_USER="${input_user:-incudal}"
        echo -ne "  数据库密码（不会显示）: " >&2; read -rs DATABASE_PASSWORD; echo >&2
        echo -ne "  SSL 模式 [require]: " >&2; read -r input_ssl; DATABASE_SSL_MODE="${input_ssl:-require}"
        if validate_external_database; then return 0; fi
        echo -ne "  验证失败，重新输入？[Y/n]: " >&2; read -r retry
        [[ "${retry:-y}" =~ ^[Yy]$ ]] || return 1
    done
}

# ========================== 生成 .env 文件 ==========================
generate_env() {
    step "生成环境配置..."

    if [[ -f "$ENV_FILE" ]]; then
        info ".env 文件已存在，检查并补齐缺失的密钥配置"
        ensure_env_keys
        if [[ -n "$DATABASE_URL" && -z "$(get_env_value DATABASE_URL)" ]]; then
            printf '\nDATABASE_URL=%s\n' "$DATABASE_URL" >> "$ENV_FILE"
            chmod 600 "$ENV_FILE"
        fi
        return 0
    fi

    if [[ -z "$DATABASE_URL" ]]; then
        error "未验证外部 PostgreSQL，无法生成应用配置"
        return 1
    fi
    local redis_password
    redis_password=$(gen_password 24)
    local jwt_secret
    jwt_secret=$(gen_secret 48)
    local cookie_secret
    cookie_secret=$(gen_secret 48)
    local encryption_key
    encryption_key=$(openssl rand -base64 32)
    local admin_password
    admin_password=$(gen_password 16)

    cat > "$ENV_FILE" << EOF
# ============================================================================
# Incudal Docker 部署环境配置
# 由安装脚本自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================================

# ============ 外部 PostgreSQL 配置（已在安装前验证）============
DATABASE_URL=${DATABASE_URL}

# ============ Redis 配置 ============
REDIS_PASSWORD=${redis_password}

# ============ 安全配置（请勿泄露！）============
JWT_SECRET=${jwt_secret}
COOKIE_SECRET=${cookie_secret}
ENCRYPTION_KEY=${encryption_key}

# ============ 应用配置 ============
APP_PORT=${DEFAULT_PORT}
ADMIN_PASSWORD=${admin_password}
LOG_LEVEL=info
DISABLE_REQUEST_LOG=true

# ============ 面板访问地址 ============
# 节点安装脚本、支付回调等功能依赖此地址
FRONTEND_URL=${DETECTED_FRONTEND_URL:-}
EOF

    chmod 600 "$ENV_FILE"
    log "环境配置文件生成完成: ${ENV_FILE}"
    info "管理员密码: ${admin_password}"
    info "外部 PostgreSQL 连接已验证；密码不会在日志中显示"
}

# ========================== 生成 docker-compose.yml ==========================
generate_compose() {
    step "生成 Docker Compose 配置..."

    if [[ -f "$COMPOSE_FILE" ]]; then
        info "docker-compose.yml 已存在，跳过生成"
        return 0
    fi

    cat > "$COMPOSE_FILE" << 'COMPOSEFILE'
services:
  app:
    image: ${INCUDAL_IMAGE:-ghcr.io/ashvvvvv/incudal-:stable}
    ports:
      - "127.0.0.1:${APP_PORT:-3000}:3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    environment:
      - NODE_ENV=production
      - HOST=0.0.0.0
      - PORT=3000
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - COOKIE_SECRET=${COOKIE_SECRET:-}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - FRONTEND_URL=${FRONTEND_URL:-}
      - SITE_URL=${SITE_URL:-}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - DISABLE_REQUEST_LOG=${DISABLE_REQUEST_LOG:-true}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
    volumes:
      - ./server/certs:/app/server/certs:ro
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"${REDIS_PASSWORD}\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 12
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:

networks:
  default:
    driver: bridge
    enable_ipv6: true
    ipam:
      config:
        - subnet: "172.31.0.0/16"
        - subnet: "fd42:dead:beef:10::/64"
COMPOSEFILE

    log "Docker Compose 配置生成完成: ${COMPOSE_FILE}"
}

# ========================== 拉取镜像并启动 ==========================
start_docker() {
    step "拉取镜像并启动服务..."

    cd "$INSTALL_DIR"

    info "拉取最新镜像..."
    docker compose pull 2>&1 | tail -5

    info "启动容器..."
    docker compose up -d 2>&1

    # 等待服务就绪
    info "等待服务启动..."
    local retries=0
    local max_retries=60
    local app_port
    app_port=$(get_env_value "APP_PORT")
    app_port=${app_port:-$DEFAULT_PORT}
    while [[ $retries -lt $max_retries ]]; do
        if curl -sf "http://127.0.0.1:${app_port}/api/health" &>/dev/null 2>&1; then
            log "服务启动成功！"
            return 0
        fi
        retries=$((retries + 1))
        sleep 2
    done

    warn "服务尚未就绪，请查看日志确认状态:"
    warn "  docker compose -f ${COMPOSE_FILE} logs -f app"
}

# ========================== Nginx + Certbot ==========================
setup_nginx_certbot() {
    info "准备配置 Nginx 反代及 Let's Encrypt SSL 自动证书"
    echo -ne "  ${BOLD}请输入你要绑定的域名 (例如 panel.yourdomain.com): ${NC}"
    read -r DOMAIN

    if [[ -z "$DOMAIN" ]]; then
        error "域名不能为空！"
        return 1
    fi

    echo -ne "  ${BOLD}请输入你的邮箱 (用于证书过期通知，可留空): ${NC}"
    read -r EMAIL

    info "安装 Nginx 与 Certbot..."
    apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null 2>&1

    # 更新 FRONTEND_URL
    sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" "$ENV_FILE"

    log "配置 Nginx 站点..."
    cat > /etc/nginx/sites-available/incudal.conf <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # 安全头
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location / {
        proxy_pass http://127.0.0.1:${DEFAULT_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # WebSocket 超时
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX

    # 启用站点
    ln -sf /etc/nginx/sites-available/incudal.conf /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

    # 测试并重载 Nginx
    nginx -t >/dev/null 2>&1
    systemctl restart nginx

    # 申请 SSL 证书
    info "申请 Let's Encrypt SSL 证书..."
    if [[ -n "$EMAIL" ]]; then
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
    else
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
    fi

    log "Nginx + HTTPS 配置完成"
    info "面板地址: https://${DOMAIN}"

    # 重启容器使新 FRONTEND_URL 生效
    cd "$INSTALL_DIR"
    docker compose up -d --force-recreate app 2>/dev/null || true
}

# ========================== Cloudflare Tunnel ==========================
setup_cf_tunnel() {
    local app_port
    app_port=$(get_env_value "APP_PORT")
    app_port=${app_port:-$DEFAULT_PORT}
    info "请前往 Cloudflare Zero Trust 控制台创建 Tunnel"
    info "配置 Tunnel 时，将 Public Hostname 指向 http://127.0.0.1:${app_port}"
    echo ""
    echo -ne "  ${BOLD}请输入你绑定的域名 (用于更新 FRONTEND_URL): ${NC}"
    read -r CF_DOMAIN

    if [[ -n "$CF_DOMAIN" ]]; then
        sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://${CF_DOMAIN}|" "$ENV_FILE"
        log "已更新 FRONTEND_URL 为 https://${CF_DOMAIN}"

        # 重启容器以应用新环境变量
        cd "$INSTALL_DIR"
        docker compose up -d 2>/dev/null
    fi
}

# ========================== 显示结果 ==========================
show_result() {
    # 从 .env 中提取信息
    local admin_pass
    admin_pass=$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
    local frontend_url
    frontend_url=$(grep '^FRONTEND_URL=' "$ENV_FILE" | cut -d'=' -f2-)
    local app_port
    app_port=$(grep '^APP_PORT=' "$ENV_FILE" | cut -d'=' -f2- || echo "$DEFAULT_PORT")

    echo "" >&2
    echo -e "${GREEN}" >&2
    echo "╔══════════════════════════════════════════════════╗" >&2
    echo "║                                                  ║" >&2
    echo "║          ✅  Incudal 部署完成！                  ║" >&2
    echo "║                                                  ║" >&2
    echo "╚══════════════════════════════════════════════════╝" >&2
    echo -e "${NC}" >&2
    divider
    echo -e "  ${BOLD}部署模式${NC}     Docker Compose" >&2
    echo -e "  ${BOLD}访问地址${NC}     ${frontend_url:-http://服务器IP:${app_port}}" >&2
    echo -e "  ${BOLD}管理员账号${NC}   admin" >&2
    echo -e "  ${BOLD}管理员密码${NC}   ${admin_pass}" >&2
    divider
    echo "" >&2
    echo -e "  ${YELLOW}常用运维命令:${NC}" >&2
    echo -e "  ${DIM}查看日志${NC}     docker compose -f ${COMPOSE_FILE} logs -f app" >&2
    echo -e "  ${DIM}重启服务${NC}     docker compose -f ${COMPOSE_FILE} restart" >&2
    echo -e "  ${DIM}停止服务${NC}     docker compose -f ${COMPOSE_FILE} down" >&2
    echo -e "  ${DIM}更新镜像${NC}     sudo bash $0 --upgrade" >&2
    divider
    echo "" >&2

    if [[ -z "$frontend_url" ]]; then
        warn "FRONTEND_URL 尚未配置，面板部分功能（如节点注册）将不可用"
        warn "请编辑 ${ENV_FILE} 设置 FRONTEND_URL 字段"
    fi
}

# ========================== 升级 ==========================
do_upgrade() {
    show_banner
    check_os

    if [[ ! -f "$COMPOSE_FILE" ]]; then
        error "未检测到 Docker 部署，无法升级"
        error "请先运行安装: sudo bash $0"
        exit 1
    fi

    step "升级 Incudal..."

    cd "$INSTALL_DIR"

    info "拉取最新镜像..."
    docker compose pull 2>&1 | tail -5

    info "重建容器（使用新镜像）..."
    docker compose up -d --force-recreate app 2>&1

    # 等待服务就绪
    info "等待服务启动..."
    local retries=0
    local app_port
    app_port=$(get_env_value "APP_PORT")
    app_port=${app_port:-$DEFAULT_PORT}
    while [[ $retries -lt 60 ]]; do
        if curl -sf "http://127.0.0.1:${app_port}/api/health" &>/dev/null 2>&1; then
            break
        fi
        retries=$((retries + 1))
        sleep 2
    done

    log "升级完成！"
    info "当前镜像: $(docker compose images app --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || echo 'unknown')"
}

# ========================== 卸载 ==========================
do_uninstall() {
    show_banner
    if [[ "$PURGE_DATA" == "true" ]]; then
        echo -e "  ${RED}${BOLD}⚠  警告：此操作将删除 Incudal 容器、数据库和 Redis 数据卷！${NC}" >&2
    else
        echo -e "  ${YELLOW}${BOLD}卸载将移除容器和安装目录，但默认保留数据库与 Redis 数据卷。${NC}" >&2
    fi
    echo "" >&2
    echo -ne "  ${BOLD}确认卸载？输入 'yes' 继续: ${NC}"
    read -r confirm

    if [[ "$confirm" != "yes" ]]; then
        info "已取消卸载"
        exit 0
    fi

    step "卸载 Incudal..."

    if [[ -f "$COMPOSE_FILE" ]]; then
        cd "$INSTALL_DIR"
        info "停止并移除容器..."
        if [[ "$PURGE_DATA" == "true" ]]; then
            docker compose down -v 2>/dev/null || true
        else
            docker compose down 2>/dev/null || true
        fi
    fi

    # 移除 Nginx 配置
    if [[ -f /etc/nginx/sites-enabled/incudal.conf ]]; then
        info "移除 Nginx 配置..."
        rm -f /etc/nginx/sites-enabled/incudal.conf
        rm -f /etc/nginx/sites-available/incudal.conf
        systemctl reload nginx 2>/dev/null || true
    fi

    # 删除安装目录
    if [[ -d "$INSTALL_DIR" ]]; then
        info "删除安装目录 ${INSTALL_DIR}..."
        rm -rf "$INSTALL_DIR"
    fi

    log "卸载完成"
    info "Docker Engine 未被移除，如需卸载请手动执行: apt-get remove docker-ce"
}

# ========================== 安装 ==========================
do_install() {
    show_banner
    check_os

    # 检查是否已安装
    if [[ -f "$COMPOSE_FILE" ]]; then
        warn "检测到已有安装 (${INSTALL_DIR})"
        echo -ne "  ${BOLD}覆盖安装？[y/N]: ${NC}"
        read -r overwrite
        if [[ "${overwrite,,}" != "y" ]]; then
            info "已取消安装。如需升级请使用: sudo bash $0 --upgrade"
            exit 0
        fi
    fi

    # 更新系统包
    step "更新系统包索引..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null 2>&1
    # 安装基础工具
    apt-get install -y -qq curl openssl >/dev/null 2>&1

    # 安装 Docker
    install_docker

    # 采集并验证外部 PostgreSQL；失败时不会创建证书、写配置或启动应用
    prompt_external_database

    # 创建安装目录
    mkdir -p "${INSTALL_DIR}/server/certs"

    # 生成面板客户端证书
    generate_panel_cert

    # 生成 .env
    generate_env

    # 生成 docker-compose.yml
    generate_compose

    # 登录 GHCR（私有仓库需要）
    step "配置镜像仓库访问..."
    if docker pull "${DOCKER_IMAGE}:${IMAGE_TAG:-stable}" &>/dev/null 2>&1; then
        log "镜像仓库可访问"
    else
        warn "无法拉取镜像（仓库可能是私有的）"
        info "如果仓库是私有的，请先登录:"
        info "  echo 'YOUR_GITHUB_TOKEN' | docker login ghcr.io -u USERNAME --password-stdin"
        echo ""
        echo -ne "  ${BOLD}是否已登录或仓库为公开？继续安装？[y/N]: ${NC}"
        read -r cont
        if [[ "${cont,,}" != "y" ]]; then
            info "请登录后重新运行安装脚本"
            exit 0
        fi
    fi

    # ---- 先选择网络方案，确保 FRONTEND_URL 在容器启动前就已写入 .env ----
    echo ""
    divider
    echo -e "  ${BOLD}请选择外部访问方案：${NC}" >&2
    divider
    echo -e "  ${CYAN}[1]${NC} Nginx + Certbot   ${YELLOW}（推荐：自动 HTTPS，需要公网 IP 和域名）${NC}" >&2
    echo -e "  ${CYAN}[2]${NC} Cloudflare Tunnel  ${YELLOW}（适合无公网 IP 或隐藏源站 IP）${NC}" >&2
    echo -e "  ${CYAN}[3]${NC} 仅启动服务        ${DIM}（手动配置反代，稍后输入面板地址）${NC}" >&2
    echo ""
    echo -ne "  ${BOLD}请选择 [1-3]: ${NC}"
    read -r net_opt

    # 方案 3 或无效选项：需要在启动前确定面板访问地址
    case "${net_opt:-3}" in
        1|2)
            ;; # Nginx/CF 方案会在后续步骤中自动写入 FRONTEND_URL
        *)
            # 自动探测面板公网地址，用于写入 FRONTEND_URL
            local detected_ip=""
            detected_ip=$(curl -4sf --connect-timeout 5 https://api.ipify.org 2>/dev/null || \
                          curl -4sf --connect-timeout 5 https://ifconfig.me 2>/dev/null || \
                          curl -6sf --connect-timeout 5 https://api6.ipify.org 2>/dev/null || echo "")

            echo ""
            if [[ -n "$detected_ip" ]]; then
                # 检测到公网 IP，构建默认地址
                local default_url="http://${detected_ip}:${DEFAULT_PORT}"
                info "检测到公网 IP: ${detected_ip}"
                echo -ne "  ${BOLD}请输入面板访问地址 [默认 ${default_url}]: ${NC}"
                read -r manual_url
                manual_url=${manual_url:-${default_url}}
            else
                echo -ne "  ${BOLD}请输入面板访问地址 (例如 https://panel.example.com 或 http://IP:${DEFAULT_PORT}): ${NC}"
                read -r manual_url
            fi

            if [[ -n "$manual_url" ]]; then
                # 去掉末尾斜杠
                manual_url="${manual_url%/}"
                sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=${manual_url}|" "$ENV_FILE"
                log "面板访问地址已设置: ${manual_url}"
            else
                warn "未设置面板访问地址，节点注册功能将不可用"
                warn "请后续编辑 ${ENV_FILE} 手动设置 FRONTEND_URL"
            fi
            ;;
    esac

    # 启动服务（此时 .env 中 FRONTEND_URL 已有值）
    start_docker

    # 方案 1/2 在服务启动后配置外部访问并更新 FRONTEND_URL
    case "${net_opt:-3}" in
        1) setup_nginx_certbot ;;
        2) setup_cf_tunnel ;;
    esac

    # 显示结果
    show_result
}

# ========================== 主入口 ==========================
main() {
    check_root

    case "${1:-}" in
        --upgrade|-u)
            do_upgrade
            ;;
        --uninstall|--remove)
            do_uninstall
            ;;
        --purge-data)
            PURGE_DATA="true"
            do_uninstall
            ;;
        --help|-h)
            echo "Incudal 面板部署脚本（Docker 模式）v${SCRIPT_VERSION}"
            echo ""
            echo "用法: sudo bash $0 [选项]"
            echo ""
            echo "选项:"
            echo "  (无参数)      全新安装"
            echo "  --upgrade     拉取最新镜像并重建"
            echo "  --uninstall   卸载 Incudal（默认保留数据库/Redis 数据卷）"
            echo "  --purge-data  卸载并删除数据库/Redis 数据卷（不可逆）"
            echo "  --help        显示帮助"
            ;;
        *)
            do_install
            ;;
    esac
}

main "$@"
