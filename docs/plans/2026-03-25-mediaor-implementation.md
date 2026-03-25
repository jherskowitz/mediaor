# Mediaor News Aggregation Site — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a static news aggregation site at mediaor.com that fetches RSS feeds from a Feedly OPML export, auto-categorizes articles, and deploys to GitHub Pages.

**Architecture:** Astro static site. At build time, a Node.js script parses the OPML file to extract feed URLs (Mediaor folder only), fetches each RSS feed, classifies articles by keyword matching, and generates static HTML pages. GitHub Actions rebuilds every 30 minutes.

**Tech Stack:** Astro 5, rss-parser, fast-xml-parser (for OPML), GitHub Actions, GitHub Pages

---

### Task 1: Scaffold Astro Project

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `src/pages/index.astro` (placeholder)

**Step 1: Initialize Astro project**

Run from `/Users/jherskowitz/Development/mediaor`:
```bash
npm create astro@latest . -- --template minimal --no-install --typescript strict
```

**Step 2: Configure Astro for GitHub Pages**

Edit `astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mediaor.com',
  output: 'static',
});
```

**Step 3: Install dependencies**

```bash
npm install
npm install rss-parser fast-xml-parser
```

**Step 4: Add .gitignore entries**

Ensure `node_modules/` and `dist/` are in `.gitignore`.

**Step 5: Verify it builds**

```bash
npm run build
```
Expected: Build succeeds, `dist/` directory created.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Astro project with dependencies"
```

---

### Task 2: OPML Parser — Extract Mediaor Feed URLs

**Files:**
- Create: `src/lib/opml.ts`
- Create: `src/lib/opml.test.ts`
- Rename: `feedly-opml-2bcb6838-7884-46c7-bac4-d0df17f04230-2026-03-25.opml` → `feeds.opml`

**Step 1: Rename the OPML file**

```bash
mv "feedly-opml-2bcb6838-7884-46c7-bac4-d0df17f04230-2026-03-25.opml" feeds.opml
```

**Step 2: Write the OPML parser**

Create `src/lib/opml.ts`:
```ts
import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface FeedSource {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
}

export function parseOpml(opmlPath: string, folderName: string): FeedSource[] {
  const xml = readFileSync(resolve(opmlPath), 'utf-8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);

  const body = parsed.opml.body;
  const folders = Array.isArray(body.outline) ? body.outline : [body.outline];

  const folder = folders.find(
    (f: any) => f['@_text'] === folderName || f['@_title'] === folderName
  );

  if (!folder) {
    throw new Error(`Folder "${folderName}" not found in OPML`);
  }

  const outlines = Array.isArray(folder.outline) ? folder.outline : [folder.outline];

  return outlines
    .filter((o: any) => o['@_type'] === 'rss' && o['@_xmlUrl'])
    .map((o: any) => ({
      title: o['@_text'] || o['@_title'] || 'Unknown',
      xmlUrl: o['@_xmlUrl'],
      htmlUrl: o['@_htmlUrl'] || undefined,
    }));
}
```

**Step 3: Verify parser works**

```bash
npx tsx -e "
import { parseOpml } from './src/lib/opml.ts';
const feeds = parseOpml('./feeds.opml', 'Mediaor');
console.log('Found', feeds.length, 'feeds');
console.log('First 3:', feeds.slice(0, 3).map(f => f.title));
"
```
Expected: `Found 198 feeds` and first 3 feed titles printed.

**Step 4: Commit**

```bash
git add feeds.opml src/lib/opml.ts
git commit -m "feat: add OPML parser for Mediaor folder feeds"
```

---

### Task 3: RSS Fetcher — Fetch Articles from All Feeds

**Files:**
- Create: `src/lib/feeds.ts`

**Step 1: Write the feed fetcher**

Create `src/lib/feeds.ts`:
```ts
import Parser from 'rss-parser';

export interface Article {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  source: string;
  sourceUrl?: string;
  image?: string;
}

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mediaor/1.0 (news aggregator)',
  },
});

const SEVENTY_TWO_HOURS = 72 * 60 * 60 * 1000;

