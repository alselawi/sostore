import typescript from 'rollup-plugin-typescript2';

export default {
    input: 'src/main.ts', // entry point of your application
    output: {
        file: 'dist/bundle.js', // output file
        format: 'umd', // output format (umd, cjs, esm, iife)
        name: 'apicalStore', // global variable name for umd/iife bundles
    },
    plugins: [
        typescript() // example plugin (typescript compiler)
    ]
};