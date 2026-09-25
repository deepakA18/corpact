import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/demo-video',
        destination: 'https://youtu.be/rms3hOrw_bk',
        permanent: false,
      },
    ];
  },
  // The dev badge sits in the bottom-left of every frame; the demo is filmed from `next dev`.
  devIndicators: false,
  // Stop `next dev` from writing AGENTS.md / CLAUDE.md into the app directory.
  agentRules: false,
};

export default config;
