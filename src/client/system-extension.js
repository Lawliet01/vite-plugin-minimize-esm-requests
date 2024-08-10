/* eslint-disable no-undef */
const trailingSeparatorRE = /[?&]$/;
const importQueryRE = /(\?|&)import=?(?:&|$)/;
const timestampRE = /\bt=\d{13}&?\b/;

// 删除时间戳
function removeTimestampQuery(url) {
    return url.replace(timestampRE, '').replace(trailingSeparatorRE, '');
}
// 删除 import
function removeImportQuery(url) {
    return url.replace(importQueryRE, '$1').replace(trailingSeparatorRE, '');
}

// 对齐前端与后端的 URL
const resolveUrl = (url) => {
    const { pathname, search } = new URL(url);
    return removeImportQuery(removeTimestampQuery(pathname + search));
};

/**
 * 路径是否有后缀
 */
const hasExt = (url) => url.split('.').length > 1;
const extGroup = ['mjs', 'js', 'ts', 'mts', 'jsx'];

// 是否在 worker 环境内
const isInWorkerEnv = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

// 无缓存请求的数量
let unCachedModulesCount = 0;
let hasNotify = false;
// 请求超过 XX 数量未缓存模块，就通知 server 更新代码
const maxUnCachedModulesAllow = 20;
const checkIfUpdate = () => {
    if (
        unCachedModulesCount > maxUnCachedModulesAllow &&
        !hasNotify &&
        typeof window.__NOTIFY_UPDATE__ === 'function'
    ) {
        window.__NOTIFY_UPDATE__();
        hasNotify = true;
    }
};

// 扩展：对于没有后缀的模块，先从缓存查看是否有对应的模块，避免同一模块重复请求
const originalResolve = System.constructor.prototype.resolve;
System.constructor.prototype.resolve = function () {
    const resId = Reflect.apply(originalResolve, this, arguments);

    if (!hasExt(resId)) {
        for (const ext of extGroup) {
            if (this.has(`${resId}.${ext}`)) {
                return `${resId}.${ext}`;
            }
        }
    }

    return resId;
};

const systemJsImportUrl = new Set();
let useCachedModule = false;

const { register } = System.constructor.prototype;
System.constructor.prototype.register = function (name, deps, declare, metas) {
    // 使用缓存的模块
    if (useCachedModule) return [deps, declare, metas];

    // 不是 systemjs import 的，要自动执行，如 script
    if (!systemJsImportUrl.has(name) && name.startsWith('/')) {
        this.import(name, null, { autoImportModule: [deps, declare, metas] });
    } else {
        return Reflect.apply(register, this, [deps, declare, metas]);
    }
};

System.constructor.prototype.instantiate = async function (url, _, metas) {
    // autoImport 的模块
    if (metas?.autoImportModule) return metas.autoImportModule;

    const pathName = resolveUrl(url);

    // 缓存的模块
    if (
        !isInWorkerEnv &&
        window?.__CACHED_SYSTEM_JS_CODE__?.has(pathName) &&
        !window.__SYSTEM_JS_INVALIDATED_URL__?.has(pathName)
    ) {
        const { code } = window.__CACHED_SYSTEM_JS_CODE__.get(pathName);
        useCachedModule = true;
        const res = code();
        useCachedModule = false;
        return res;
    }

    // 测试是否需要更新代码
    if (!isInWorkerEnv && window.__CACHED_SYSTEM_JS_CODE__ && !pathName.includes('/node_modules/'))
        unCachedModulesCount++;
    checkIfUpdate();

    // 无缓存模块，
    const systemImportPathName = [pathName];
    if (!hasExt(pathName)) {
        systemImportPathName.push(
            ...['mjs', 'js', 'ts', 'mts', 'jsx'].map((ext) => `${pathName}.${ext}`),
        );
    }

    systemImportPathName.forEach((path) => systemJsImportUrl.add(path));
    await import(url);
    systemImportPathName.forEach((path) => systemJsImportUrl.delete(path));
    return this.getRegister(url);
};

// 注入与服务端通信的代码
if (!isInWorkerEnv) {
    // 不阻塞
    setTimeout(() => {
        System.import('/@vite/client').then(({ createHotContext }) => {
            const context = createHotContext('virtual:hmrClientCode');
            context.on('MinimizeESMRequests:invalidateModule', (urls) => {
                for (const url of urls) {
                    window.__SYSTEM_JS_INVALIDATED_URL__.add(url);
                }
            });
            window.__NOTIFY_UPDATE__ = () => {
                context.send('MinimizeESMRequests:UpdateModules');
            };
        });
    });
}
