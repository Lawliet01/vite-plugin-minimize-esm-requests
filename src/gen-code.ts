import readline from 'node:readline';
import stream from 'node:stream';

import { ModuleGraph, ModuleNode, TransformResult } from 'vite';

import { logGenSourceMap } from './log.ts';

export interface SectionSourceMap {
    version: number;
    sections: Array<{
        offset: {
            line: number;
            column: number;
        };
        map: TransformResult['map'];
    }>;
}

const CODE_INTERVAL_FLAG = '//#__SYSTEM_JS_CODE_INTERVAL__=';
const insertCodeFlag = (moduleURL: string) => `\n${CODE_INTERVAL_FLAG}${moduleURL}\n`;
const getModuleIdCodeInterval = (flagString: string) =>
    flagString.replace(CODE_INTERVAL_FLAG, '').trim();
const isCodeFlag = (lineCodes: string) => lineCodes.startsWith(CODE_INTERVAL_FLAG);

const getModuleTransformResult = (module: ModuleNode): TransformResult | null => {
    return (
        // @ts-expect-error FIX: invalidationState 被 moduleNode 标记为@internal，但是有一些 304 的模块会存到 invalidationState 内
        module.transformResult || (module.invalidationState?.code ? module.invalidationState : null)
    );
};

// generate code
export function genCachedCode(modules: ModuleNode[]) {
    let code = 'window.__CACHED_SYSTEM_JS_CODE__ = new Map([';

    for (const module of modules) {
        const transformResult = getModuleTransformResult(module);
        if (!module.id || !transformResult?.code) continue;

        // codeFlag 用于标记新的代码块，方便后续生成 sourcemap
        code += insertCodeFlag(module.id);
        code += `["${module.url}", { code: () => { return ${transformResult.code} }}],`;
    }

    code += '])';

    return code;
}

// generate index source map: https://sourcemaps.info/spec.html#h.535es3xeprgt
export async function genSourceMap(code: string, moduleGraph: ModuleGraph): Promise<string> {
    const _start = performance.now();

    return new Promise((resolve) => {
        const map: SectionSourceMap = {
            version: 3,
            sections: [],
        };

        // 创建一个流以将字符串输入到 readline 接口
        const bufferStream = new stream.PassThrough();
        bufferStream.end(Buffer.from(code));

        const lineReader = readline.createInterface({
            input: bufferStream,
        });

        let lineNumber = 0;

        lineReader.on('line', function (lineCode: string) {
            lineNumber++;

            if (!isCodeFlag(lineCode)) return;

            const moduleId = getModuleIdCodeInterval(lineCode);
            const moduleNode = moduleGraph.getModuleById(moduleId);
            const transformResultMap = moduleNode
                ? getModuleTransformResult(moduleNode)?.map
                : null;

            if (moduleNode && transformResultMap) {
                map.sections.push({
                    offset: {
                        line: lineNumber,
                        column: 0,
                    },
                    map: {
                        ...transformResultMap,
                        sources: [moduleNode.url],
                    },
                });
            }
        });

        lineReader.on('close', function () {
            resolve(JSON.stringify(map));

            logGenSourceMap(performance.now() - _start);
        });
    });
}
