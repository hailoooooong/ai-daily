const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { format, subHours, parseISO, isAfter, parse, isValid } = require('date-fns');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Claude API 配置（使用 OpenClaw 的代理）
const CLAUDE_API_URL = 'https://www.fucheers.top/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

// 从环境变量或配置文件读取 API Key
async function getApiKey() {
  try {
    // 尝试从 OpenClaw 配置读取
    const configPath = '/root/.openclaw/openclaw.json';
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    
    // 从环境变量读取（如果有）
    if (process.env.ANTHROPIC_API_KEY) {
      return process.env.ANTHROPIC_API_KEY;
    }
    
    // 提示用户配置
    console.warn('⚠️  API Key not found. Please set ANTHROPIC_API_KEY environment variable.');
    return null;
  } catch (error) {
    return process.env.ANTHROPIC_API_KEY || null;
  }
}

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

// 解析日期字符串
function parseArticleDate(dateText) {
  if (!dateText) return null;
  
  try {
    // 尝试 ISO 格式
    const isoDate = parseISO(dateText);
    if (isValid(isoDate)) return isoDate;
    
    // 尝试常见格式
    const formats = [
      'yyyy-MM-dd',
      'MMM dd, yyyy',
      'MMMM dd, yyyy',
      'dd MMM yyyy',
      'yyyy/MM/dd'
    ];
    
    for (const fmt of formats) {
      try {
        const parsed = parse(dateText, fmt, new Date());
        if (isValid(parsed)) return parsed;
      } catch (e) {
        continue;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// 检查文章是否在 24 小时内
function isWithin24Hours(dateText) {
  const articleDate = parseArticleDate(dateText);
  if (!articleDate) return true; // 无法解析日期时保留
  
  const now = new Date();
  const yesterday = subHours(now, 24);
  return isAfter(articleDate, yesterday);
}

// 抓取单个网站
async function fetchSite(source) {
  try {
    console.log(`📡 Fetching ${source.name}...`);
    
    await randomDelay(500, 1500);
    
    let html;
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

    if (source.type === 'blog') {
      $('article, .post, .entry, .blog-post, [class*="post"], [class*="card"]').each((i, elem) => {
        if (i >= 10) return false;

        const $elem = $(elem);
        const title = $elem.find('h1, h2, h3, .title, [class*="title"]').first().text().trim();
        const link = $elem.find('a').first().attr('href');
        const dateText = $elem.find('time, .date, [class*="date"]').first().attr('datetime') || 
                        $elem.find('time, .date, [class*="date"]').first().text().trim();
        const summary = $elem.find('p, .excerpt, .summary, [class*="description"]').first().text().trim().slice(0, 300);

        // 严格过滤 24 小时内的文章
        if (title && link && isWithin24Hours(dateText)) {
          articles.push({
            source: source.name,
            title,
            link: link.startsWith('http') ? link : new URL(link, source.url).href,
            date: dateText || 'Recent',
            summary: summary || title
          });
        }
      });
    } else if (source.type === 'medium') {
      $('article, div[class*="streamItem"]').each((i, elem) => {
        if (i >= 10) return false;
        const $elem = $(elem);
        const title = $elem.find('h2, h3, [data-testid*="title"]').first().text().trim();
        const link = $elem.find('a[href*="/"]').first().attr('href');
        const dateText = $elem.find('time').first().attr('datetime') || $elem.find('time').first().text().trim();
        const summary = $elem.find('p, [class*="subtitle"]').first().text().trim().slice(0, 300);

        if (title && link && isWithin24Hours(dateText)) {
          articles.push({
            source: source.name,
            title,
            link: link.startsWith('http') ? link : `https://medium.com${link}`,
            date: dateText || 'Recent',
            summary: summary || title
          });
        }
      });
    } else if (source.type === 'hn') {
      // HN 默认显示最新内容，保留前 20 条
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
            summary: title
          });
        }
      });
    }

    console.log(`✅ ${source.name}: ${articles.length} articles (24h filtered)`);
    return articles;

  } catch (error) {
    console.error(`❌ ${source.name} failed:`, error.message);
    return [];
  }
}

// 抓取所有网站（分批处理）
async function fetchAll() {
  console.log('🚀 Starting AI Daily Crawler...\n');
  const allArticles = [];
  
  const batchSize = 5;
  for (let i = 0; i < SOURCES.length; i += batchSize) {
    const batch = SOURCES.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchSite));
    allArticles.push(...results.flat());
    
    if (i + batchSize < SOURCES.length) {
      await randomDelay(2000, 4000);
    }
  }
  
  console.log(`\n📊 Total articles collected: ${allArticles.length}`);
  return allArticles;
}

// 去重
function deduplicateArticles(articles) {
  const unique = [];
  const seen = new Set();
  
  for (const article of articles) {
    const normalized = article.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
    
    let isDuplicate = false;
    for (const seenTitle of seen) {
      const words1 = normalized.split(/\s+/);
      const words2 = seenTitle.split(/\s+/);
      const common = words1.filter(w => words2.includes(w)).length;
      const similarity = common / Math.max(words1.length, words2.length);
      
      if (similarity > 0.7) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.add(normalized);
      unique.push(article);
    }
  }
  
  return unique;
}