export async function fetchFeed(xmlUrl: string, sourceTitle: string, sourceHtmlUrl?: string): Promise<Article[]> {
  try {
    const feed = await parser.parseURL(xmlUrl);
    const now = Date.now();

    return (feed.items || [])
      .slice(0, 20)
      .map((item) => {
        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
        return {
          title: item.title || 'Untitled',
          link: item.link || '',
          description: stripHtml(item.contentSnippet || item.content || '').slice(0, 300),
          pubDate,
          source: sourceTitle,
          sourceUrl: sourceHtmlUrl,
          image: extractImage(item),
        };
      })
      .filter((a) => a.link && now - a.pubDate.getTime() < SEVENTY_TWO_HOURS);
  } catch (err) {
    console.warn(`Failed to fetch ${sourceTitle} (${xmlUrl}): ${(err as Error).message}`);
    return [];
  }
}

export async function fetchAllFeeds(
  feeds: { title: string; xmlUrl: string; htmlUrl?: string }[]
): Promise<Article[]> {
  const results = await Promise.allSettled(
    feeds.map((f) => fetchFeed(f.xmlUrl, f.title, f.htmlUrl))
  );

  const articles: Article[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const article of result.value) {
        if (!seenUrls.has(article.link)) {
          seenUrls.add(article.link);
          articles.push(article);
        }
      }
    }
  }

  articles.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return articles;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function extractImage(item: any): string | undefined {
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image')) {
    return item.enclosure.url;
  }
  const imgMatch = (item.content || item['content:encoded'] || '').match(/<img[^>]+src="([^"]+)"/);
  return imgMatch?.[1] || undefined;
}
```

**Step 2: Test the fetcher with a few live feeds**

```bash
npx tsx -e "
import { parseOpml } from './src/lib/opml.ts';
import { fetchAllFeeds } from './src/lib/feeds.ts';
const feeds = parseOpml('./feeds.opml', 'Mediaor');
console.log('Fetching from', feeds.length, 'feeds...');
const articles = await fetchAllFeeds(feeds.slice(0, 10));
console.log('Got', articles.length, 'articles from first 10 feeds');
articles.slice(0, 3).forEach(a => console.log('-', a.source, ':', a.title));
"
```
Expected: Some articles fetched, broken feeds logged as warnings.

**Step 3: Commit**

```bash
git add src/lib/feeds.ts
git commit -m "feat: add RSS feed fetcher with dedup and 72h filter"
```

---

### Task 4: Article Categorizer

**Files:**
- Create: `src/lib/categories.ts`
- Create: `src/lib/categories.json`

**Step 1: Create category config**

Create `src/lib/categories.json`:
```json
{
  "categories": [
    {
      "name": "Music Tech",
      "slug": "music-tech",
      "keywords": ["music tech", "audio tech", "DAW", "plugin", "synth", "synthesizer", "MIDI", "audio software", "music software", "music app", "soundboard", "audio engineering", "music production", "beat making", "sampling"]
    },
    {
      "name": "Music",
      "slug": "music",
      "keywords": ["music", "album", "song", "artist", "tour", "concert", "vinyl", "playlist", "label", "record label", "streaming", "Spotify", "Grammy", "rapper", "singer", "band", "musician", "lyric", "remix", "DJ", "festival", "hip-hop", "rock", "pop music", "jazz", "R&B", "country music", "punk"]
    },
    {
      "name": "Tech",
      "slug": "tech",
      "keywords": ["AI", "artificial intelligence", "software", "startup", "app", "data", "cloud", "chip", "robot", "gadget", "developer", "coding", "blockchain", "crypto", "API", "machine learning", "algorithm", "open source", "SaaS", "platform"]
    },
    {
      "name": "Industry",
      "slug": "industry",
      "keywords": ["market", "deal", "merger", "revenue", "CEO", "funding", "IPO", "earnings", "layoff", "acquisition", "valuation", "investor", "stock", "quarterly", "profit", "lawsuit", "regulation", "copyright", "licensing", "royalt"]
    }
  ]
}
```

**Step 2: Create categorizer**

Create `src/lib/categories.ts`:
```ts
import categoryData from './categories.json';

export interface Category {
  name: string;
  slug: string;
  keywords: string[];
}

export interface CategorizedArticle {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  source: string;
  sourceUrl?: string;
  image?: string;
  category: string;
  categorySlug: string;
}

const categories: Category[] = categoryData.categories;

export function categorizeArticle(title: string, description: string): { name: string; slug: string } {
  const text = `${title} ${description}`.toLowerCase();

  for (const cat of categories) {
    for (const keyword of cat.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return { name: cat.name, slug: cat.slug };
      }
    }
  }

  return { name: 'General', slug: 'general' };
}

