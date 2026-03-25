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
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['media:group', 'mediaGroup', { keepArray: false }],
      ['itunes:image', 'itunesImage', { keepArray: false }],
    ],
  },
});

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

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
      .filter((a) => a.link && now - a.pubDate.getTime() < SEVEN_DAYS);
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
  // 1. enclosure with image type
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image')) {
    return item.enclosure.url;
  }

  // 2. media:content or media:thumbnail (common in RSS feeds)
  const mediaUrl =
    item.mediaContent?.['$']?.url ||
    item.mediaThumbnail?.['$']?.url ||
    item.mediaGroup?.['media:content']?.['$']?.url ||
    item.mediaGroup?.['media:thumbnail']?.['$']?.url;
  if (mediaUrl) return mediaUrl;

  // 3. itunes:image (podcast/music feeds)
  const itunesUrl = item.itunesImage?.['$']?.href;
  if (itunesUrl) return itunesUrl;

  // 4. enclosure without type check (some feeds omit type)
  if (item.enclosure?.url && /\.(jpg|jpeg|png|gif|webp)/i.test(item.enclosure.url)) {
    return item.enclosure.url;
  }

  // 5. First img tag in content
  const content = item.content || item['content:encoded'] || '';
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/);
  if (imgMatch?.[1]) return imgMatch[1];

  return undefined;
}
