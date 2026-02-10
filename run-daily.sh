#!/bin/bash
# AI Daily 定时任务脚本

set -e

cd /root/bigclaw/ai-daily

echo "🚀 Starting AI Daily Crawler at $(date)"

# 运行爬虫
node crawler.js

# 检查是否生成了新的日报
TODAY=$(date +%Y-%m-%d)
REPORT_FILE="output/ai-daily-${TODAY}.html"

if [ -f "$REPORT_FILE" ]; then
    echo "✅ Report generated: $REPORT_FILE"
    
    # 复制到 public 目录（Vercel 静态托管）
    mkdir -p public
    cp "$REPORT_FILE" public/index.html
    
    # 提交到 Git
    git add public/index.html
    git commit -m "Daily update: ${TODAY}" || echo "No changes to commit"
    git push origin master
    
    echo "📊 AI Daily completed and deployed successfully"
else
    echo "❌ Report generation failed"
    exit 1
fi
