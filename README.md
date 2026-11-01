<h1 align="center"><img src="./client/public/incudal_logo.webp" width="100" align="absmiddle" alt="Incudal logo"> Incudal</h1>

<p align="center">基于 Incus 的 LXC / KVM NAT VPS 销售、交付与管理面板。</p>

## 项目简介

Incudal 基于 Incus 的 NAT VPS 销售与管理面板。
项目支持 LXC / KVM 实例、套餐与镜像管理、账务计费、节点托管、用户后台、管理员后台以及宿主机 Agent。

> 演示站：https://demo.incudal.com<br/>
> <strong>仅供学习与参考，本项目存在诸多不完善之处。有任何问题建议 Fork 后使用 AI 解决。</strong><br/>

## 主要功能

- 实例交付：基于 Incus 创建和管理 LXC / KVM 实例，支持 NAT 网络、系统镜像、套餐资源和节点绑定。
- 平台运营：提供用户端与管理员后台，覆盖用户、套餐、镜像、节点、工单、公告、日志和系统配置等管理流程。
- 计费与权益：支持余额、充值、消费记录、托管收益、支付渠道、积分、VIP 等级和会员福利。
- 节点与扩展：通过宿主机 Agent 上报资源与状态，并支持托管节点、反代建站、邮箱服务等扩展能力。

### Incus 兼容性

新节点安装脚本目标版本为 Incus 7.6.0：从 Zabbly APT 源查询对应发行包，精确安装并设置 APT 版本优先级；若仓库没有目标版本，脚本会停止，不会回退安装其他版本。脚本只对新节点安装；检测到已有运行中非 7.6.0 服务或未运行的旧 Incus 软件包时会拒绝自动替换，避免破坏现有实例。

面板和 Agent 按 Incus 7.6.0 的 `/1.0` API 进行兼容性适配。连接宿主机时会读取 `api_version`、`server_version` 和 API 扩展，并在宿主机状态页显示版本提示；这不是实机兼容性认证，也不会升级既有宿主机或 Linux 内核。升级既有节点前请在测试节点验证实例创建、启动/停止、快照、备份导出/恢复、VM 网络、NAT/IPv6 路由和流量计数，再制定单独的维护与回滚方案。可运行 `pnpm --filter server test:incus-compatibility` 检查版本判断逻辑。

安装脚本的非交互模式必须显式提供有效的 `--mode` 和 Token；端口必须为 `1..65535`，IPv6 子网和接口名会校验。安装完成后脚本写入 `/etc/incudal/installer-owned` 归属标记，其中包含稳定的 `ownership=incudal` 哨兵和目标 Incus 版本。`--uninstall` 仅允许从交互终端运行，并要求归属标记、先输入 `BACKUP` 确认已备份，再完成两次卸载确认；缺少有效标记时脚本会拒绝删除，避免误操作非 Incudal 节点。归属检查不绑定脚本补丁版本，因此更新后的安装脚本仍可卸载既有 Incudal 节点。安装命令使用 HTTPS、TLS 1.2 和失败即止的 curl 参数。可运行 `pnpm --filter server test:installer-safety` 执行不依赖 shell 的静态安全检查。

## 目录结构

```text
client/                 Vue 3 + Vite 前端
server/                 Fastify + Prisma 后端
agent/                  Go 宿主机 Agent
server/prisma/          数据库 schema 与 migrations
server/templates/       安装脚本、邮件等模板
.github/workflows/      CI、Docker、Agent Release 工作流
scripts/                本地开发和检查脚本
```

## 搭建教程

本文档使用你的 GitHub 仓库 `Furina-Lee/incudal-panel` 作为示例；如果部署自己的 Fork，请同步替换 GitHub 地址、Agent Release 仓库和 GHCR 镜像名。

本项目使用 PostgreSQL 作为数据库。

当前无论使用哪种部署方式，都需要在 `server/certs` 目录下生成或放置证书与密钥，并确保 Docker 容器具有读取权限。

### 方式一：Docker Compose 开发环境

适合本地试跑和开发预览。该方式会自动启动 Node、PostgreSQL 和 Redis，并自动安装依赖、执行数据库迁移。

```bash
git clone https://github.com/Furina-Lee/incudal-panel.git
cd incudal-panel
docker compose -f docker-compose.dev.yml up
```

启动后访问：

```text
前端：http://127.0.0.1:43173
后端：http://127.0.0.1:8888
```

停止服务：

```bash
docker compose -f docker-compose.dev.yml down
```

如需同时删除本地开发数据库卷：

```bash
docker compose -f docker-compose.dev.yml down -v
```

### 方式二：生产 Docker Compose 一键部署

