import path from 'node:path';

import colors from 'picocolors';
import { Pool, spawn, Worker } from 'threads';
import { HtmlTagDescriptor, Plugin as VitePlugin, ViteDevServer } from 'vite';

// @ts-expect-error import raw string
import systemExtensionCode from './client/system-extension.js';
// @ts-expect-error import raw string
import SystemJsCode from './client/systemjs.js';
import { genCachedCode, genSourceMap } from './gen-code.ts';
import { log, logError, logGenModules } from './log.ts';

// 请求代码的路径
const CACHED_MODULE_URL = '/virtual:cachedSystemJsModule';
const CACHED_MODULE_SOURCE_MAP_URL = '/virtual:cachedModuleSourceMap';

const workerFileRE = /(\?|&)worker_file/;

const getReadyCodeModules = (moduleGraph: ViteDevServer['moduleGraph']) =>
    Array.from(moduleGraph.idToModuleMap)
        .filter(
            ([_, module]) =>
                !module.url.includes('/node_modules/') && !workerFileRE.test(module.url),
        )
        .map(([_, module]) => module);

export default function MinimizeEsmRequests(): VitePlugin {
    let _server: ViteDevServer;

    // 要求的缓存版本
    let requiredCachedVersion = Date.now();
    // 不合法的 URL 集合
    const invalidatedURL = new Set<string>();

    // 更新缓存
    const updateCached = () => {
        requiredCachedVersion = Date.now();
        invalidatedURL.clear();
    };

    let currentCode = '';
    let currentCodeCachedVersion = -1;
    let getCurrentSourceMapPromise = Promise.resolve('');

    // worker pool，用于首次加载时多线程转化 systemJs
    const workerPath = path.relative(process.cwd(), './rollup-worker.js');
    const transformPool = Pool(() => spawn(new Worker(workerPath)));

    return {
        name: 'vite-plugin-minimize-esm-requests',
        apply: 'serve',

        configureServer(server) {
            _server = server;

            _server.middlewares.use((req, res, next) => {
                // code systemjs version modules
                if (req.originalUrl?.includes(CACHED_MODULE_URL)) {
                    const _start = performance.now();

                    const readyModules = getReadyCodeModules(_server.moduleGraph);

                    // 看看是否需要更新缓存
                    if (currentCodeCachedVersion !== requiredCachedVersion) {
                        let code = genCachedCode(readyModules);
                        // sourceMap 地址
                        code += `//# sourceMappingURL=${CACHED_MODULE_SOURCE_MAP_URL}?v=${requiredCachedVersion}`;
                        currentCode = code;
                        currentCodeCachedVersion = requiredCachedVersion;
                        getCurrentSourceMapPromise = genSourceMap(code, _server.moduleGraph);

                        logGenModules(readyModules.length, performance.now() - _start);
                    }

                    res.setHeader('Cache-Control', 'max-age=3600,immutable');
                    res.end(currentCode);
                    return;
                }

                // code systemjs module sourcemap
                if (req.originalUrl?.includes(CACHED_MODULE_SOURCE_MAP_URL)) {
                    return getCurrentSourceMapPromise.then((sourceMap) => {
                        res.setHeader('Cache-Control', 'max-age=3600,immutable');
                        res.end(sourceMap);
                    });
                }

                next();
            });

            // 监听前端通知的更新
            _server.ws.on('MinimizeESMRequests:UpdateModules', () => {
                log('The next reload will update the cache.');
                updateCached();
            });
        },

        transformIndexHtml(html) {
            const tags: HtmlTagDescriptor[] = [
                // systemJs loader && systemJs extension code
                {
                    tag: 'script',
                    children: `${SystemJsCode}\n${systemExtensionCode}`,
                },
                // cached source code modules
                {
                    tag: 'script',
                    attrs: {
                        src: `${CACHED_MODULE_URL}?v=${requiredCachedVersion}`,
                        async: true,
                    },
                },
                // invalidUrl
                {
                    tag: 'script',
                    children: `window.__SYSTEM_JS_INVALIDATED_URL__ = new Set(['${Array.from(invalidatedURL).join("','")}'])`,
                },
            ];

            return {
                html,
                tags,
            };
        },

        // 对于修改的文件，让其失效
        handleHotUpdate({ modules }) {
            const invalidUrls = modules.map((module) => module.url);

            // 记录失效的模块
            invalidUrls.forEach((url) => invalidatedURL.add(url));

            // 通知 client 改动的模块
            _server.ws.send('MinimizeESMRequests:invalidateModule', invalidUrls);
        },

        // 转化 es6 modules -> systemJs modules
        transform: {
            order: 'post',
            handler: async function (code, id) {
                try {
                    const moduleUrl = _server.moduleGraph.getModuleById(id)?.url;
                    if (!moduleUrl) throw new Error(`moduleUrl not found: ${id}`);

                    return new Promise((resolve) => {
                        transformPool
                            .queue((transformer) => transformer(code, id, moduleUrl))
                            .then((res) => {
                                if (res?.code && workerFileRE.test(id)) {
                                    // worker 文件需要加入 systemjs loader
                                    res.code = `${SystemJsCode}\n${systemExtensionCode}\n${res.code}`;
                                }

                                resolve(res);
                            })
                            .catch((error) => {
                                throw error;
                            });
                    });
                } catch (error) {
                    logError(colors.red(`transform Error: ${error}`));
                    return code;
                }
            },
        },
    };
}
