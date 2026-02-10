const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { format, subHours, parseISO, isAfter } = require('date-fns');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// 目标网站列表
const SOURCES = [
  { name: 'OpenAI News', url: 'https://openai.com/news/', type: 'blog', useWebFetch: true },
  { name: 'Andrej Karpathy', url: 'https://karpathy.ai', type: 'blog' },
  { name: 'Sam Altman', url: 'https://blog.samaltman.com/', type: 'blog' },
  { name: 'Greg Brockman', url: 'https://blog.gregbrockman.com/', type: 'blog' },
  { name: 'François Chollet', url: 'https://fchollet.com/', type: 'blog' },
  { name: 'Lilian Weng', url: 'https://lilianweng.github.io/', type: 'blog' },
  { name: 'Christopher Olah', url: 'https://colah.github.io/', type: 'blog' },
  { name: 'Wojciech Zaremba', url: 'https://medium.com/@woj.zaremba', type: 'medium', useWebFetch: true },
  { name: 'Mustafa Suleyman', url: 'https://mustafa-suleyman.ai/', type: 'blog' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/', type: 'blog' },
  { name: 'Dario Amodei', url: 'https://www.darioamodei.com/', type: 'blog' },
  { name: 'Karina Nguyen', url: 'https://karinanguyen.com/', type: 'blog' },
  { name: 'Peter Steinberger', url: 'https://steipete.me/', type: 'blog' },
  { name: 'Simon Willison', url: 'https://simonwillison.net/', type: 'blog' },
  { name: 'AI Hub Today', url: 'https://ai.hubtoday.app/', type: 'blog' },
  { name: 'Anthropic Research', url: 'https://www.anthropic.com/research', type: 'blog' },
  { name: 'Tencent Hunyuan', url: 'https://hy.tencent.com/research', type: 'blog' },
  { name: 'Hacker News (中文)', url: 'https://hn.buzzing.cc/', type: 'hn' }
];

// 随机延迟
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// 使用 curl 作为备用方案
async function fetchWithCurl(url) {
  try {
    const { stdout } = await execAsync(`curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`);
    return stdout;
  } catch (error) {
    throw new Error(`Curl failed: ${error.message}`);
  }
}

// 抓取单个网站
async function fetchSite(source) {
  try {
    console.log(`📡 Fetching ${source.name}...`);
    
    // 随机延迟，避免被识别为爬虫
    await randomDelay(500, 1500);
    
    let html;
    
    // 对于有反爬的网站，使用 curl
    if (source.useWebFetch) {
      html = await fetchWithCurl(source.url);
    } else {
      const response = await axios.get(source.url, {
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0'
        }
      });
      html = response.data;
    }

    const $ = cheerio.load(html);
    const articles = [];
    const now = new Date();
    const yesterday = subHours(now, 24);

    // 根据网站类型提取内容
    if (source.type === 'blog') {
      // 通用博客提取逻辑
      $('article, .post, .entry, .blog-post, [class*="post"], [class*="card"]').each((i, elem) => {
        if (i >= 10) return false; // 只取前10篇

        const $elem = $(elem);
        const title = $elem.find('h1, h2, h3, .title, [class*="title"]').first().text().trim();
        const link = $elem.find('a').first().attr('href');
        const dateText = $elem.find('time, .date, [class*="date"]').first().text().trim();
        const summary = $elem.find('p, .excerpt, .summary, [class*="description"]').first().text().trim().slice(0, 200);

        if (title && link) {
          articles.push({
            source: source.name,
            title,
            link: link.startsWith('http') ? link : new URL(link, source.url).href,
            date: dateText || 'Unknown',
            summary: summary || title,
            timestamp: new Date()
          });
        }
      });
    } else if (source.type === 'medium') {
      // Medium 特殊处理
      $('article, div[class*="streamItem"]').each((i, elem) => {
        if (i >= 10) return false;
        const $elem = $(elem);
        const title = $elem.find('h2, h3, [data-testid*="title"]').first().text().trim();
        const link = $elem.find('a[href*="/"]').first().attr('href');
        const summary = $elem.find('p, [class*="subtitle"]').first().text().trim().slice(0, 200);

        if (title && link) {
          articles.push({
            source: source.name,
            title,
            link: link.startsWith('http') ? link : `https://medium.com${link}`,
            date: 'Recent',
            summary: summary || title,
            timestamp: new Date()
          });
        }
      });
    } else if (source.type === 'hn') {
      // Hacker News 中文版
      $('.item, .athing').each((i, elem) => {
        if (i >= 20) return false;
        const $elem = $(elem);
        const title = $elem.find('.titleline a, .storylink').first().text().trim();
        const link = $elem.find('.titleline a, .storylink').first().attr('href');

        if (title && link) {
          articles.push({
            source: source.name,
            title,
            link,
            date: 'Today',
            summary: title,
            timestamp: new Date()
          });
        }
      });
    }

    console.log(`✅ ${source.name}: ${articles.length} articles found`);
    return articles;

  } catch (error) {
    console.error(`❌ ${source.name} failed:`, error.message);
    return [];
  }
}

