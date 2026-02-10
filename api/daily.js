const axios = require('axios');
const cheerio = require('cheerio');
const { format } = require('date-fns');

// 目标网站列表
const SOURCES = [
  { name: 'OpenAI News', url: 'https://openai.com/news/', type: 'blog' },
  { name: 'Andrej Karpathy', url: 'https://karpathy.ai', type: 'blog' },
  { name: 'Sam Altman', url: 'https://blog.samaltman.com/', type: 'blog' },
  { name: 'Greg Brockman', url: 'https://blog.gregbrockman.com/', type: 'blog' },
  { name: 'François Chollet', url: 'https://fchollet.com/', type: 'blog' },
  { name: 'Lilian Weng', url: 'https://lilianweng.github.io/', type: 'blog' },
  { name: 'Christopher Olah', url: 'https://colah.github.io/', type: 'blog' },
  { name: 'Wojciech Zaremba', url: 'https://medium.com/@woj.zaremba', type: 'medium' },
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
function randomDelay(min = 500, max = 1500) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// 抓取单个网站
async function fetchSite(source) {
  try {
    await randomDelay();
    
    const response = await axios.get(source.url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const $ = cheerio.load(response.data);
    const articles = [];

    if (source.type === 'blog') {
      $('article, .post, .entry, .blog-post, [class*="post"], [class*="card"]').each((i, elem) => {
        if (i >= 10) return false;
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
            date: dateText || 'Recent',
            summary: summary || title
          });
        }
      });
    } else if (source.type === 'medium') {
      $('article, div[class*="streamItem"]').each((i, elem) => {
        if (i >= 10) return false;
        const $elem = $(elem);
        const title = $elem.find('h2, h3').first().text().trim();
        const link = $elem.find('a').first().attr('href');
        const summary = $elem.find('p').first().text().trim().slice(0, 200);

        if (title && link) {
          articles.push({
            source: source.name,
            title,
            link: link.startsWith('http') ? link : `https://medium.com${link}`,
            date: 'Recent',
            summary: summary || title
          });
        }
      });
    } else if (source.type === 'hn') {
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

    return articles;
  } catch (error) {
    console.error(`${source.name} failed:`, error.message);
    return [];
  }
}

// 生成 HTML
function generateHTML(articles) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  const timeStr = format(now, 'HH:mm');

  // 简单筛选：取前10条有内容的
  const topPicks = articles.filter(a => a.title && a.link).slice(0, 10);

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
    }
    .article-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .source {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .date { color: #86868b; font-size: 0.9em; }
    .article-title {
      font-size: 1.3em;
      font-weight: 600;
      margin-bottom: 12px;
      color: #f5f5f7;
    }
    .article-title a {
      color: inherit;
      text-decoration: none;
      transition: color 0.3s;
    }
    .article-title a:hover { color: #667eea; }
    .article-summary {
      color: #a1a1a6;
      font-size: 0.95em;
      line-height: 1.6;
    }
    footer {
      text-align: center;
      padding: 40px 20px;
      color: #86868b;
      font-size: 0.9em;
    }
    @media (max-width: 600px) {
      h1 { font-size: 2em; }
      .article { padding: 20px; }
      .article-header { flex-direction: column; align-items: flex-start; gap: 8px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>🤖 AI Daily</h1>
    <p class="subtitle">${dateStr} ${timeStr} | Top ${topPicks.length} AI Updates</p>
  </header>

  <main>
    ${topPicks.map((article, index) => `
      <div class="article">
        <div class="article-header">
          <span class="source">${article.source}</span>
          <span class="date">${article.date}</span>
        </div>
        <h2 class="article-title">
          <a href="${article.link}" target="_blank" rel="noopener">${index + 1}. ${article.title}</a>
        </h2>
        <p class="article-summary">${article.summary}</p>
      </div>
    `).join('')}
  </main>

  <footer>
    <p>Generated by Jarvis 🤖 | ${articles.length} sources scanned</p>
  </footer>
</body>
</html>`;
}

// Vercel Serverless Function
module.exports = async (req, res) => {
  try {
    console.log('Starting AI Daily crawler...');
    
    // 分批抓取
    const allArticles = [];
    const batchSize = 5;
    
    for (let i = 0; i < SOURCES.length; i += batchSize) {
      const batch = SOURCES.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchSite));
      allArticles.push(...results.flat());
      
      if (i + batchSize < SOURCES.length) {
        await randomDelay(1000, 2000);
      }
    }
    
    console.log(`Collected ${allArticles.length} articles`);
    
    const html = generateHTML(allArticles);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).send(html);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
