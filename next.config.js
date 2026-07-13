const { loadEnvConfig } = require('@next/env');

loadEnvConfig(__dirname);

const isMobileExport = process.env.MOBILE_EXPORT === '1';
const embedPublicAiKeys = process.env.EMBED_PUBLIC_AI_KEYS === '1';
const agnesKey = embedPublicAiKeys ? (process.env.AGNES_API_KEY || '') : '';
const textModel = process.env.AI_TEXT_MODEL || 'gpt-4.1-mini';
const imageModel = process.env.AI_IMAGE_MODEL || 'agnes-image-2.1-flash';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isMobileExport ? 'export' : undefined,
  trailingSlash: isMobileExport,
  env: {
    NEXT_PUBLIC_GONGKAO_AGNES_KEY: isMobileExport ? agnesKey : '',
    NEXT_PUBLIC_GONGKAO_AGNES_TEXT_MODEL: isMobileExport ? textModel : '',
    NEXT_PUBLIC_GONGKAO_AGNES_IMAGE_MODEL: isMobileExport ? imageModel : '',
  },
  images: { unoptimized: true },
  async headers() {
    return [{
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type,x-ai-key,x-ai-model,x-image-key,x-image-model,x-image-size,x-image-ratio' },
        { key: 'Cache-Control', value: 'no-store' },
      ],
    }];
  },
};

module.exports = nextConfig;
