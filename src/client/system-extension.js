const trailingSeparatorRE = /[?&]$/;
const importQueryRE = /(\?|&)import=?(?:&|$)/;
const timestampRE = /\bt=\d{13}&?\b/;

function removeTimestampQuery(url) {
    return url.replace(timestampRE, '').replace(trailingSeparatorRE, '');
}

function removeImportQuery(url) {
    return url.replace(importQueryRE, '$1').replace(trailingSeparatorRE, '');
}

// Align the module URLs in both the client and the server.
const resolveUrl = (url) => {
    const { pathname, search } = new URL(url);
    return removeImportQuery(removeTimestampQuery(pathname + search));
};

const hasExt = (url) => url.split('.').length > 1;
const extGroup = ['mjs', 'js', 'ts', 'mts', 'jsx'];

const isInWorkerEnv = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

let unCachedModulesCount = 0;
let hasNotify = false;

// Notify the server to update the code when the number of uncached modules in a request exceeds a certain threshold.
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

// For modules that lack a file extension, first consult the cache to see if a matching module exists, so as to prevent unnecessary duplicate requests for the same module.
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
    if (useCachedModule) return [deps, declare, metas];

    // If the module isn't being imported by another systemjs module, it should execute automatically, for example a script tag.
    if (!systemJsImportUrl.has(name) && name.startsWith('/')) {
        this.import(name, null, { autoImportModule: [deps, declare, metas] });
    } else {
        return Reflect.apply(register, this, [deps, declare, metas]);
    }
};

System.constructor.prototype.instantiate = async function (url, _, metas) {
    // auto import modules
    if (metas?.autoImportModule) return metas.autoImportModule;

    const pathName = resolveUrl(url);

    // cached modules
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

    // Test if the cached modules needs to be updated
    if (!isInWorkerEnv && window.__CACHED_SYSTEM_JS_CODE__ && !pathName.includes('/node_modules/'))
        unCachedModulesCount++;
    checkIfUpdate();

    // uncached modules
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

// Injecting code for server-side communication
if (!isInWorkerEnv) {
    // Non-blocking
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
