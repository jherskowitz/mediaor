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
const musicSources: Set<string> = new Set(
  (categoryData as any).musicSources || []
);

function matchesKeyword(text: string, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase();
  // For short keywords (<=3 chars), use word-boundary matching to avoid false positives
  if (lowerKeyword.length <= 3) {
    const regex = new RegExp(`\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(text);
  }
  return text.includes(lowerKeyword);
}

export function categorizeArticle(title: string, description: string, source?: string): { name: string; slug: string } {
  const text = `${title} ${description}`.toLowerCase();

  // First pass: keyword matching on article content
  for (const cat of categories) {
    for (const keyword of cat.keywords) {
      if (matchesKeyword(text, keyword)) {
        return { name: cat.name, slug: cat.slug };
      }
    }
  }

  // Second pass: if no keyword match, fall back to source-based default
  if (source && musicSources.has(source)) {
    return { name: 'Music', slug: 'music' };
  }

  return { name: 'General', slug: 'general' };
}

export function categorizeArticles(articles: import('./feeds').Article[]): CategorizedArticle[] {
  return articles.map((a) => {
    const { name, slug } = categorizeArticle(a.title, a.description, a.source);
    return { ...a, category: name, categorySlug: slug };
  });
}

export function getCategories(): Category[] {
  return categories;
}

export function getAllCategorySlugs(): string[] {
  return [...categories.map((c) => c.slug), 'general'];
}
