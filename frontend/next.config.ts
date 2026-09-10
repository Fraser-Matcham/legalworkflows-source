import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    // Emits .next/standalone: a self-contained server tree with only the
    // node_modules it actually reached. The container runtime stage copies
    // that rather than the whole dependency tree, which is what lets the
    // image stay small enough to deploy quickly. See frontend/Dockerfile.
    output: "standalone",
    reactCompiler: true,
    turbopack: {
        root: __dirname,
    },
    async rewrites() {
        return [
            {
                source: "/sitemap.xml",
                destination: "/api/sitemap/sitemap.xml",
            },
            {
                source: "/sitemap_:slug.xml",
                destination: "/api/sitemap/sitemap_:slug.xml",
            },
        ];
    },
    async redirects() {
        return [
            {
                source: "/account",
                destination: "/settings",
                permanent: true,
            },
            {
                source: "/account/:path*",
                destination: "/settings/:path*",
                permanent: true,
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