这是新安装推荐方式。Compose 只启动 Incudal 和 Redis 7；PostgreSQL 必须由用户提前准备在外部主机、云数据库或独立数据库服务中。安装器会先使用临时 PostgreSQL 客户端容器验证网络、认证和目标数据库访问，验证失败不会生成最终配置或启动应用。首次应用启动时才会在已验证的数据库上执行 `prisma migrate deploy` 创建新结构，不执行 `RESET_DATABASE`，也不导入或覆盖已有数据。

```bash
git clone https://github.com/Furina-Lee/incudal-panel.git
cd incudal-panel
sudo bash scripts/install-docker.sh
```

安装前需先在 GitHub 仓库的 **Actions → Docker Build & Push → Run workflow** 中手动运行一次，并将镜像标签设为 `stable`；工作流成功后，安装器会拉取 `ghcr.io/furina-lee/incudal-panel:stable`。安装器会创建 `/opt/incudal/.env`，生成应用密钥和 Redis 密码；外部 PostgreSQL 密码会写入经过 URL 编码的连接串。也可以直接从源码部署：

```bash
cp .env.example .env
# 编辑 .env，至少设置强密码、FRONTEND_URL 和 Redis 密码
docker compose up -d --build

docker compose ps
docker compose logs -f app
```

默认面板只绑定到 `127.0.0.1:3000`，建议通过 Nginx、Caddy 或 Cloudflare Tunnel 提供 HTTPS。需要直接监听公网时，设置 `APP_BIND_ADDRESS=0.0.0.0`，并自行配置防火墙。

检查健康状态：

```bash
curl http://127.0.0.1:3000/api/health
```

升级应用：

```bash
docker compose up -d --build app
```

普通停止/卸载不会删除数据库卷：

```bash
docker compose down
sudo bash scripts/install-docker.sh --uninstall
# 如确认永久删除数据：sudo bash scripts/install-docker.sh --purge-data
docker volume ls
```

外部 PostgreSQL 的备份由你的数据库服务负责；建议在首次安装、升级或执行 migrations 前使用数据库平台备份，或从 PostgreSQL 客户端执行：

```bash
pg_dump "$(grep '^DATABASE_URL=' /opt/incudal/.env | cut -d= -f2-)" > incudal-$(date +%Y%m%d-%H%M%S).sql
```

不要把数据库密码打印到终端或提交到仓库。Redis 数据由 Compose volume 管理，可按需清理或重建。`server/certs` 是 Incus API mTLS 客户端证书目录，不是浏览器 HTTPS 证书目录；挂载前请准备好对应证书并限制权限。

Agent 正式二进制不存放在面板仓库内，面板运行时会从 GitHub Release 查询和代理下载。如部署在私有仓库或 fork，可按需配置：

```env
INCUDAL_AGENT_RELEASE_REPOSITORY=Furina-Lee/incudal-panel
INCUDAL_AGENT_RELEASE_TOKEN=github_pat_xxx
```

## 开发教程

### 本地依赖

- Node.js 20 或更高版本
- pnpm 9.14.2
- PostgreSQL
- Redis
- Go 1.22 或更高版本，仅开发 Agent 时需要

启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install
```

配置本地环境变量后执行数据库迁移：

```bash
pnpm --filter server exec prisma migrate deploy
```

启动前后端开发服务：

```bash
pnpm dev
```

默认开发端口：

```text
client: http://127.0.0.1:5173
server: http://127.0.0.1:8888
```

### 常用命令

```bash
pnpm --filter client type-check
pnpm --filter server type-check
pnpm build
pnpm lint
```

本地检查：

```shell
# Windows
.\scripts\local-ci.ps1
# macOS
.\scripts\local-ci-macos.sh
```

### 数据库开发

Prisma schema 位于 `server/prisma/schema.prisma`，迁移文件位于 `server/prisma/migrations/`。修改数据库结构后，应生成迁移并确认前后端类型检查通过。

常用命令：

```bash
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate dev
pnpm --filter server exec prisma migrate deploy
```

### Agent 开发与发布

Agent 位于 `agent/`，版本号统一由 `agent/VERSION` 控制。

本地测试：

```bash
cd agent
go test ./...
go run ./cmd/incudal-agent -config ./config.example.yaml -once
```

本地构建双架构产物：

```bash
bash agent/scripts/build-release.sh
```

`agent/dist` 只是本地临时构建目录，不提交到 Git。正式发布由 GitHub Actions `Agent Build & Release` 完成：当 `agent/VERSION` 变动并推送后，会发布 GitHub Release，并生成：

```text
incudal-agent-x86_64-v0.0.1
incudal-agent-aarch64-v0.0.1
```

## 开发约定

- 前端新增文案需要同步维护 `client/src/locales/` 下的多语言键。
- 后端新增管理接口应使用登录鉴权和管理员鉴权，并补充必要的字段校验和速率限制。
- 数据库变更需要提交 Prisma migration，不直接修改生产库结构。
- 不提交构建产物、临时文件、密钥、数据库 dump 或本地 `.env`。
