#!/bin/bash
# AI Daily 定时任务脚本

cd /root/bigclaw/ai-daily

echo "🚀 Starting AI Daily Crawler at $(date)"

# 运行爬虫
node crawler.js

# 检查是否生成了新的日报
TODAY=$(date +%Y-%m-%d)
REPORT_FILE="output/ai-daily-${TODAY}.html"

if [ -f "$REPORT_FILE" ]; then
    echo "✅ Report generated: $REPORT_FILE"
    
    # 复制到 Vercel 部署目录（如果需要静态托管）
    # cp "$REPORT_FILE" public/latest.html
    
    echo "📊 AI Daily completed successfully"
else
    echo "❌ Report generation failed"
    exit 1
fi