// 抓取所有网站（分批处理，避免并发过高）
async function fetchAll() {
  console.log('🚀 Starting AI Daily Crawler...\n');
  const allArticles = [];
  
  // 分批处理，每批 5 个网站
  const batchSize = 5;
  for (let i = 0; i < SOURCES.length; i += batchSize) {
    const batch = SOURCES.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchSite));
    allArticles.push(...results.flat());
    
    // 批次间延迟
    if (i + batchSize < SOURCES.length) {
      await randomDelay(2000, 4000);
    }
  }
  
  console.log(`\n📊 Total articles collected: ${allArticles.length}`);
  return allArticles;
}

// 生成 HTML 报告
function generateHTML(articles, topPicks) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  const timeStr = format(now, 'HH:mm');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Daily - ${dateStr}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      background: #000;
      color: #f5f5f7;
      line-height: 1.6;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      padding: 40px 20px;
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      margin-bottom: 30px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    h1 {
      font-size: 2.5em;
      font-weight: 700;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      color: #86868b;
      font-size: 1.1em;
    }

    .stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .stat {
      text-align: center;
    }

    .stat-number {
      font-size: 2em;
      font-weight: 700;
      color: #667eea;
    }

    .stat-label {
      color: #86868b;
      font-size: 0.9em;
    }

    section {
      margin-bottom: 40px;
    }

    h2 {
      font-size: 1.8em;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid rgba(255, 255, 255, 0.1);
    }

    .article {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(20px);
      border-radius: 15px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;
    }

    .article:hover {
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }

    .article-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
      gap: 15px;
    }

    .article-source {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
      white-space: nowrap;
    }

    .article-date {
      color: #86868b;
      font-size: 0.9em;
    }

    .article-title {
      font-size: 1.3em;
      font-weight: 600;
      margin-bottom: 10px;
      color: #f5f5f7;
    }

    .article-title a {
      color: inherit;
      text-decoration: none;
      transition: color 0.3s ease;
    }

    .article-title a:hover {
      color: #667eea;
    }

    .article-summary {
      color: #a1a1a6;
      font-size: 0.95em;
      line-height: 1.5;
    }

    .top-pick {
      border: 2px solid #667eea;
      box-shadow: 0 0 20px rgba(102, 126, 234, 0.3);
    }

    .badge {
      display: inline-block;
      background: #667eea;
      color: #fff;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.75em;
      font-weight: 700;
      margin-left: 10px;
    }

    footer {
      text-align: center;
      padding: 30px;
      color: #86868b;
      font-size: 0.9em;
    }

    @media (max-width: 600px) {
      body {
        padding: 15px;
      }

      h1 {
        font-size: 2em;
      }

      .article-header {
        flex-direction: column;
        gap: 8px;
      }

      .stats {
        gap: 20px;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>🤖 AI Daily</h1>
    <p class="subtitle">${dateStr} ${timeStr} | 每日 AI 精选</p>
    <div class="stats">
      <div class="stat">
        <div class="stat-number">${topPicks.length}</div>
        <div class="stat-label">精选内容</div>
      </div>
      <div class="stat">
        <div class="stat-number">${articles.length}</div>
        <div class="stat-label">总文章数</div>
      </div>
      <div class="stat">
        <div class="stat-number">18</div>
        <div class="stat-label">数据源</div>
      </div>
    </div>
  </header>

  <section>
    <h2>🌟 今日精选 Top 10</h2>
    ${topPicks.map(article => `
      <div class="article top-pick">
        <div class="article-header">
          <span class="article-source">${article.source}</span>
          <span class="article-date">${article.date}</span>
        </div>
        <h3 class="article-title">
          <a href="${article.link}" target="_blank">${article.title}</a>
          <span class="badge">TOP</span>
        </h3>
        <p class="article-summary">${article.summary}</p>
      </div>
    `).join('')}
  </section>

  <section>
    <h2>📰 全部文章</h2>
    ${articles.map(article => `
      <div class="article">
        <div class="article-header">
          <span class="article-source">${article.source}</span>
          <span class="article-date">${article.date}</span>
        </div>
        <h3 class="article-title">
          <a href="${article.link}" target="_blank">${article.title}</a>
        </h3>
        <p class="article-summary">${article.summary}</p>
      </div>
    `).join('')}
  </section>

  <footer>
    <p>Generated by Jarvis 🤖 | Powered by OpenClaw</p>
    <p>数据来源：OpenAI, DeepMind, Anthropic, Karpathy, Altman 等 18 个顶级 AI 信息源</p>
  </footer>
</body>
</html>`;
}

// 主函数
async function main() {
  try {
    // 创建输出目录
    const outputDir = path.join(__dirname, 'output');
    await fs.mkdir(outputDir, { recursive: true });

    // 抓取所有文章
    const articles = await fetchAll();

    if (articles.length === 0) {
      console.log('⚠️  No articles found. Exiting...');
      return;
    }

    // 简单筛选：取前10篇（后续可以接入 AI 分析）
    const topPicks = articles.slice(0, 10);

    // 生成 HTML
    const html = generateHTML(articles, topPicks);
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const outputPath = path.join(outputDir, `ai-daily-${dateStr}.html`);
    await fs.writeFile(outputPath, html, 'utf-8');

    console.log(`\n✅ Report generated: ${outputPath}`);
    console.log(`📊 Total: ${articles.length} articles`);
    console.log(`🌟 Top picks: ${topPicks.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { fetchAll, generateHTML };