export function categorizeArticles(articles: import('./feeds').Article[]): CategorizedArticle[] {
  return articles.map((a) => {
    const { name, slug } = categorizeArticle(a.title, a.description);
    return { ...a, category: name, categorySlug: slug };
  });
}

export function getCategories(): Category[] {
  return categories;
}

export function getAllCategorySlugs(): string[] {
  return [...categories.map((c) => c.slug), 'general'];
}
```

**Step 3: Test categorizer**

```bash
npx tsx -e "
import { categorizeArticle } from './src/lib/categories.ts';
console.log(categorizeArticle('New Spotify playlist feature', 'streaming music'));
console.log(categorizeArticle('OpenAI launches new AI model', 'artificial intelligence'));
console.log(categorizeArticle('New DAW plugin for producers', 'music production software'));
console.log(categorizeArticle('Company acquires startup', 'deal merger acquisition'));
console.log(categorizeArticle('Random headline', 'nothing relevant'));
"
```
Expected: Music, Tech, Music Tech, Industry, General respectively.

**Step 4: Commit**

```bash
git add src/lib/categories.ts src/lib/categories.json
git commit -m "feat: add keyword-based article categorizer"
```

---

### Task 5: Data Loader — Wire OPML + Feeds + Categorizer Together

**Files:**
- Create: `src/lib/data.ts`

**Step 1: Create the unified data loader**

Create `src/lib/data.ts`:
```ts
import { parseOpml } from './opml';
import { fetchAllFeeds } from './feeds';
import { categorizeArticles, type CategorizedArticle } from './categories';
import { resolve } from 'path';

let cachedArticles: CategorizedArticle[] | null = null;

export async function loadArticles(): Promise<CategorizedArticle[]> {
  if (cachedArticles) return cachedArticles;

  const opmlPath = resolve(process.cwd(), 'feeds.opml');
  const feeds = parseOpml(opmlPath, 'Mediaor');
  console.log(`Fetching from ${feeds.length} feeds...`);

  const articles = await fetchAllFeeds(feeds);
  console.log(`Fetched ${articles.length} articles`);

  cachedArticles = categorizeArticles(articles);
  return cachedArticles;
}

export function getArticlesByCategory(articles: CategorizedArticle[]): Record<string, CategorizedArticle[]> {
  const grouped: Record<string, CategorizedArticle[]> = {};
  for (const article of articles) {
    if (!grouped[article.categorySlug]) {
      grouped[article.categorySlug] = [];
    }
    grouped[article.categorySlug].push(article);
  }
  return grouped;
}
```

**Step 2: Test full pipeline**

```bash
npx tsx -e "
import { loadArticles, getArticlesByCategory } from './src/lib/data.ts';
const articles = await loadArticles();
const grouped = getArticlesByCategory(articles);
for (const [cat, arts] of Object.entries(grouped)) {
  console.log(cat + ':', arts.length, 'articles');
}
"
```
Expected: Articles grouped by category with counts.

**Step 3: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat: add unified data loader wiring OPML, feeds, and categorizer"
```

---

### Task 6: Base Layout and Global Styles

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/styles/global.css`

**Step 1: Create global styles**

Create `src/styles/global.css`:
```css
:root {
  --color-bg: #f8f9fa;
  --color-surface: #ffffff;
  --color-text: #1a1a1a;
  --color-text-secondary: #6b7280;
  --color-accent: #2563eb;
  --color-border: #e5e7eb;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --max-width: 1200px;
  --radius: 8px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.6;
}

a {
  color: inherit;
  text-decoration: none;
}

a:hover {
  color: var(--color-accent);
}
```

**Step 2: Create base layout**

Create `src/layouts/BaseLayout.astro`:
```astro
---
interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Music & Tech News Aggregator' } = Astro.props;

import '../styles/global.css';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <header class="site-header">
      <div class="header-inner">
        <a href="/" class="logo">Mediaor</a>
        <nav class="nav" id="category-nav">
          <slot name="nav" />
        </nav>
      </div>
    </header>
    <main class="main">
      <slot />
    </main>
    <footer class="site-footer">
      <p>Powered by Mediaor</p>
    </footer>
  </body>
</html>

