import type { NextConfig } from "next";
import { withEve } from "eve/next";
import path from "node:path";

// Next and eve run in separate processes; give both the same media/manifest root.
process.env.STUDIO_DATA_DIR ||= path.resolve(".studio");
process.env.STUDIO_PROJECT_DIR ||= process.cwd();

const config: NextConfig = {
  serverExternalPackages: ["sharp"],
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": [
      "./research/**/*",
      "./.studio/**/*",
      "./.tools/**/*",
      "./.env*",
      "./artifacts/**/*",
    ],
  },
};

export default withEve(config);
