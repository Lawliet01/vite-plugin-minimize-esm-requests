import { rollup } from 'rollup';
import { expose } from 'threads/worker';

// 让后续转换可以直接在内存读取 js 文件
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

// rollup 转化
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
