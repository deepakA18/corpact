import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace package shipped as TypeScript source.
  transpilePackages: ['@corpact/client'],
  // Stop `next dev` from writing AGENTS.md / CLAUDE.md into the app directory.
  agentRules: false,
};

export default config;
