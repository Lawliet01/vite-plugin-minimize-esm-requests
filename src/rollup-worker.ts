import { rollup } from 'rollup';
import { expose } from 'threads/worker';

// make it convenient to inject code into the transformer.
const _handleVirtualJsFile = (sourceCode: string) => {
    return {
        name: 'handle-js-transfer',
        resolveId(id: string) {
            return id;
        },
        load() {
            return sourceCode;
        },
    };
};

// rollup transform: es modules -> systemJs modules
const rollupTransform = async function (code: string, id: string, name: string) {
    try {
        const bundle = await rollup({
            input: id,
            external: () => true,
            plugins: [_handleVirtualJsFile(code)],
        });

        const { output } = await bundle.generate({ format: 'system', sourcemap: 'hidden', name });
        bundle.close();

        return {
            code: output[0].code,
            map: output[0].map,
        };
    } catch {
        return { code };
    }
};

expose(rollupTransform);
