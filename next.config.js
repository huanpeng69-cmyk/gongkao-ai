const { loadEnvConfig } = require('@next/env');

loadEnvConfig(__dirname);

const isMobileExport = process.env.MOBILE_EXPORT === '1';
const isGitHubPages = process.env.GITHUB_PAGES === '1';
const embedPublicAiKeys = process.env.EMBED_PUBLIC_AI_KEYS === '1';
const agnesKey = embedPublicAiKeys ? (process.env.AGNES_API_KEY || '') : '';
const textModel = process.env.AI_TEXT_MODEL || 'agnes-2.0-flash';
const imageBase = process.env.IMAGE_BASE_URL || 'https://wisart.kuaileshifu.com';
const imageKey = embedPublicAiKeys ? (process.env.IMAGE_API_KEY || '') : '';
const imageModel = process.env.IMAGE_MODEL || 'gpt-image-2';
const imageAuth = process.env.IMAGE_AUTH_SCHEME || 'bearer';
const imageSize = process.env.IMAGE_SIZE || '1200x675';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isMobileExport ? 'export' : undefined,
  trailingSlash: isMobileExport,
  basePath: isGitHubPages ? '/gongkao-ai' : '',
  env: {
    NEXT_PUBLIC_GONGKAO_BASE_PATH: isGitHubPages ? '/gongkao-ai' : '',
    NEXT_PUBLIC_GONGKAO_AGNES_KEY: isMobileExport ? agnesKey : '',
    NEXT_PUBLIC_GONGKAO_AGNES_TEXT_MODEL: isMobileExport ? textModel : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_BASE: isMobileExport ? imageBase : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_KEY: isMobileExport ? imageKey : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_MODEL: isMobileExport ? imageModel : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_AUTH: isMobileExport ? imageAuth : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_SIZE: isMobileExport ? imageSize : '',
  },
  images: { unoptimized: true },
};

module.exports = nextConfig;
