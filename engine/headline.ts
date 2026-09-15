import type { StatusLevel } from '../shared/types.js'

/** 服务端统一计算的中文相对时间（design §11：口径一致）。 */
export function relTime(iso: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const sec = Math.max(0, (Date.now() - then) / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  if (day < 30) return `${Math.floor(day / 7)} 周前`
  if (day < 365) return `${Math.floor(day / 30)} 个月前`
  return `${Math.floor(day / 365)} 年前`
}

/** 高亮对象的已计算状态，供模板生成白话用。 */
export interface HeadlineInput {
  branch: string | null
  isTrunk: boolean
  ahead: number
  behind: number
  merged: boolean
  squashLikely: boolean // 内容推断疑似已合并（design §5.3），优先于 merged=false 的本地独有/未推送叙述
  push: 'pushed' | 'unpushed' | 'no-upstream'
  dirty: number
  trunk: string | null
  trunkKnown: boolean // false=主干推断彻底失败（design §5.1/§14）；此时 ahead/behind 强制为 0，
  // 不代表"已同步"，是"没法比"——模板必须诚实说出来，不能落进 synced 折叠
  status: StatusLevel
  empty: boolean
  hasRemote: boolean
}

/** headline 组合规则（design §12.3 / §12.5）。 */
export function buildHeadline(c: HeadlineInput): string {
  if (c.empty) return '空仓库。'
  if (c.status === 'idle') {
    return c.hasRemote ? '空闲。' : '空闲，没有远程仓库。'
  }

  const branchGroup: string[] = []
  if (c.branch === null) {
    branchGroup.push('处于游离 HEAD（不在任何分支上）')
  } else if (!c.trunkKnown) {
    branchGroup.push('无法确定主干，没法比对')
  } else if (!c.isTrunk) {
    if (c.squashLikely) branchGroup.push('内容疑似已合并到主干（基于比对，非完全确定）')
    else if (c.merged && c.ahead === 0) branchGroup.push('已合入主干')
    else if (c.ahead > 0 && c.behind > 0)
      branchGroup.push(`与主干分叉（领先 ${c.ahead}、落后 ${c.behind} 个提交）`)
    else if (c.ahead > 0) branchGroup.push(`领先主干 ${c.ahead} 个提交`)
    else if (c.behind > 0) branchGroup.push(`落后主干 ${c.behind} 个提交`)
  }

  // 推送 / 本地独有（同语义去重：unmerged 优先于 unpushed，design §12.2）
  // squashLikely 时既不说"本地独有"也不说"还没推送"——内容已疑似并入，提这些反而误导。
  const unmerged = !!c.branch && !c.isTrunk && c.ahead > 0 && !c.merged && !c.squashLikely && c.push !== 'unpushed'
  if (unmerged) branchGroup.push(`本地独有，还没合入 ${c.trunk ?? '主干'}`)
  else if (!c.squashLikely && c.push === 'unpushed') branchGroup.push('还没推送')

  const wtGroup: string[] = []
  if (c.dirty > 0) {
    wtGroup.push(c.isTrunk ? `有 ${c.dirty} 个文件还没提交` : '工作区里有未提交的改动')
  }

  // synced 兜底（design §12.5）
  if (branchGroup.length === 0 && wtGroup.length === 0) {
    return c.isTrunk ? '一切已同步。' : '已推送，工作区干净。'
  }

  const subject = c.branch && !c.isTrunk ? `${c.branch} ` : ''
  const parts: string[] = []
  if (branchGroup.length) parts.push(branchGroup.join('、'))
  if (wtGroup.length) parts.push(wtGroup.join('、'))
  return `${subject}${parts.join('，')}。`
}

/** statusLine 紧凑串（design §12.2）—— 分支地图用。 */
export function buildStatusLine(c: HeadlineInput): string {
  if (c.empty) return '空仓库'
  const frags: string[] = []

  if (c.isTrunk) frags.push('主干')
  else if (c.branch === null) frags.push('游离 HEAD')
  else if (!c.trunkKnown) frags.push('主干未知')
  else if (c.squashLikely) frags.push('可能已合并')
  else if (c.merged && c.ahead === 0) frags.push('已合入')
  else if (c.ahead > 0 && c.behind > 0) frags.push(`分叉 +${c.ahead}/-${c.behind}`)
  else if (c.ahead > 0) frags.push(`领先 ${c.ahead}`)
  else if (c.behind > 0) frags.push(`落后 ${c.behind}`)

  const unmerged = !!c.branch && !c.isTrunk && c.ahead > 0 && !c.merged && !c.squashLikely && c.push !== 'unpushed'
  if (unmerged) frags.push('本地独有')
  else if (!c.squashLikely && c.push === 'unpushed') frags.push('未推送')
  else if (c.push === 'pushed') frags.push('已推送')
  else if (c.push === 'no-upstream' && c.hasRemote) frags.push('无跟踪')

  frags.push(c.dirty > 0 ? '有改动' : '干净')

  // synced 折叠：没事且不落后 → 已同步（design §12.2）。squashLikely 与 trunkKnown=false
  // 都不参与折叠——不确定性 / "没法比对"标记必须留在 UI 上，不能被"已同步"这种沉默措辞吞掉。
  if (c.status === 'synced' && c.behind === 0 && c.dirty === 0 && !c.squashLikely && c.trunkKnown) {
    return c.isTrunk ? '主干 · 已同步' : '已同步'
  }
  return frags.join(' · ')
}
