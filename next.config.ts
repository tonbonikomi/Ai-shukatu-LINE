import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // LIFF は LINE アプリの WebView 内で開かれる。
  // 埋め込みを許可しないと登録画面が表示できないため、frame-ancestors は制限しない。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
