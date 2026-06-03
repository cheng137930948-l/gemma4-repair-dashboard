#!/usr/bin/env bash
# 一键启动（无需 Docker）：本地 venv 起【后端 :8001】+【前端静态 :8123】。
# 首次运行会自动建 venv、装依赖、生成 backend/.env。
# 用法：  ./start.sh      （Ctrl-C 同时停止前后端）

set -euo pipefail
cd "$(dirname "$0")"

PY="$(command -v python3 || command -v python || true)"
[ -z "$PY" ] && { echo "✗ 未找到 python3/python，请先安装 Python 3.10+"; exit 1; }

# ---------- 后端：venv + 依赖 + .env ----------
cd backend
if [ ! -d .venv ]; then echo "· 创建虚拟环境 .venv …"; "$PY" -m venv .venv; fi
echo "· 安装后端依赖 …"; .venv/bin/pip install -q --upgrade pip; .venv/bin/pip install -q -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠ 已生成 backend/.env —— 请填入你的 GOOGLE_API_KEY 后再次运行本脚本。"
  echo "  （在 https://aistudio.google.com/apikey 免费申请）"
  exit 1
fi
echo "· 启动后端  http://127.0.0.1:8001 …"
.venv/bin/python report_server.py &
BACKEND_PID=$!
cd ..

# ---------- 前端：静态服务 ----------
echo "· 启动前端  http://127.0.0.1:8123/index.html …"
"$PY" -m http.server 8123 >/dev/null 2>&1 &
FRONTEND_PID=$!

cleanup() { kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo ""
echo "✅ 启动完成："
echo "   前端  http://127.0.0.1:8123/index.html"
echo "   后端  http://127.0.0.1:8001/api/health"
echo "   在「AI 智能分析中心」点「开始分析」即走真实 Gemma 4 原生函数调用循环。"
echo "   按 Ctrl-C 停止。"
wait
