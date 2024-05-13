/** @type {import('next').NextConfig} */

import million from "million/compiler";
import analyzeBundle from "@next/bundle-analyzer";

const withBundleAnalyzer = analyzeBundle({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig = withBundleAnalyzer({
  output: "export",
  distDir: "./dist",
  cleanDistDir:true,
  webpack(config, { webpack }) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    if (process.env.NODE_ENV === "production") {
      config.plugins.push(
        new webpack.DefinePlugin({
          "globalThis.__DEV__": false,
        })
      );
    }

    return config;
  },
});

const millionConfig = {
  auto: true,
};

export default million.next(nextConfig, millionConfig);
