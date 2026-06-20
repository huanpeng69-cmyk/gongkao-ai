const { loadEnvConfig } = require('@next/env');

loadEnvConfig(__dirname);

const isMobileExport = process.env.MOBILE_EXPORT === '1';
const xiaomiName = process.env.XIAOMI_AI_NAME || process.env.AI_NAME || '\u5c0f\u7c73MiMo';
const mobileAiBase = process.env.XIAOMI_BASE_URL || process.env.AI_BASE_URL || 'https://api.xiaomi.com/v1';
const mobileAiKey = process.env.XIAOMI_API_KEY || process.env.AI_API_KEY || '';
const mobileAiModel = process.env.XIAOMI_MODEL || process.env.AI_MODEL || 'mimo';
const mobileAiProtocol = process.env.XIAOMI_PROVIDER || process.env.AI_PROVIDER || 'openai';
const mobileAiAuth = process.env.XIAOMI_AUTH_SCHEME || process.env.AI_AUTH_SCHEME || 'bearer';
const mobileImageBase = process.env.XIAOMI_IMAGE_BASE_URL || process.env.IMAGE_BASE_URL || mobileAiBase;
const mobileImageKey = process.env.XIAOMI_IMAGE_API_KEY || process.env.IMAGE_API_KEY || mobileAiKey;
const mobileImageModel = process.env.XIAOMI_IMAGE_MODEL || process.env.IMAGE_MODEL || mobileAiModel;
const mobileImageAuth = process.env.XIAOMI_IMAGE_AUTH_SCHEME || process.env.IMAGE_AUTH_SCHEME || mobileAiAuth;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isMobileExport ? 'export' : undefined,
  trailingSlash: isMobileExport,
  env: {
    NEXT_PUBLIC_GONGKAO_AI_NAME: isMobileExport ? xiaomiName : '',
    NEXT_PUBLIC_GONGKAO_AI_BASE: isMobileExport ? mobileAiBase : '',
    NEXT_PUBLIC_GONGKAO_AI_KEY: isMobileExport ? mobileAiKey : '',
    NEXT_PUBLIC_GONGKAO_AI_MODEL: isMobileExport ? mobileAiModel : '',
    NEXT_PUBLIC_GONGKAO_AI_PROTOCOL: isMobileExport ? mobileAiProtocol : '',
    NEXT_PUBLIC_GONGKAO_AI_AUTH: isMobileExport ? mobileAiAuth : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_BASE: isMobileExport ? mobileImageBase : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_KEY: isMobileExport ? mobileImageKey : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_MODEL: isMobileExport ? mobileImageModel : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_AUTH: isMobileExport ? mobileImageAuth : '',
    NEXT_PUBLIC_GONGKAO_IMAGE_SIZE: isMobileExport ? (process.env.IMAGE_SIZE || '1024x1024') : '',
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,x-ai-provider,x-ai-key,x-ai-base,x-ai-model,x-ai-auth' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
