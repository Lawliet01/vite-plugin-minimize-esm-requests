import {string} from 'rollup-plugin-string'
import swc from '@rollup/plugin-swc';

export default [
  // core
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/esm2systemJs.js',
      format: 'esm',
      target: 'node',
    },
    watch: {
      include: 'src/**',
    },
    plugins: [
      string({
        include: ['./src/client/*.js']
      }),
      swc(),
    ]
  },
  // worker
  {
    input: 'src/rollup-worker.ts',
    output: {
      file: 'dist/rollup-worker.js',
      target: 'node',
    },
    watch: {
      include: 'src/rollup-worker.ts',
    },
    plugins: [
      swc(),
    ]
  }
]
