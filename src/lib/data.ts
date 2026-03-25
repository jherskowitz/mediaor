import { parseOpml, type FeedSource } from './opml';
import { fetchAllFeeds } from './feeds';
import { categorizeArticles, type CategorizedArticle } from './categories';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadFeedsJson(jsonPath: string): FeedSource[] {
  if (!existsSync(jsonPath)) return [];
  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    return (data.feeds || []).filter((f: any) => f.xmlUrl);
  } catch {
    console.warn('Failed to parse feeds.json');
    return [];
  }
}

let cachedArticles: CategorizedArticle[] | null = null;

export async function loadArticles(): Promise<CategorizedArticle[]> {
  if (cachedArticles) return cachedArticles;

  const opmlPath = resolve(process.cwd(), 'feeds.opml');
  const jsonPath = resolve(process.cwd(), 'feeds.json');

  const opmlFeeds = existsSync(opmlPath) ? parseOpml(opmlPath, 'Mediaor') : [];
  const jsonFeeds = loadFeedsJson(jsonPath);

  // Merge and deduplicate by xmlUrl
  const seenUrls = new Set<string>();
  const feeds: FeedSource[] = [];
  for (const feed of [...jsonFeeds, ...opmlFeeds]) {
    if (!seenUrls.has(feed.xmlUrl)) {
      seenUrls.add(feed.xmlUrl);
      feeds.push(feed);
    }
  }

  console.log(`Fetching from ${feeds.length} feeds (${opmlFeeds.length} OPML + ${jsonFeeds.length} JSON)...`);

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
