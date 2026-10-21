import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingExcludes: { '*': ['./upstream/**', './.git/**', './.local/**', './node_modules/.cache/**'] },
  async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] }]; }
};
export default config;
