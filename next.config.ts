import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The legal documents are read from disk at request time, and nothing in the
   * bundle references them by a path the tracer can follow — so without this
   * they are simply absent from the deployment, and only in production.
   */
  outputFileTracingIncludes: {
    "/{terms,privacy,dpa,subprocessors}": ["./docs/legal/*.md"],
    "/sitemap.xml": ["./docs/legal/*.md"],
  },
};

export default nextConfig;
