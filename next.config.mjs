// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Supabase Realtime가 내부적으로 ws 사용
  serverExternalPackages: ['ws'],

  webpack: (config, { isServer }) => {
    // --- 서버 번들에서 선택적 네이티브 모듈 제외 ---
    const externals = new Set([...(Array.isArray(config.externals) ? config.externals : [])]);
    if (isServer) {
      externals.add('bufferutil');
      externals.add('utf-8-validate');
    }
    config.externals = Array.from(externals);

    // --- 클라이언트 번들이 실수로 폴리필/번들 시도하지 않도록 명시적 false ---
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      bufferutil: false,
      'utf-8-validate': false,
    };

    // --- supabase/realtime-js에서 뜨는 웹팩 경고 무시 ---
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      /Critical dependency: the request of a dependency is an expression/,
    ];

    // 로그 소음 줄이기(선택)
    config.infrastructureLogging = { level: 'error' };
    return config;
  },
};

// (만약 next export(정적 배포)를 쓴다면 주석 해제)
// nextConfig.images = { unoptimized: true };

export default nextConfig;
