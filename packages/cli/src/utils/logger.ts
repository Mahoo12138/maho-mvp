import pc from 'picocolors'

/**
 * CLI 日志工具。所有输出走 stdout/stderr，不带时间戳 ——
 * 用户更关心命令体感的简洁度，CI 也好抓取。
 *
 * 颜色策略：
 *   - info  灰：噪音级，跳过 OK
 *   - step  青：阶段切换，醒目
 *   - success 绿：阶段完成
 *   - warn  黄：非致命异常
 *   - error 红：致命，配合 process.exit(1)
 */
export const logger = {
  info: (msg: string): void => {
    console.log(pc.gray(msg))
  },
  step: (msg: string): void => {
    console.log(pc.cyan(`▶ ${msg}`))
  },
  success: (msg: string): void => {
    console.log(pc.green(`✓ ${msg}`))
  },
  warn: (msg: string): void => {
    console.log(pc.yellow(`⚠ ${msg}`))
  },
  error: (msg: string): void => {
    console.error(pc.red(`✗ ${msg}`))
  },
  raw: (msg: string): void => {
    process.stdout.write(msg)
  },
}

/**
 * 子进程日志前缀的可选颜色。挑选具备良好终端对比度的色板，
 * 避免和 logger.step / success 等冲突。
 */
export const prefixColors = ['cyan', 'green', 'magenta', 'yellow', 'blue', 'red'] as const
export type PrefixColor = (typeof prefixColors)[number]

export function colorize(color: PrefixColor, text: string): string {
  return pc[color](text)
}

/**
 * 按 index 循环挑色，避免相邻 target 撞色。
 */
export function pickPrefixColor(index: number): PrefixColor {
  return prefixColors[index % prefixColors.length]
}
