## 介绍

这个vite插件是我为了提升我所在的公司中的巨石应用的开发体验而实现的，如果你的应用也满足以下三个条件，那么这个插件可能是你的选择：

1. 使用vite开发；
2. 开发过程中，源码的模块请求 > 2000；
3. [hmr边界](https://cn.vitejs.dev/guide/api-hmr#hot-accept-cb)常常不能正确设置，导致大多数文件一经改动就会触发页面的重新加载；

这个插件的原理很简单：在使用vite开发过程中，以SystemJs作为媒介，将所有的es模块拼接在**一个文件内**（注意是「拼接」而不是「打包」），该文件会强缓存在浏览器端。后续每一次页面重载的时候，只需要重新请求本地改动的文件，而不需要请求所有的es6源码文件。

这样做的结果是：每一次请求所需要的源码es模块数量非常少，es模块的数量将不再成为页面重载性能的瓶颈，页面重载的时间将回归到实际应用重载所需的时间。

在我个人的场景下，我公司的应用一次需要请求5000个es模块，重载时间将近10s；而使用插件后，重载时间变成1～2秒

## 安装

```zsh
npm add -D vite-plugin-minimize-esm-requests
yarn add -D vite-plugin-minimize-esm-requests
pnpm add -D vite-plugin-minimize-esm-requests
```

## 使用

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