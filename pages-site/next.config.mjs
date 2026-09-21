const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "DESIGN_AI_Teacher";

process.env.NEXT_PUBLIC_STATIC_DEMO = "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: `/${repositoryName}`,
  trailingSlash: true
};

export default nextConfig;
