import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ['@nws-commerce/db'],
  poweredByHeader: false,
  // Don't write AGENTS.md / CLAUDE.md into the app on `next dev`.
  agentRules: false,
};

export default config;
