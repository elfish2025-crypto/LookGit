#!/bin/bash
# LookGit 一键启动。
#
# 在 Finder 里双击这个文件即可——会自动打开 Terminal、装依赖（首次运行）、
# 构建前端、起服务、等服务真正就绪后自动打开浏览器。关掉这个窗口或按
# Ctrl+C 会停止服务，不会留下孤儿进程。

set -e
cd "$(dirname "$0")"

# This script belongs beside package.json, not as a standalone copied launcher.
if [ ! -f package.json ] || [ ! -f package-lock.json ] || [ ! -f server/index.ts ]; then
  echo "没有找到完整的 LookGit 项目：$(pwd)"
  echo "请在项目文件夹中运行 start-lookgit.command。"
  echo "如需桌面入口，请创建该文件的替身，不要单独复制脚本。"
  if [ -t 0 ]; then read -r -p "按回车关闭…"; fi
  exit 1
fi

PORT="${PORT:-5179}"
URL="http://localhost:$PORT"
export PORT
for tool in node npm git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "缺少 $tool。请先安装 Node.js 22.11+（含 npm）和 Git。"
    read -r -p "按回车关闭…"
    exit 1
  fi
done

echo "LookGit"
echo "项目目录：$(pwd)"
echo ""

# 已经在跑就不重新起一个，直接开浏览器。
if curl -fsS -o /dev/null "$URL/api/health" 2>/dev/null; then
  echo "服务已经在跑，直接打开浏览器。"
  open "$URL"
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖（可能需要一两分钟）…"
  npm ci
fi

echo "构建前端…"
npm run build

echo "启动服务…"
npm start &
SERVER_PID=$!

trap 'kill $SERVER_PID 2>/dev/null' EXIT

echo "等待服务就绪…"
ready=false
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "$URL/api/health" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 0.5
done

if [ "$ready" = false ]; then
  echo ""
  echo "服务在 30 秒内没能就绪——可能是端口被占用或启动出错，看看上面的日志。"
  exit 1
fi

open "$URL"

echo ""
echo "============================================"
echo " LookGit 正在运行：$URL"
echo " 关闭这个窗口、或在这里按 Ctrl+C，会停止服务。"
echo "============================================"
echo ""

wait $SERVER_PID
