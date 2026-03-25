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
