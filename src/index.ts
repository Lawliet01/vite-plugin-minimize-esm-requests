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

    let requiredCachedVersion = Date.now();
    // The URLs of all modified modules will be stored here.
    const invalidatedURL = new Set<string>();

    const updateCached = () => {
        requiredCachedVersion = Date.now();
        invalidatedURL.clear();
    };

    let currentCode = '';
    let currentCodeCachedVersion = -1;
    let getCurrentSourceMapPromise = Promise.resolve('');

    // Use multithreading to transform ES Modules into SystemJS Modules.
    const workerPath = path.relative(process.cwd(), './rollup-worker.js');
    const transformPool = Pool(() => spawn(new Worker(workerPath)));

    return {
        name: 'vite-plugin-minimize-esm-requests',
        apply: 'serve',

        configureServer(server) {
            _server = server;

            _server.middlewares.use((req, res, next) => {
                if (req.originalUrl?.includes(CACHED_MODULE_URL)) {
                    const _start = performance.now();

                    const readyModules = getReadyCodeModules(_server.moduleGraph);

                    if (currentCodeCachedVersion !== requiredCachedVersion) {
                        // generate code
                        let code = genCachedCode(readyModules);
                        // sourcemap url
                        code += `//# sourceMappingURL=${CACHED_MODULE_SOURCE_MAP_URL}?v=${requiredCachedVersion}`;
                        currentCode = code;
                        currentCodeCachedVersion = requiredCachedVersion;
                        // generate sourcemap
                        getCurrentSourceMapPromise = genSourceMap(code, _server.moduleGraph);

                        logGenModules(readyModules.length, performance.now() - _start);
                    }

                    res.setHeader('Cache-Control', 'max-age=3600,immutable');
                    res.end(currentCode);
                    return;
                }

                // systemjs modules sourcemap
                if (req.originalUrl?.includes(CACHED_MODULE_SOURCE_MAP_URL)) {
                    return getCurrentSourceMapPromise.then((sourceMap) => {
                        res.setHeader('Cache-Control', 'max-age=3600,immutable');
                        res.end(sourceMap);
                    });
                }

                next();
            });

            // Listen for updates from the client notifications
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

        // For modified files, marks them as invalid.
        handleHotUpdate({ modules }) {
            const invalidUrls = modules.map((module) => module.url);

            invalidUrls.forEach((url) => invalidatedURL.add(url));

            // notify client to invalidate the modules during HMR
            _server.ws.send('MinimizeESMRequests:invalidateModule', invalidUrls);
        },

        // transform es6 modules -> systemJs modules
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
