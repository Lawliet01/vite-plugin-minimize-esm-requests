import { ModuleGraph, ModuleNode, TransformResult } from "vite"
import {logGenModules, logGenSourceMap} from './log.ts'

import readline from 'readline'
import stream from 'stream';

export type SectionSourceMap = {
	version: number,
	sections: {
		offset: {
			line: number,
			column: number
		},
		map: TransformResult['map']
	}[]
}

const CODE_INTERVAL_FLAG = '//#__SYSTEM_JS_CODE_INTERVAL__\='
const insertCodeFlag = (moduleURL: string) => `\n${CODE_INTERVAL_FLAG}${moduleURL}\n`
const getModuleIdCodeInterval = (flagString: string) => flagString.replace(CODE_INTERVAL_FLAG, '').trim()
const isCodeFlag = (lineCodes: string) => lineCodes.startsWith(CODE_INTERVAL_FLAG)

const getModuleTransformResult = (module: ModuleNode): TransformResult | null => {
	// @ts-expect-error FIX: invalidationState被moduleNode标记为@internal， 但是有一些304的模块会存到invalidationState内
	return module.transformResult || (module.invalidationState?.code ? module.invalidationState : null)
}

// generate code
export function genCachedCode(modules: ModuleNode[]) {
	const _start = performance.now()

	let code = 'window.__CACHED_SYSTEM_JS_CODE__ = new Map(['

	for (let module of modules) {
		const transformResult = getModuleTransformResult(module)
		if (!module.id || !transformResult?.code) continue

		// codeFlag 用于标记新的代码块，方便后续生成sourcemap
		code += insertCodeFlag(module.id)
		code += `["${module.url}", { code: () => { return ${transformResult.code} }}],`
	}

	code += '])'

	logGenModules(modules.length, performance.now() - _start)

	return code
}

// generate index source map: https://sourcemaps.info/spec.html#h.535es3xeprgt
export async function genSourceMap(code: string, moduleGraph: ModuleGraph):Promise<string> {
	const _start = performance.now()

	return new Promise((resolve) => {
		const map: SectionSourceMap = {
			version: 3,
			sections: []
		}

		// 创建一个流以将字符串输入到readline接口
		let bufferStream = new stream.PassThrough();
		bufferStream.end(Buffer.from(code));

		let lineReader = readline.createInterface({
			input: bufferStream,
		});

		let lineNumber = 0;

		lineReader.on('line', function (lineCode: string) {
			lineNumber++

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
			resolve(JSON.stringify(map))

			logGenSourceMap(performance.now() - _start)
		});
	})
}