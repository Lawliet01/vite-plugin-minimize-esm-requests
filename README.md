[中文](./doc/README_zh.md)

## WHY

I created this plugin to elevate the development experience of a monolithic application in my company, which uses Vite. If your application satisfies the following three conditions, this plugin could be a great fit:

1. Use Vite to develop;
2. More than 2000 es module requests of source code on every page reload;
3. The Hot Module Replacement (HMR) boundary often cannot be set accurately, leading to a full page reload whenever most files are modified.

The underlying principle of this plugin is simple: It uses SystemJs as a mediator to concatenate all the ES modules into ONE single file (note it's a concatenation, not a bundle). This file will be cached in browser. We only need to requests modified files on subsequent page reload.

The outcome of this approach is that the number of ES module requests will no longer be a bottleneck for page reloads,as each reload only requires a very small number of ES6 module requests. This means the page reload performance will approximate the true loading performance of your application.

## Usage
