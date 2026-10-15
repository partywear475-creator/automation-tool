/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep sharp (native) out of the server bundle — used for image watermarking.
  serverExternalPackages: ["sharp"],
};

module.exports = nextConfig;