// 使用 Claude API 翻译
async function translateWithClaude(text, apiKey) {
  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `请将以下英文翻译成简洁的中文，保持专业术语准确性：\n\n${text}`
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: 30000
      }
    );
    
    return response.data.content[0].text.trim();
  } catch (error) {
    console.error('Translation failed:', error.message);
    return text; // 翻译失败时返回原文
  }
}

// 批量翻译文章
async function translateArticles(articles) {
  console.log('\n🌐 Translating articles...');
  
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn('⚠️  Skipping translation (no API key)');
    return articles.map(a => ({ ...a, summaryZh: a.summary }));
  }
  
  const translated = [];
  
  for (const article of articles) {
    console.log(`  Translating: ${article.title.slice(0, 50)}...`);
    const zhSummary = await translateWithClaude(article.summary, apiKey);
    translated.push({
      ...article,
      summaryZh: zhSummary
    });
    await randomDelay(1000, 2000); // API 限流保护
  }
  
  console.log('✅ Translation completed\n');
  return translated;
}

// 生成 HTML
function generateHTML(articles) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  const timeStr = format(now, 'HH:mm');

  const articlesHTML = articles.map((article, index) => `
    <div class="article">
      <div class="article-header">
        <div class="article-number">#${index + 1}</div>
        <div class="source-badge">${article.source}</div>
      </div>
      <h2 class="article-title">
        <a href="${article.link}" target="_blank" rel="noopener">${article.title}</a>
      </h2>
      <div class="article-meta">${article.date}</div>
      <div class="article-summary">
        <p>${article.summary}</p>
      </div>
      <a href="${article.link}" class="read-more" target="_blank" rel="noopener">阅读原文 →</a>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Daily - ${dateStr}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
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
    .subtitle { color: #86868b; font-size: 1.1em; }
    .article {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;
    }
    .article:hover {
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .article-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .article-number {
      font-size: 1.5em;
      font-weight: 700;
      color: #667eea;
    }
    .source-badge {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: 600;
    }
    .article-title {
      font-size: 1.3em;
      font-weight: 600;
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .article-title a {
      color: #f5f5f7;
      text-decoration: none;
      transition: color 0.2s;
    }
    .article-title a:hover { color: #667eea; }
    .article-meta {
      color: #86868b;
      font-size: 0.9em;
      margin-bottom: 12px;
    }
    .article-summary {
      margin-bottom: 12px;
    }
    .summary-en {
      color: #a1a1a6;
      font-style: italic;
      margin-bottom: 8px;
      line-height: 1.6;
    }
    .summary-zh {
      color: #f5f5f7;
      line-height: 1.6;
    }
    .read-more {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      transition: all 0.2s;
    }
    .read-more:hover {
      color: #764ba2;
      transform: translateX(4px);
    }
    footer {
      text-align: center;
      padding: 40px 20px;
      color: #86868b;
      font-size: 0.9em;
    }
    @media (max-width: 600px) {
      h1 { font-size: 2em; }
      .article { padding: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>🤖 AI Daily</h1>
    <p class="subtitle">${dateStr} ${timeStr} | ${articles.length} 条精选资讯</p>
  </header>

  <main>
    ${articlesHTML}
  </main>

  <footer>
    <p>Generated by Jarvis 🤖 | Powered by Claude Sonnet 4.5</p>
    <p style="margin-top: 8px; font-size: 0.85em;">数据源：OpenAI, DeepMind, Anthropic, Karpathy 等 18 个顶级 AI 网站</p>
  </footer>
</body>
</html>`;
}

// 主函数
async function main() {
  try {
    // 1. 抓取文章
    const allArticles = await fetchAll();
    
    // 2. 去重
    const uniqueArticles = deduplicateArticles(allArticles);
    console.log(`📊 After deduplication: ${uniqueArticles.length} articles`);
    
    // 3. 取前 10 条（不强制凑数）
    const topPicks = uniqueArticles.slice(0, Math.min(10, uniqueArticles.length));
    console.log(`🌟 Top picks: ${topPicks.length} articles`);
    
    // 4. 生成 HTML（暂时不翻译）
    const articlesWithPlaceholder = topPicks.map(a => ({
      ...a,
      summaryZh: a.summary // 暂时使用英文原文
    }));
    
    const html = generateHTML(articlesWithPlaceholder);
    
    // 6. 保存文件
    const outputDir = path.join(__dirname, 'output');
    await fs.mkdir(outputDir, { recursive: true });
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const outputFile = path.join(outputDir, `ai-daily-${today}.html`);
    await fs.writeFile(outputFile, html, 'utf-8');
    
    console.log(`\n✅ Report generated: ${outputFile}`);
    console.log(`📊 Total: ${allArticles.length} articles`);
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

module.exports = { main, fetchAll, translateArticles, generateHTML };
