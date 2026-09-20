// craco.config.js — build config for the static, backendless Radio Melody app.
const path = require("path");

module.exports = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    configure: (webpackConfig) => {
      // Add ignored patterns to reduce watched directories
      webpackConfig.watchOptions = {
        ...webpackConfig.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/build/**",
          "**/dist/**",
          "**/coverage/**",
          "**/public/**",
        ],
      };
      return webpackConfig;
    },
  },
  // Keep the dev server working with webpack-dev-server v5 (react-scripts 5).
  devServer: (devServerConfig) => {
    const {
      https,
      onAfterSetupMiddleware,
      onBeforeSetupMiddleware,
      onListening,
      setupMiddlewares,
      ...compatibleConfig
    } = devServerConfig;

    compatibleConfig.server =
      typeof https === "object"
        ? { type: "https", options: https }
        : https
          ? "https"
          : "http";

    if (onBeforeSetupMiddleware || setupMiddlewares) {
      compatibleConfig.setupMiddlewares = (middlewares, devServer) => {
        if (onBeforeSetupMiddleware) {
          onBeforeSetupMiddleware(devServer);
        }
        return setupMiddlewares
          ? setupMiddlewares(middlewares, devServer)
          : middlewares;
      };
    }

    compatibleConfig.onListening = (devServer) => {
      devServer.close ??= (callback) => devServer.stopCallback(callback);

      if (onListening) {
        onListening(devServer);
      }
      if (onAfterSetupMiddleware) {
        onAfterSetupMiddleware(devServer);
      }
    };

    return compatibleConfig;
  },
};
