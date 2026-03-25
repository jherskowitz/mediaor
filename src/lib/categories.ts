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
