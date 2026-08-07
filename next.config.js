const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El PDF nunca se sube ni se sirve: solo se acepta/renderiza markdown.
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

module.exports = withPWA(nextConfig);
