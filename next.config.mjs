/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Keep Node.js-only packages out of the client bundle
  serverExternalPackages: ['openai', 'playwright', 'playwright-core'],
}

export default nextConfig
