import colors from 'picocolors'

export const log = (msg: string) => console.log(`${colors.cyan(colors.bold('[Minimize-ESM-Requests-Plugin]'))} ${msg}`)

export const logError = (msg: string) => log(colors.red(msg))

export const logGenModules = (modulesLength: number, time: number) => log(`🎉 Generated Code map for ${modulesLength} modules within ${colors.green(`${Math.round(time)}ms`)}, The subsequent page reloads will save the time of ${colors.red(`${modulesLength} requests`)}`)

export const logGenSourceMap = (time: number) => log(`Generated sourceMap within ${Math.round(time)}ms`)