<style>
  .site-header {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .logo {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .nav {
    display: flex;
    gap: 1rem;
    overflow-x: auto;
  }

  .main {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 1.5rem 1rem;
  }

  .site-footer {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 2rem 1rem;
    text-align: center;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }
</style>
```

**Step 3: Commit**

```bash
git add src/layouts/BaseLayout.astro src/styles/global.css
git commit -m "feat: add base layout and global styles"
```

---

### Task 7: Article Card Component

**Files:**
- Create: `src/components/ArticleCard.astro`

**Step 1: Create the card component**

Create `src/components/ArticleCard.astro`:
```astro
---
interface Props {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  source: string;
  sourceUrl?: string;
  image?: string;
}

const { title, link, description, pubDate, source, image } = Astro.props;

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
---

<article class="card">
  {image && (
    <div class="card-image">
      <img src={image} alt="" loading="lazy" />
    </div>
  )}
  <div class="card-body">
    <a href={link} target="_blank" rel="noopener noreferrer" class="card-title">
      {title}
    </a>
    <p class="card-description">{description}</p>
    <div class="card-meta">
      <span class="card-source">{source}</span>
      <span class="card-time">{timeAgo(pubDate)}</span>
    </div>
  </div>
</article>

<style>
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.15s;
  }

  .card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .card-image {
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: var(--color-border);
  }

  .card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }

  .card-title {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-description {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-meta {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .card-source {
    font-weight: 500;
  }
</style>
```

**Step 2: Commit**

```bash
git add src/components/ArticleCard.astro
git commit -m "feat: add ArticleCard component"
```

---

### Task 8: Homepage

**Files:**
- Modify: `src/pages/index.astro`
- Create: `src/components/CategorySection.astro`

**Step 1: Create CategorySection component**

Create `src/components/CategorySection.astro`:
```astro
---
import ArticleCard from './ArticleCard.astro';
import type { CategorizedArticle } from '../lib/categories';

interface Props {
  name: string;
  slug: string;
  articles: CategorizedArticle[];
  limit?: number;
}

const { name, slug, articles, limit = 6 } = Astro.props;
const displayArticles = articles.slice(0, limit);
const hasMore = articles.length > limit;
---

<section class="category-section">
  <div class="category-header">
    <h2 class="category-title">{name}</h2>
    {hasMore && <a href={`/${slug}`} class="see-more">See all &rarr;</a>}
  </div>
  <div class="card-grid">
    {displayArticles.map((article) => (
      <ArticleCard
        title={article.title}
        link={article.link}
        description={article.description}
        pubDate={article.pubDate}
        source={article.source}
        sourceUrl={article.sourceUrl}
        image={article.image}
      />
    ))}
  </div>
</section>

<style>
  .category-section {
    margin-bottom: 2.5rem;
  }

  .category-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 1rem;
    border-bottom: 2px solid var(--color-text);
    padding-bottom: 0.5rem;
  }

  .category-title {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .see-more {
    font-size: 0.875rem;
    color: var(--color-accent);
    font-weight: 500;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
</style>
```

**Step 2: Build the homepage**

Replace `src/pages/index.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import CategorySection from '../components/CategorySection.astro';
import { loadArticles, getArticlesByCategory } from '../lib/data';
import { getCategories } from '../lib/categories';

const articles = await loadArticles();
const grouped = getArticlesByCategory(articles);
const categories = getCategories();

const categoryOrder = [...categories.map((c) => c.slug), 'general'];
const categoryNames: Record<string, string> = Object.fromEntries(
  categories.map((c) => [c.slug, c.name])
);
categoryNames['general'] = 'General';

const activeCategories = categoryOrder.filter((slug) => grouped[slug]?.length > 0);
---

<BaseLayout title="Mediaor — Music & Tech News">
  <Fragment slot="nav">
    {activeCategories.map((slug) => (
      <a href={`/${slug}`} class="nav-link">{categoryNames[slug]}</a>
    ))}
  </Fragment>

  {activeCategories.map((slug) => (
    <CategorySection
      name={categoryNames[slug]}
      slug={slug}
      articles={grouped[slug]}
    />
  ))}

  {articles.length === 0 && (
    <p class="empty">No articles found. Check back soon.</p>
  )}
</BaseLayout>

<style>
  .nav-link {
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .nav-link:hover {
    background: var(--color-bg);
  }

  .empty {
    text-align: center;
    padding: 4rem;
    color: var(--color-text-secondary);
  }
</style>
```

**Step 3: Build and verify**

```bash
npm run build
```
Expected: Build succeeds (may take a minute while fetching feeds).

**Step 4: Commit**

```bash
git add src/components/CategorySection.astro src/pages/index.astro
git commit -m "feat: add homepage with category sections"
```

---

### Task 9: Category Pages (Dynamic Routes)

**Files:**
- Create: `src/pages/[category].astro`

**Step 1: Create the category page**

Create `src/pages/[category].astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ArticleCard from '../components/ArticleCard.astro';
import { loadArticles, getArticlesByCategory } from '../lib/data';
import { getCategories, getAllCategorySlugs } from '../lib/categories';

export async function getStaticPaths() {
  const articles = await loadArticles();
  const grouped = getArticlesByCategory(articles);
  const categories = getCategories();
  const categoryNames: Record<string, string> = Object.fromEntries(
    categories.map((c) => [c.slug, c.name])
  );
  categoryNames['general'] = 'General';

  return getAllCategorySlugs()
    .filter((slug) => grouped[slug]?.length > 0)
    .map((slug) => ({
      params: { category: slug },
      props: {
        name: categoryNames[slug],
        articles: grouped[slug],
        allSlugs: Object.keys(grouped),
        categoryNames,
      },
    }));
}

const { name, articles, allSlugs, categoryNames } = Astro.props;
---

<BaseLayout title={`${name} — Mediaor`}>
  <Fragment slot="nav">
    {allSlugs.map((slug: string) => (
      <a
        href={`/${slug}`}
        class:list={['nav-link', { active: slug === Astro.params.category }]}
      >
        {categoryNames[slug]}
      </a>
    ))}
  </Fragment>

  <h1 class="page-title">{name}</h1>
  <div class="card-grid">
    {articles.map((article: any) => (
      <ArticleCard
        title={article.title}
        link={article.link}
        description={article.description}
        pubDate={article.pubDate}
        source={article.source}
        sourceUrl={article.sourceUrl}
        image={article.image}
      />
    ))}
  </div>
</BaseLayout>

<style>
  .page-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    border-bottom: 2px solid var(--color-text);
    padding-bottom: 0.5rem;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .nav-link {
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .nav-link:hover {
    background: var(--color-bg);
  }

  .nav-link.active {
    background: var(--color-text);
    color: var(--color-surface);
  }
</style>
```

**Step 2: Build and verify**

```bash
npm run build
```
Expected: Build succeeds. `dist/` contains `index.html` and category directories.

**Step 3: Commit**

```bash
git add src/pages/\[category\].astro
git commit -m "feat: add dynamic category pages"
```

---

### Task 10: GitHub Actions Workflow + GitHub Pages Deploy

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `public/CNAME`

**Step 1: Create CNAME file**

Create `public/CNAME`:
```
mediaor.com
```

**Step 2: Create GitHub Actions workflow**

Create `.github/workflows/deploy.yml`:
```yaml
name: Build and Deploy

on:
  schedule:
    - cron: '*/30 * * * *'
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**Step 3: Create a favicon placeholder**

Create `public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="4" fill="#2563eb"/>
  <text x="16" y="22" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="18">M</text>
</svg>
```

**Step 4: Commit and push**

```bash
git add public/CNAME public/favicon.svg .github/workflows/deploy.yml
git commit -m "feat: add GitHub Actions deploy workflow and CNAME"
```

**Step 5: Push everything to GitHub**

```bash
git push -u origin main
```

**Step 6: Enable GitHub Pages**

In the GitHub repo settings:
1. Go to Settings → Pages
2. Set Source to "GitHub Actions"
3. Set up DNS for mediaor.com:
   - Add A records pointing to GitHub Pages IPs: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - Or add a CNAME record pointing to `jherskowitz.github.io`

---

### Task 11: Final Integration Test

**Step 1: Run full build locally**

```bash
npm run build
```

**Step 2: Preview locally**

```bash
npm run preview
```

Open http://localhost:4321 and verify:
- Homepage loads with categorized sections
- Category nav links work
- Article cards show title, source, time, description
- Links open original articles in new tabs
- Mobile responsive layout works

**Step 3: Verify GitHub Actions deployment**

```bash
gh run list --limit 1
```

Check that the workflow ran and deployed successfully.
