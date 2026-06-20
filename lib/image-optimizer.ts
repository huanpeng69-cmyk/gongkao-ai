/**
 * 图片加载优化工具
 */

// 图片预加载缓存
const imageCache = new Map<string, Promise<string>>();

// 图片加载重试配置
const RETRY_COUNT = 3;
const RETRY_DELAY = 1000;

/**
 * 预加载图片
 */
export function preloadImage(src: string): Promise<string> {
  if (imageCache.has(src)) {
    return imageCache.get(src)!;
  }

  const promise = new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });

  imageCache.set(src, promise);
  return promise;
}

/**
 * 批量预加载图片
 */
export async function preloadImages(sources: string[]): Promise<void> {
  const uniqueSources = [...new Set(sources)];
  await Promise.allSettled(uniqueSources.map(preloadImage));
}

/**
 * 带重试的图片加载
 */
async function loadImageWithRetry(src: string, retries = RETRY_COUNT): Promise<string> {
  try {
    return await preloadImage(src);
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return loadImageWithRetry(src, retries - 1);
    }
    throw error;
  }
}

/**
 * 为HTML中的图片添加懒加载和错误处理
 */
export function enhanceImagesInHtml(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    // 如果已有loading属性，不重复添加
    if (/\bloading\s*=/i.test(attrs)) {
      return match;
    }
    // 添加懒加载和错误处理
    return `<img${attrs} loading="lazy" decoding="async" onerror="this.style.display='none';" />`;
  });
}

/**
 * 清理图片缓存
 */
export function clearImageCache(): void {
  imageCache.clear();
}

/**
 * 获取缓存大小
 */
export function getImageCacheSize(): number {
  return imageCache.size;
}
