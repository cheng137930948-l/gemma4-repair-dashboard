/**
 * Gemma 4 智能分析适配器 (Demo Mode) — Agentic 工具架构
 *
 * 设计要点（AI Agent 赛道核心）：
 *   1. 工具注册表（Tool Registry）：每个 get_* 工具是一个可被规划器调用的能力单元，
 *      读取看板真实（脱敏）数据并返回 {summary, data}。
 *   2. 规划 + 执行：analyze() / chat() 充当规划器，按问题选择并调用工具，
 *      记录真实调用轨迹 trace（工具名 + 入参 + 结果摘要）。
 *   3. 返回 {text, trace}：text 为最终回答，trace 暴露 Agent 的推理过程，供 UI 可视化。
 *
 * Demo 模式下推理由本地规划器模拟 Gemma 4 的工具编排视角；
 * 关闭 gemma_config.js 的 demoMode 后可替换为真实模型 + Function Calling。
 */
window.GemmaAdapter = {
  async analyze(type, data) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      if (type === 'integrated') return this._reportIntegrated(data);
      if (type === 'material')   return this._reportMaterial(data);
    } catch (e) {
      console.error('[Gemma 4] 分析失败', e);
      return { text: `### Gemma 4 分析提示\n\n当前数据不足，请加载有效数据后重试。\n\n*(${e.message})*`, trace: [] };
    }
    return { text: '未知的分析类型。', trace: [] };
  },

  async chat(type, question, data) {
    await new Promise(r => setTimeout(r, 700));
    const q = String(question || '').trim();
    if (!q) return { text: '请输入您想了解的问题，例如「维修二组今天出勤怎么样？」', trace: [] };
    try {
      if (type === 'integrated') return this._chatIntegrated(q, data);
      if (type === 'material')   return this._chatMaterial(q, data);
    } catch (e) {
      console.error('[Gemma 4] 对话失败', e);
      return { text: '抱歉，我暂时无法回答这个问题，请换一种问法试试。', trace: [] };
    }
    return { text: '抱歉，我不理解这个问题。', trace: [] };
  },

  /* ── 通用工具函数 ── */
  _num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; },
  _ts() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; },
  _argmax(a) { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; },
  _argmin(a) { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[m]) m = i; return m; },
  _avg(a) { return a.length ? a.reduce((x, y) => x + this._num(y), 0) / a.length : 0; },
  _pct(p, t) { return t > 0 ? Math.round((p / t) * 100) : 0; },
  _hit(q, words) { return words.some(w => q.includes(w)); },

  /* 调用一个工具并记录轨迹 */
  _call(trace, tools, name, args) {
    const out = tools[name](args || {});
    trace.push({ tool: name, args: args || {}, summary: out.summary });
    return out.data;
  },

  /* ════════════════════════════════════════════
   *  综合维修看板：工具注册表
   * ════════════════════════════════════════════ */
  _ctxIntegrated(data) {
    const mods = data?.modules || {};
    // WIP（待修/在制）可设在任意模块的配置或数据上，按顺序取第一个非空值
    let wip = '';
    for (const k of ['module1', 'module2', 'module3', 'module4']) {
      const m = mods[k]; if (!m) continue;
      const w = (m.currentData && m.currentData.wip) || m.wip;
      if (w !== undefined && w !== null && String(w).trim() !== '') { wip = String(w).trim(); break; }
    }
    return {
      att:   data?.attendance?.currentData || data?.attendance || {},
      trend: mods.module1?.currentData || mods.module1 || {},
      staff: mods.module3?.currentData || mods.module3 || {},
      wip,
      wipBoard: data?.wipBoard || data?.wipDemo || null   // 真实接入用 wipBoard，演示用 wipDemo
    };
  },
  _toolsIntegrated(ctx) {
    const self = this;
    const peopleAll = () => []
      .concat(ctx.att.present || [], ctx.att.late || []).map(p => ({ ...p, _on: true }))
      .concat((ctx.att.absent || []).map(p => ({ ...p, _on: false })),
              (ctx.att.leave  || []).map(p => ({ ...p, _on: false })));
    return {
      get_repair_trend() {
        const labels = ctx.trend.labels || [], values = (ctx.trend.values || []).map(v => self._num(v));
        if (!values.length) return { summary: '无趋势数据', data: null };
        const pi = self._argmax(values), mi = self._argmin(values);
        const last = values[values.length - 1], prev = values[values.length - 2] ?? last;
        const avg = Math.round(self._avg(values)), dir = last >= prev ? '上升' : '回落';
        const band = `${Math.max(0, Math.round(last * 0.93))}-${Math.round(last * 1.07)}`;
        return { summary: `近${values.length}日峰值${values[pi]}件(${labels[pi] || pi})，均值${avg}，最新${last}件${dir}`,
                 data: { labels, values, peakIdx: pi, minIdx: mi, last, prev, avg, dir, band } };
      },
      get_staff_output() {
        const names = ctx.staff.labels || [], vals = (ctx.staff.values || []).map(v => self._num(v));
        if (!names.length) return { summary: '无个人产出数据', data: null };
        const sorted = names.map((n, i) => ({ n, v: vals[i] || 0 })).sort((a, b) => b.v - a.v);
        const sum = vals.reduce((a, b) => a + b, 0);
        const ratio = sorted.length > 1 && sorted[sorted.length - 1].v > 0 ? (sorted[0].v / sorted[sorted.length - 1].v).toFixed(1) : null;
        return { summary: `TOP ${sorted[0].n}(${sorted[0].v}件)，合计${sum}件`, data: { names, vals, sorted, sum, ratio } };
      },
      get_attendance() {
        const s = ctx.att.summary || {};
        const plan = self._num(s.attendancePlan), actual = self._num(s.attendanceActual);
        const absentNames = (ctx.att.absent || []).map(p => p.name).filter(Boolean);
        const lateNames = (ctx.att.late || []).map(p => p.name).filter(Boolean);
        return { summary: `在岗${actual}/${plan}，出勤${self._pct(actual, plan)}%`,
                 data: { plan, actual, rate: self._pct(actual, plan), day: self._num(s.dayShiftActual), night: self._num(s.nightShiftActual), absentNames, lateNames } };
      },
      get_wip() {
        const b = ctx.wipBoard;
        if (b && self._num(b.total) > 0) {
          const total = self._num(b.total);
          const high = total >= 20;
          const overdue = Array.isArray(b.overdue) ? b.overdue : [];
          const trend = (b.trend || []).map(v => self._num(v));
          const rising = trend.length >= 2 && trend[trend.length - 1] > trend[0];
          const byModel = Array.isArray(b.byModel) ? b.byModel : [];
          const aging = Array.isArray(b.aging) ? b.aging : [];
          const repairRate = (b.repairRate === 0 || b.repairRate) ? self._num(b.repairRate) : null;
          const fixed = self._num(b.fixed), scrap = self._num(b.scrap);
          return {
            summary: `待修WIP ${total}件${high ? '(偏高)' : ''}${overdue.length ? `，超期 ${overdue.length} 件` : ''}${repairRate !== null ? `，修复率 ${repairRate}%` : ''}`,
            data: { board: true, total, high, overdue, trend, rising, byModel, aging, repairRate, fixed, scrap }
          };
        }
        const wip = ctx.wip ? String(ctx.wip) : '';
        if (!wip) return { summary: '无 WIP 数据', data: null };
        const high = self._num(wip) >= 10;
        return { summary: `WIP ${wip}件${high ? '(偏高)' : '(健康)'}`, data: { wip, high } };
      },
      get_group(args) {
        const g = args.group;
        const inG = peopleAll().filter(p => (p.group || '').includes(g.replace('维修', '')) || (p.group || '') === g);
        const on = inG.filter(p => p._on), off = inG.filter(p => !p._on);
        const names = inG.map(p => p.name);
        const outs = (ctx.staff.labels || []).map((n, i) => ({ n, v: self._num((ctx.staff.values || [])[i]) })).filter(x => names.includes(x.n)).sort((a, b) => b.v - a.v);
        return { summary: `${g} 在岗${on.length}/${inG.length}`, data: { g, inG, on, off, outs } };
      },
      get_person(args) {
        const name = args.name, names = ctx.staff.labels || [], vals = (ctx.staff.values || []).map(v => self._num(v));
        const idx = names.indexOf(name), v = self._num(vals[idx]);
        const sorted = names.map((n, i) => ({ n, v: self._num(vals[i]) })).sort((a, b) => b.v - a.v);
        const rank = sorted.findIndex(x => x.n === name) + 1;
        const person = peopleAll().find(p => p.name === name);
        return { summary: `${name} ${v}件，排名第${rank}`, data: { name, v, rank, total: names.length, person } };
      },
      get_defect_detail(args) {
        const dm = ctx.staff.detailMap || {};
        const people = Object.keys(dm).filter(k => Array.isArray(dm[k]) && dm[k].length);
        if (!people.length) return { summary: '无维修明细数据', data: null };
        const val = r => self._num(r['数量'] ?? r.qty ?? r.value ?? 1) || 1;
        const model = r => r['板卡料号'] || r['料号'] || r['机种'] || r.model || '未标料号';
        const defect = r => r['错误描述'] || r['不良现象'] || r['不良描述'] || r.defect || '未标不良';
        const personAgg = {}, defectG = {}, modelG = {}; let total = 0;
        people.forEach(name => {
          const combo = {};
          (dm[name] || []).forEach(r => {
            const q = val(r), m = model(r), d = defect(r), key = m + '|' + d;
            combo[key] = (combo[key] || 0) + q;
            defectG[d] = (defectG[d] || 0) + q;
            modelG[m] = (modelG[m] || 0) + q;
            total += q;
          });
          personAgg[name] = Object.entries(combo).map(([k, v]) => ({ model: k.split('|')[0], defect: k.split('|')[1], qty: v })).sort((a, b) => b.qty - a.qty);
        });
        const topDefects = Object.entries(defectG).sort((a, b) => b[1] - a[1]);
        const topModels = Object.entries(modelG).sort((a, b) => b[1] - a[1]);
        let one = null;
        if (args.name) { const key = people.find(n => n === args.name || n.includes(args.name) || args.name.includes(n)); if (key) one = { name: key, items: personAgg[key] }; }
        const fmt = it => `${it.model} ${it.defect} ${it.qty}片`;
        return {
          summary: one ? `${one.name}: ${one.items.slice(0, 2).map(fmt).join('，')}${one.items.length > 2 ? '…' : ''}`
                       : `明细${total}片，高频不良「${topDefects[0][0]}」${topDefects[0][1]}片，机种「${topModels[0][0]}」${topModels[0][1]}片`,
          data: { personAgg, topDefects, topModels, total, one }
        };
      }
    };
  },

  _reportIntegrated(data) {
    const ctx = this._ctxIntegrated(data), tools = this._toolsIntegrated(ctx), trace = [];
    const tr = this._call(trace, tools, 'get_repair_trend', { days: 7 });
    const so = this._call(trace, tools, 'get_staff_output', {});
    const at = this._call(trace, tools, 'get_attendance', {});
    const wp = this._call(trace, tools, 'get_wip', {});
    const dd = this._call(trace, tools, 'get_defect_detail', {});

    const trendBlock = tr
      ? `*   **概况**：近 ${tr.values.length} 日维修量${tr.last >= tr.prev ? '呈上升态势' : '出现回落'}，峰值出现在 ${tr.labels[tr.peakIdx] || ('第' + (tr.peakIdx + 1) + '点')}，达到 ${tr.values[tr.peakIdx]} 件，区间均值约 ${tr.avg} 件/日。
*   **异常识别**：${tr.labels[tr.minIdx] || ('第' + (tr.minIdx + 1) + '点')} 为区间低点（${tr.values[tr.minIdx]} 件），建议核查该时段备件供应与人力到岗。
*   **预测**：基于当前 ${tr.dir} 趋势，预计下一周期维修量维持在 ${tr.band} 件之间。`
      : `*   暂无趋势数据，请先加载近 7 日维修量。`;

    const staffBlock = so
      ? `*   **TOP 产出**：工程师 **${so.sorted[0].n}** 产出最高（${so.sorted[0].v} 件），可作为标杆经验沉淀。
*   **团队产出**：在岗工程师合计完成 ${so.sum} 件${so.ratio ? `，最高与最低产出比约 ${so.ratio}:1，可适当调配工单分配` : ''}。`
      : `*   暂无个人产出数据。`;

    let attBlock = `*   **出勤概况**：计划 ${at.plan || '—'} 人，实际在岗 ${at.actual || '—'} 人，出勤率 ${at.plan ? at.rate + '%' : '—'}（白班 ${at.day} / 夜班 ${at.night}）。`;
    if (at.absentNames.length) attBlock += `\n*   **缺勤关注**：${at.absentNames.slice(0, 5).join('、')}${at.absentNames.length > 5 ? ' 等' : ''} 未出勤，建议跟进顶岗安排。`;

    let detailBlock;
    if (dd && dd.total) {
      const topD = dd.topDefects.slice(0, 3).map(([n, v]) => `**${n}**（${v} 片）`).join('、');
      const topM = dd.topModels.slice(0, 3).map(([n, v]) => `**${n}**（${v} 片）`).join('、');
      const persons = Object.keys(dd.personAgg).slice(0, 5).map(name => {
        const items = dd.personAgg[name].slice(0, 3).map(it => `${it.model} ${it.defect} ${it.qty} 片`).join('，');
        return `*   **${name}**：${items}${dd.personAgg[name].length > 3 ? ' 等' : ''}。`;
      }).join('\n');
      detailBlock = `*   **高频不良现象**：${topD}，建议优先排查共性根因。
*   **高频机种/料号**：${topM}。
${persons}`;
    } else {
      detailBlock = `*   暂无明细（不良现象 / 机种）数据。绑定"维修明细 XLSX"或在模块 detailMap 中填入「板卡料号 + 错误描述」后，可自动按「维修员 × 机种 × 不良现象」下钻分析。`;
    }

    let wipBlock;
    if (wp && wp.board) {
      let b = `*   **待修总量**：当前待修 WIP **${wp.total}** 件，${wp.high ? '已超过 20 件预警线，存在积压风险 ⚠️' : '处于可控区间'}。`;
      if (wp.repairRate !== null) b += `\n*   **修复率**：近期闭环工单修复率约 **${wp.repairRate}%**（已修 ${wp.fixed} / 报废 ${wp.scrap}），${wp.repairRate >= 90 ? '维修质量良好' : wp.repairRate >= 75 ? '尚可，建议关注报废根因' : '偏低，需复盘报废与返修工单 ⚠️'}。`;
      if (wp.trend.length) b += `\n*   **积压趋势**：近 ${wp.trend.length} 日 ${wp.trend.join(' → ')}（${wp.rising ? '持续积压，需加快消化' : '趋于消化'}）。`;
      if (wp.byModel.length) b += `\n*   **机种分布**：${wp.byModel.slice(0, 3).map(([k, v]) => `${k} ${v} 件`).join('、')}，建议优先备料与人力倾斜。`;
      if (wp.aging.length) b += `\n*   **老化分布**：${wp.aging.map(([k, v]) => `${k} ${v} 件`).join('、')}。`;
      if (wp.overdue.length) b += `\n*   **超期预警**：**${wp.overdue.length}** 件超过 7 天未修 —— ${wp.overdue.slice(0, 3).map(o => `${o['工单'] || '—'}（${o['机种'] || '—'}，已待修 ${o['待修天数'] || '?'} 天，${o['不良'] || '—'}）`).join('；')}，建议立即催办闭环。`;
      wipBlock = b;
    } else if (wp && wp.wip) {
      wipBlock = `*   当前待修 WIP 约 ${wp.wip} 件，${wp.high ? '偏高，建议优先消化在制工单或临时增援夜班' : '处于健康水位'}。`;
    } else {
      wipBlock = `*   暂无待修 WIP 数据。在系统设置的看板模块中填入「待修 WIP」数量，或接入工单状态数据源后，可自动监控待修积压与老化风险。`;
    }

    let advice = `*   建议通过 Gemma 4 对历史重复工单聚类，提前预防高频故障项。`;
    if (dd && dd.total && dd.topDefects.length) advice = `*   高频不良「**${dd.topDefects[0][0]}**」已累计 ${dd.topDefects[0][1]} 片，建议针对该现象组织专题根因分析并固化 SOP / 防呆措施。\n` + advice;
    if (wp && (wp.high || (wp.board && wp.overdue.length))) advice = `*   待修 WIP 偏高或存在超期工单，建议每日盯办老化清单、对超 7 天工单专人催办，并评估夜班增援。\n` + advice;

    const text = `### Gemma 4 智能维修分析报告

**1. 维修产出趋势**
${trendBlock}

**2. 人员效能评估**
${staffBlock}

**3. 维修明细洞察（不良现象 × 机种）**
${detailBlock}

**4. 待修 WIP 管理**
${wipBlock}

**5. 出勤与排班**
${attBlock}

**6. 改善建议**
${advice}

*注意：此报告由 Gemma 4 (Demo Mode) 于 ${this._ts()} 经多工具编排自动生成。*`;
    return { text, trace };
  },

  _chatIntegrated(q, data) {
    const ctx = this._ctxIntegrated(data), tools = this._toolsIntegrated(ctx), trace = [];

    // 班组
    const gm = q.match(/维修[一二三四五六1-6]组|[一二三四五六1-6]组/);
    if (gm) {
      const g = gm[0].startsWith('维修') ? gm[0] : '维修' + gm[0];
      const d = this._call(trace, tools, 'get_group', { group: g });
      if (!d.inG.length) return { text: `当前数据中未找到「${g}」的人员记录。可尝试问「整体出勤情况」。`, trace };
      let r = `**${g}**：共 ${d.inG.length} 人，在岗 ${d.on.length} 人${d.off.length ? `，未到/请假 ${d.off.length} 人（${d.off.map(p => p.name).join('、')}）` : '，全员到岗 ✅'}。`;
      if (d.outs.length) { const sum = d.outs.reduce((a, b) => a + b.v, 0); r += `\n该组今日产出合计 ${sum} 件，其中 ${d.outs[0].n} 最高（${d.outs[0].v} 件）。`; }
      return { text: r, trace };
    }

    // 个人
    const names = ctx.staff.labels || [];
    const hitName = names.find(n => n && q.includes(n));
    if (hitName) {
      if (this._hit(q, ['明细', '不良', '故障', '现象', '修了', '修什么', '什么板', '料号', '机种', '错误', '描述', '哪些'])) {
        const dd = this._call(trace, tools, 'get_defect_detail', { name: hitName });
        if (dd && dd.one && dd.one.items.length) {
          const lines = dd.one.items.map(it => `• ${it.model} ${it.defect} **${it.qty}** 片`).join('\n');
          const sum = dd.one.items.reduce((a, b) => a + b.qty, 0);
          return { text: `**${hitName}** 维修明细（按机种 × 不良现象）：\n${lines}\n合计 ${sum} 片。`, trace };
        }
        return { text: `暂无 **${hitName}** 的维修明细数据（需绑定含「错误描述」字段的维修明细报表）。`, trace };
      }
      const d = this._call(trace, tools, 'get_person', { name: hitName });
      return { text: `**${d.name}** 今日产出 ${d.v} 件，在 ${d.total} 名工程师中排名第 ${d.rank}${d.rank === 1 ? '（产出冠军 🏆）' : ''}。${d.person ? `当前状态：${d.person._on ? '在岗' : (d.person.status || '未到')}，班次：${d.person.shift || '—'}。` : ''}`, trace };
    }

    // 不良明细 / 高频故障（未指定具体人员）
    if (this._hit(q, ['不良', '故障', '现象', '明细', '高频', '什么故障', '哪些故障', '错误描述', '修了什么', '板卡', '料号'])) {
      const dd = this._call(trace, tools, 'get_defect_detail', {});
      if (!dd || !dd.total) return { text: '当前没有维修明细（不良现象）数据，请绑定含「错误描述」字段的维修明细报表。', trace };
      const topD = dd.topDefects.slice(0, 5).map(([n, v], i) => `${i + 1}. **${n}** ${v} 片`).join('\n');
      const topM = dd.topModels.slice(0, 3).map(([n, v]) => `${n}（${v} 片）`).join('、');
      return { text: `近期高频不良现象 TOP5：\n${topD}\n高频机种：${topM}。\n建议对排名靠前的不良现象做专题根因分析。`, trace };
    }

    // 趋势
    if (this._hit(q, ['趋势', '产量', '产出趋势', '峰值', '最高产', '最多', '走势', '维修量'])) {
      const d = this._call(trace, tools, 'get_repair_trend', { days: 7 });
      if (!d) return { text: '暂无维修趋势数据。', trace };
      return { text: `近 ${d.values.length} 日维修量峰值在 **${d.labels[d.peakIdx]}**（${d.values[d.peakIdx]} 件），低点在 **${d.labels[d.minIdx]}**（${d.values[d.minIdx]} 件），均值约 ${d.avg} 件/日。最新一日 ${d.last} 件，环比${d.last >= d.prev ? '上升 📈' : '回落 📉'}。`, trace };
    }

    // 出勤
    if (this._hit(q, ['出勤', '缺勤', '请假', '到岗', '在岗', '多少人', '人数', '未到', '迟到'])) {
      const d = this._call(trace, tools, 'get_attendance', {});
      let r = `今日计划 ${d.plan} 人，实际在岗 ${d.actual} 人（白班 ${d.day} / 夜班 ${d.night}），出勤率 ${d.rate}%。`;
      if (d.absentNames.length) r += `\n未出勤：${d.absentNames.join('、')}。`;
      if (d.lateNames.length) r += `\n迟到：${d.lateNames.join('、')}。`;
      if (!d.absentNames.length && !d.lateNames.length) r += `\n全员准时到岗 ✅。`;
      return { text: r, trace };
    }

    // WIP / 待修
    if (this._hit(q, ['wip', 'WIP', '积压', '在制', '待修', '堆积', '老化', '超期', '未修'])) {
      const d = this._call(trace, tools, 'get_wip', {});
      if (!d) return { text: '当前没有待修 WIP 数据。可在系统设置中填入「待修 WIP」数量，或接入工单状态数据源后自动监控。', trace };
      if (d.board) {
        let r = `当前待修 WIP **${d.total}** 件，${d.high ? '已超 20 件预警线 ⚠️' : '处于可控区间 ✅'}。`;
        if (d.repairRate !== null) r += `近期修复率约 **${d.repairRate}%**（已修 ${d.fixed}/报废 ${d.scrap}）。`;
        if (d.trend.length) r += `近 ${d.trend.length} 日 ${d.trend.join('→')}（${d.rising ? '持续积压' : '趋于消化'}）。`;
        if (d.byModel.length) r += `\n机种分布：${d.byModel.slice(0, 3).map(([k, v]) => `${k} ${v}件`).join('、')}。`;
        if (d.aging.length) r += `\n老化分布：${d.aging.map(([k, v]) => `${k} ${v}件`).join('、')}。`;
        if (d.overdue.length) r += `\n⚠️ ${d.overdue.length} 件超 7 天未修：${d.overdue.slice(0, 3).map(o => `${o['工单']}（${o['机种']}/${o['待修天数']}天）`).join('；')}，建议立即催办闭环。`;
        return { text: r, trace };
      }
      return { text: `当前待修 WIP 约 **${d.wip}** 件，${d.high ? '已偏高 ⚠️，建议优先消化在制工单或临时增援夜班。' : '处于健康水位 ✅，维持现有节奏即可。'}`, trace };
    }

    // 排班建议
    if (this._hit(q, ['排班', '建议', '改善', '优化', '怎么办', '如何', '提升', '措施'])) {
      const wp = this._call(trace, tools, 'get_wip', {});
      const at = this._call(trace, tools, 'get_attendance', {});
      const tips = [];
      if (wp && wp.board && wp.overdue.length) tips.push(`待修 WIP ${wp.total} 件且有 ${wp.overdue.length} 件超 7 天未修，建议专人催办老化工单并评估夜班增援`);
      else if (wp && wp.high) tips.push('待修 WIP 偏高，建议优先处理在制工单并评估夜班增援');
      if (at.absentNames.length) tips.push(`存在 ${at.absentNames.length} 人缺勤，建议安排顶岗以稳定产出`);
      tips.push('对高频重复工单做聚类分析，提前备料、预防性维护');
      return { text: `**改善建议**：\n${tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`, trace };
    }

    // TOP
    if (this._hit(q, ['谁', '最强', '冠军', 'top', 'TOP', '标兵', '最厉害', '第一'])) {
      const d = this._call(trace, tools, 'get_staff_output', {});
      if (!d) return { text: '暂无个人产出数据。', trace };
      return { text: `今日产出 TOP3：${d.sorted.slice(0, 3).map((x, i) => `${i + 1}. **${x.n}**（${x.v} 件）`).join('；')}。`, trace };
    }

    if (this._hit(q, ['你好', '您好', 'hi', 'hello', '帮助', '能做什么', '会什么', '怎么用'])) {
      return { text: `你好，我是 Gemma 4 维修智能助手。你可以问我：\n• 「维修二组今天出勤怎么样？」\n• 「张三产出多少？」\n• 「张三修了哪些不良？」\n• 「近期高频不良现象有哪些？」\n• 「近期维修趋势如何？」\n• 「当前 WIP 高不高？」\n• 「有什么排班建议？」`, trace };
    }
    return { text: `我可以基于看板数据回答出勤、产出趋势、维修明细（不良现象 × 机种）、个人/班组产能、WIP、排班建议等问题。试试「张三修了哪些不良」。`, trace };
  },

  /* ════════════════════════════════════════════
   *  领退料看板：工具注册表
   * ════════════════════════════════════════════ */
  _ctxMaterial(data) {
    return {
      rows: Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []),
      overtime: Array.isArray(data?.overtime) ? data.overtime : []
    };
  },
  _toolsMaterial(ctx) {
    const self = this;
    return {
      get_material_flow() {
        const iss = ctx.rows.filter(r => r['receive_return_type'] === '领料').length;
        const ret = ctx.rows.filter(r => r['receive_return_type'] === '退料').length;
        return { summary: `领料${iss}/退料${ret}/合计${ctx.rows.length}笔`, data: { iss, ret, total: ctx.rows.length } };
      },
      get_overtime_items() {
        return { summary: `超时未退 ${ctx.overtime.length} 条`, data: { list: ctx.overtime, count: ctx.overtime.length } };
      },
      get_location_stats(args) {
        const locs = {};
        ctx.rows.forEach(r => { const l = r['location_name']; if (!l) return; locs[l] = locs[l] || { i: 0, r: 0 }; r['receive_return_type'] === '领料' ? locs[l].i++ : locs[l].r++; });
        const ranked = Object.entries(locs).sort((a, b) => (b[1].i + b[1].r) - (a[1].i + a[1].r));
        let one = null;
        if (args.loc) { const key = Object.keys(locs).find(l => l.toUpperCase() === String(args.loc).toUpperCase()); if (key) one = { key, ...locs[key] }; }
        return { summary: one ? `${one.key}: 领${one.i}/退${one.r}` : `站别${ranked.length}个，最活跃${ranked[0] ? ranked[0][0] : '—'}`, data: { locs, ranked, one } };
      },
      get_top_parts() {
        const cnt = {}; ctx.rows.forEach(r => { const k = r['part_name'] || r['part']; if (k) cnt[k] = (cnt[k] || 0) + 1; });
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
        return { summary: top.length ? `热门物料 ${top[0][0]}(${top[0][1]}笔)` : '无物料明细', data: { top } };
      },
      get_top_operators() {
        const cnt = {}; ctx.rows.forEach(r => { const k = r['create_user_name']; if (k) cnt[k] = (cnt[k] || 0) + 1; });
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
        return { summary: top.length ? `操作TOP ${top[0][0]}(${top[0][1]}笔)` : '无操作记录', data: { top } };
      }
    };
  },

  _reportMaterial(data) {
    const ctx = this._ctxMaterial(data), tools = this._toolsMaterial(ctx), trace = [];
    if (!ctx.rows.length) {
      return { text: `### Gemma 4 领退料风险评估报告\n\n**1. 物料流转现状**\n*   暂无领退料明细数据，请先加载或刷新后再分析。\n\n*注意：此报告由 Gemma 4 (Demo Mode) 于 ${this._ts()} 生成。*`, trace };
    }
    const mf = this._call(trace, tools, 'get_material_flow', {});
    const ot = this._call(trace, tools, 'get_overtime_items', {});
    const ls = this._call(trace, tools, 'get_location_stats', {});
    const tp = this._call(trace, tools, 'get_top_parts', {});

    const topPartNames = tp.top.map(e => e[0]);
    const topLoc = ls.ranked[0];
    let riskBlock;
    if (ot.count) {
      const sample = ot.list.slice(0, 3).map(r => `单号 **${r['单号'] || '—'}**（${r['create_user_name'] || '—'}，已 ${r['_overtimeHours'] || '超时'}）`).join('；');
      riskBlock = `*   **超时风险**：检测到 **${ot.count}** 条领料超时未退料，存在资产滞留风险。重点项：${sample}。
*   **处置建议**：建议对上述单号发起闭环催办，核实是否存在非正常二次维修损耗。`;
    } else {
      riskBlock = `*   **超时风险**：当前未检测到超时未退料项，备件闭环状况良好。`;
    }

    const text = `### Gemma 4 领退料风险评估报告

**1. 物料流转现状**
*   今日单据合计 ${mf.total} 笔，其中领料 ${mf.iss} 笔（${this._pct(mf.iss, mf.total)}%）、退料 ${mf.ret} 笔（${this._pct(mf.ret, mf.total)}%）。
*   主要活跃物料集中在 **${topPartNames.length ? topPartNames.join('** 与 **') : '—'}** 类备件${topLoc ? `，最活跃站别为 **${topLoc[0]}**（${topLoc[1].i + topLoc[1].r} 笔）` : ''}。

**2. 异常风险预警**
${riskBlock}

**3. 供应链优化建议**
*   建议结合退料频次动态调整高频物料的领用定额，降低库存冗余。
*   建议在 Teams 中加强对高活跃站别的实时消息推送，提升闭环响应速度。

*注意：此报告由 Gemma 4 (Demo Mode) 于 ${this._ts()} 经多工具编排自动生成。*`;
    return { text, trace };
  },

  _chatMaterial(q, data) {
    const ctx = this._ctxMaterial(data), tools = this._toolsMaterial(ctx), trace = [];
    if (!ctx.rows.length) return { text: '当前没有领退料数据，请先刷新或加载数据。', trace };

    if (this._hit(q, ['超时', '风险', '未退', '滞留', '逾期', '催办', '异常'])) {
      const d = this._call(trace, tools, 'get_overtime_items', {});
      if (!d.count) return { text: '当前未检测到超时未退料项，备件闭环状况良好 ✅。', trace };
      const list = d.list.slice(0, 5).map(r => `单号 **${r['单号'] || '—'}**（${r['create_user_name'] || '—'}，已 ${r['_overtimeHours'] || '超时'}，料号 ${r['part'] || '—'}）`).join('\n• ');
      return { text: `检测到 **${d.count}** 条超时未退料：\n• ${list}\n建议对以上单号发起闭环催办。`, trace };
    }

    const locHit = (q.match(/EWH|SMT\d?|DIP|ASM/i) || [])[0];
    if (locHit || this._hit(q, ['站别', '工序', '产线'])) {
      const d = this._call(trace, tools, 'get_location_stats', { loc: locHit || '' });
      if (d.one) return { text: `**${d.one.key}** 站别：领料 ${d.one.i} 笔、退料 ${d.one.r} 笔，合计 ${d.one.i + d.one.r} 笔。`, trace };
      return { text: `各站别活跃度（领/退）：${d.ranked.slice(0, 4).map(([k, v]) => `**${k}** ${v.i}/${v.r}`).join('；')}。`, trace };
    }

    if (this._hit(q, ['领料', '退料', '占比', '对比', '多少笔', '单据', '数量'])) {
      const d = this._call(trace, tools, 'get_material_flow', {});
      return { text: `今日单据合计 ${d.total} 笔：领料 **${d.iss}** 笔（${this._pct(d.iss, d.total)}%）、退料 **${d.ret}** 笔（${this._pct(d.ret, d.total)}%）。`, trace };
    }

    if (this._hit(q, ['物料', '料号', '备件', 'part', '元件', '最多', '活跃'])) {
      const d = this._call(trace, tools, 'get_top_parts', {});
      if (!d.top.length) return { text: '暂无物料明细。', trace };
      return { text: `最活跃物料 TOP3：${d.top.map(([k, v], i) => `${i + 1}. ${k}（${v} 笔）`).join('；')}。`, trace };
    }

    if (this._hit(q, ['谁', '人员', '领用人', '操作', '最多人'])) {
      const d = this._call(trace, tools, 'get_top_operators', {});
      return { text: `操作笔数 TOP：${d.top.map(([k, v]) => `**${k}**（${v} 笔）`).join('；')}。`, trace };
    }

    if (this._hit(q, ['你好', '您好', 'hi', 'hello', '帮助', '能做什么', '会什么', '怎么用'])) {
      return { text: `你好，我是 Gemma 4 领退料风险助手。你可以问我：\n• 「有哪些超时未退料？」\n• 「EWH 站别情况怎么样？」\n• 「领料和退料各多少笔？」\n• 「哪些物料最活跃？」`, trace };
    }
    return { text: `我可以基于领退料数据回答超时风险、站别活跃度、领退料笔数、热门物料等问题。试试「有哪些超时未退料」。`, trace };
  }
};
