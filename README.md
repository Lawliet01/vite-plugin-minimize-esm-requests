[中文](./doc/README_zh.md)

## WHY

I created this plugin to elevate the development experience for a monolithic application in my company, which uses Vite. If your application satisfies the following three conditions, this plugin could be a great fit:

1. Use Vite to develop;
2. More than 2000 es module requests for source code on every page reload.
3. The [Hot Module Replacement (HMR) boundary](https://vitejs.dev/guide/api-hmr.html#hot-accept-cb) often cannot be set accurately, leading to a full page reload whenever most files are modified.

The underlying principle of this plugin is simple: It uses SystemJs as a mediator to concatenate all the ES modules into **ONE single file** (note it's a concatenation, not a bundle). This file will be cached in browser. We only need to request modified files on subsequent page reloads.

The outcome of this approach is that the number of ES module requests will no longer be a bottleneck for page reloads, as each reload only requires a very small number of ES6 module requests. This means the page reload performance will approximate the true loading performance of your application.

In my personal scenario, reloading the app in my company requires 5000 es module requests, taking approximately 10 seconds. However, after implementing the plugin, the reload time has been reduced to just 1 to 2 seconds.

## install

```shell
npm add -D vite-plugin-minimize-esm-requests
yarn add -D vite-plugin-minimize-esm-requests
pnpm add -D vite-plugin-minimize-esm-requests
```

## Usage

```ts
// vite.dev.config.ts
import MinimizeEsmRequests from 'vite-plugin-minimize-esm-requests';
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    MinimizeEsmRequests()
  ],
})
```