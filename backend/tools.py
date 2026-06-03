"""
Gemma 4 维修看板 - 后端工具注册表 (Tool Registry)
==================================================
把前端 gemma_adapter.js 里那套"看板能力工具"原样移植到 Python，
作为 Gemma 4 原生函数调用循环（见 report_server.py 的 run_agent）的执行端。

每个工具接收看板数据上下文 + 可选参数，返回统一结构：
    {"summary": "一句话中间结论", "data": {...}}

设计目标：让 Gemma 4 自己决定调用哪个工具、按什么顺序调用，
真正的"取数 → 算指标 → 出结论"由模型驱动，而非后端硬编码编排。
"""

from __future__ import annotations
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------
def _num(v: Any) -> float:
    try:
        n = float(v)
        return n if n == n else 0.0  # NaN -> 0
    except (TypeError, ValueError):
        return 0.0


def _int(v: Any) -> int:
    return int(_num(v))


def _pct(p: float, t: float) -> int:
    return round((p / t) * 100) if t > 0 else 0


def _avg(a: List[Any]) -> float:
    return sum(_num(x) for x in a) / len(a) if a else 0.0


def _argmax(a: List[float]) -> int:
    m = 0
    for i in range(1, len(a)):
        if a[i] > a[m]:
            m = i
    return m


def _argmin(a: List[float]) -> int:
    m = 0
    for i in range(1, len(a)):
        if a[i] < a[m]:
            m = i
    return m


# ===========================================================================
#  综合维修看板：上下文 + 工具注册表
# ===========================================================================
def build_integrated_context(data: Dict[str, Any]) -> Dict[str, Any]:
    data = data or {}
    mods = data.get("modules") or {}

    wip = ""
    for k in ("module1", "module2", "module3", "module4"):
        m = mods.get(k)
        if not m:
            continue
        cur = m.get("currentData") or {}
        w = cur.get("wip", m.get("wip"))
        if w is not None and str(w).strip() != "":
            wip = str(w).strip()
            break

    att = (data.get("attendance") or {}).get("currentData") or data.get("attendance") or {}
    m1 = mods.get("module1") or {}
    m3 = mods.get("module3") or {}
    trend = m1.get("currentData") or m1 or {}
    staff = m3.get("currentData") or m3 or {}

    return {
        "att": att,
        "trend": trend,
        "staff": staff,
        "wip": wip,
        "wipBoard": data.get("wipBoard") or data.get("wipDemo") or None,
    }


def integrated_tools(ctx: Dict[str, Any]) -> Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]]:
    att = ctx.get("att") or {}
    trend = ctx.get("trend") or {}
    staff = ctx.get("staff") or {}

    def _people_all() -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for p in (att.get("present") or []):
            out.append({**p, "_on": True})
        for p in (att.get("late") or []):
            out.append({**p, "_on": True})
        for p in (att.get("absent") or []):
            out.append({**p, "_on": False})
        for p in (att.get("leave") or []):
            out.append({**p, "_on": False})
        return out

    def get_repair_trend(args: Dict[str, Any]) -> Dict[str, Any]:
        labels = trend.get("labels") or []
        values = [_num(v) for v in (trend.get("values") or [])]
        if not values:
            return {"summary": "无趋势数据", "data": None}
        pi, mi = _argmax(values), _argmin(values)
        last = values[-1]
        prev = values[-2] if len(values) >= 2 else last
        avg = round(_avg(values))
        direction = "上升" if last >= prev else "回落"
        band = f"{max(0, round(last * 0.93))}-{round(last * 1.07)}"
        return {
            "summary": f"近{len(values)}日峰值{int(values[pi])}件({labels[pi] if pi < len(labels) else pi})，均值{avg}，最新{int(last)}件{direction}",
            "data": {"labels": labels, "values": values, "peakIdx": pi, "minIdx": mi,
                     "last": last, "prev": prev, "avg": avg, "dir": direction, "band": band},
        }

    def get_staff_output(args: Dict[str, Any]) -> Dict[str, Any]:
        names = staff.get("labels") or []
        vals = [_num(v) for v in (staff.get("values") or [])]
        if not names:
            return {"summary": "无个人产出数据", "data": None}
        pairs = sorted(({"n": n, "v": vals[i] if i < len(vals) else 0} for i, n in enumerate(names)),
                       key=lambda x: x["v"], reverse=True)
        total = sum(vals)
        ratio = round(pairs[0]["v"] / pairs[-1]["v"], 1) if len(pairs) > 1 and pairs[-1]["v"] > 0 else None
        return {
            "summary": f"TOP {pairs[0]['n']}({int(pairs[0]['v'])}件)，合计{int(total)}件",
            "data": {"names": names, "vals": vals, "sorted": pairs, "sum": total, "ratio": ratio},
        }

    def get_attendance(args: Dict[str, Any]) -> Dict[str, Any]:
        s = att.get("summary") or {}
        plan = _num(s.get("attendancePlan"))
        actual = _num(s.get("attendanceActual"))
        absent_names = [p.get("name") for p in (att.get("absent") or []) if p.get("name")]
        late_names = [p.get("name") for p in (att.get("late") or []) if p.get("name")]
        return {
            "summary": f"在岗{int(actual)}/{int(plan)}，出勤{_pct(actual, plan)}%",
            "data": {"plan": plan, "actual": actual, "rate": _pct(actual, plan),
                     "day": _num(s.get("dayShiftActual")), "night": _num(s.get("nightShiftActual")),
                     "absentNames": absent_names, "lateNames": late_names},
        }

    def get_wip(args: Dict[str, Any]) -> Dict[str, Any]:
        b = ctx.get("wipBoard")
        if b and _num(b.get("total")) > 0:
            total = _int(b.get("total"))
            high = total >= 20
            overdue = b.get("overdue") if isinstance(b.get("overdue"), list) else []
            trend_v = [_num(v) for v in (b.get("trend") or [])]
            rising = len(trend_v) >= 2 and trend_v[-1] > trend_v[0]
            by_model = b.get("byModel") if isinstance(b.get("byModel"), list) else []
            aging = b.get("aging") if isinstance(b.get("aging"), list) else []
            rr = b.get("repairRate")
            repair_rate = _num(rr) if (rr == 0 or rr) else None
            fixed, scrap = _int(b.get("fixed")), _int(b.get("scrap"))
            return {
                "summary": (f"待修WIP {total}件{'(偏高)' if high else ''}"
                            f"{f'，超期 {len(overdue)} 件' if overdue else ''}"
                            f"{f'，修复率 {int(repair_rate)}%' if repair_rate is not None else ''}"),
                "data": {"board": True, "total": total, "high": high, "overdue": overdue,
                         "trend": trend_v, "rising": rising, "byModel": by_model, "aging": aging,
                         "repairRate": repair_rate, "fixed": fixed, "scrap": scrap},
            }
        wip = str(ctx.get("wip") or "")
        if not wip:
            return {"summary": "无 WIP 数据", "data": None}
        high = _num(wip) >= 10
        return {"summary": f"WIP {wip}件{'(偏高)' if high else '(健康)'}",
                "data": {"wip": wip, "high": high}}

    def get_group(args: Dict[str, Any]) -> Dict[str, Any]:
        g = str(args.get("group") or "")
        key = g.replace("维修", "")
        in_g = [p for p in _people_all() if key in (p.get("group") or "") or (p.get("group") or "") == g]
        on = [p for p in in_g if p.get("_on")]
        off = [p for p in in_g if not p.get("_on")]
        names = [p.get("name") for p in in_g]
        s_names = staff.get("labels") or []
        s_vals = [_num(v) for v in (staff.get("values") or [])]
        outs = sorted(({"n": n, "v": s_vals[i] if i < len(s_vals) else 0}
                       for i, n in enumerate(s_names) if n in names),
                      key=lambda x: x["v"], reverse=True)
        return {"summary": f"{g} 在岗{len(on)}/{len(in_g)}",
                "data": {"g": g, "inG": in_g, "on": on, "off": off, "outs": outs}}

    def get_person(args: Dict[str, Any]) -> Dict[str, Any]:
        name = str(args.get("name") or "")
        names = staff.get("labels") or []
        vals = [_num(v) for v in (staff.get("values") or [])]
        idx = names.index(name) if name in names else -1
        v = vals[idx] if 0 <= idx < len(vals) else 0
        pairs = sorted(({"n": n, "v": vals[i] if i < len(vals) else 0} for i, n in enumerate(names)),
                       key=lambda x: x["v"], reverse=True)
        rank = next((i + 1 for i, x in enumerate(pairs) if x["n"] == name), 0)
        person = next((p for p in _people_all() if p.get("name") == name), None)
        return {"summary": f"{name} {int(v)}件，排名第{rank}",
                "data": {"name": name, "v": v, "rank": rank, "total": len(names), "person": person}}

    def get_defect_detail(args: Dict[str, Any]) -> Dict[str, Any]:
        dm = staff.get("detailMap") or {}
        people = [k for k in dm if isinstance(dm.get(k), list) and dm[k]]
        if not people:
            return {"summary": "无维修明细数据", "data": None}

        def val(r):
            return _num(r.get("数量", r.get("qty", r.get("value", 1)))) or 1

        def model(r):
            return r.get("板卡料号") or r.get("料号") or r.get("机种") or r.get("model") or "未标料号"

        def defect(r):
            return r.get("错误描述") or r.get("不良现象") or r.get("不良描述") or r.get("defect") or "未标不良"

        person_agg: Dict[str, List[Dict[str, Any]]] = {}
        defect_g: Dict[str, float] = {}
        model_g: Dict[str, float] = {}
        total = 0.0
        for name in people:
            combo: Dict[str, float] = {}
            for r in (dm.get(name) or []):
                q, m, d = val(r), model(r), defect(r)
                key = f"{m}|{d}"
                combo[key] = combo.get(key, 0) + q
                defect_g[d] = defect_g.get(d, 0) + q
                model_g[m] = model_g.get(m, 0) + q
                total += q
            person_agg[name] = sorted(
                ({"model": k.split("|")[0], "defect": k.split("|")[1], "qty": v} for k, v in combo.items()),
                key=lambda x: x["qty"], reverse=True)
        top_defects = sorted(defect_g.items(), key=lambda x: x[1], reverse=True)
        top_models = sorted(model_g.items(), key=lambda x: x[1], reverse=True)

        one = None
        if args.get("name"):
            want = str(args["name"])
            key = next((n for n in people if n == want or want in n or n in want), None)
            if key:
                one = {"name": key, "items": person_agg[key]}

        if one:
            head = "，".join(f"{it['model']} {it['defect']} {int(it['qty'])}片" for it in one["items"][:2])
            summary = f"{one['name']}: {head}{'…' if len(one['items']) > 2 else ''}"
        else:
            summary = (f"明细{int(total)}片，高频不良「{top_defects[0][0]}」{int(top_defects[0][1])}片，"
                       f"机种「{top_models[0][0]}」{int(top_models[0][1])}片")
        return {"summary": summary,
                "data": {"personAgg": person_agg, "topDefects": top_defects,
                         "topModels": top_models, "total": total, "one": one}}

    return {
        "get_repair_trend": get_repair_trend,
        "get_staff_output": get_staff_output,
        "get_attendance": get_attendance,
        "get_wip": get_wip,
        "get_group": get_group,
        "get_person": get_person,
        "get_defect_detail": get_defect_detail,
    }


def integrated_tool_specs() -> List[Dict[str, str]]:
    return [
        {"signature": "get_wip()",
         "desc": "返回待修 WIP 总量、修复率、已修/报废数、超期工单清单、积压趋势、机种与老化分布。"},
        {"signature": "get_defect_detail(name?)",
         "desc": "返回高频不良现象 TOP、高频机种/料号、各维修员的不良明细；可传 name 查单个维修员。"},
        {"signature": "get_repair_trend()",
         "desc": "返回近 N 日维修量趋势、峰值、低点、均值与方向。"},
        {"signature": "get_staff_output()",
         "desc": "返回个人维修产出排名、合计与最高/最低产出比。"},
        {"signature": "get_attendance()",
         "desc": "返回出勤计划/实际人数、出勤率、白夜班、缺勤与迟到名单。"},
        {"signature": "get_group(group)",
         "desc": "返回某班组（如 维修二组）的在岗人数与产出。"},
        {"signature": "get_person(name)",
         "desc": "返回某位维修员的产出、排名与在岗状态。"},
    ]


# ===========================================================================
#  领退料看板：上下文 + 工具注册表
# ===========================================================================
def build_material_context(data: Any) -> Dict[str, Any]:
    if isinstance(data, dict):
        rows = data.get("rows") if isinstance(data.get("rows"), list) else (data if isinstance(data, list) else [])
        overtime = data.get("overtime") if isinstance(data.get("overtime"), list) else []
    elif isinstance(data, list):
        rows, overtime = data, []
    else:
        rows, overtime = [], []
    return {"rows": rows or [], "overtime": overtime or []}


def material_tools(ctx: Dict[str, Any]) -> Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]]:
    rows = ctx.get("rows") or []
    overtime = ctx.get("overtime") or []

    def get_material_flow(args: Dict[str, Any]) -> Dict[str, Any]:
        iss = sum(1 for r in rows if r.get("receive_return_type") == "领料")
        ret = sum(1 for r in rows if r.get("receive_return_type") == "退料")
        return {"summary": f"领料{iss}/退料{ret}/合计{len(rows)}笔",
                "data": {"iss": iss, "ret": ret, "total": len(rows)}}

    def get_overtime_items(args: Dict[str, Any]) -> Dict[str, Any]:
        return {"summary": f"超时未退 {len(overtime)} 条",
                "data": {"list": overtime, "count": len(overtime)}}

    def get_location_stats(args: Dict[str, Any]) -> Dict[str, Any]:
        locs: Dict[str, Dict[str, int]] = {}
        for r in rows:
            l = r.get("location_name")
            if not l:
                continue
            locs.setdefault(l, {"i": 0, "r": 0})
            if r.get("receive_return_type") == "领料":
                locs[l]["i"] += 1
            else:
                locs[l]["r"] += 1
        ranked = sorted(locs.items(), key=lambda kv: kv[1]["i"] + kv[1]["r"], reverse=True)
        one = None
        if args.get("loc"):
            want = str(args["loc"]).upper()
            key = next((l for l in locs if l.upper() == want), None)
            if key:
                one = {"key": key, **locs[key]}
        summary = (f"{one['key']}: 领{one['i']}/退{one['r']}" if one
                   else f"站别{len(ranked)}个，最活跃{ranked[0][0] if ranked else '—'}")
        return {"summary": summary, "data": {"locs": locs, "ranked": ranked, "one": one}}

    def get_top_parts(args: Dict[str, Any]) -> Dict[str, Any]:
        cnt: Dict[str, int] = {}
        for r in rows:
            k = r.get("part_name") or r.get("part")
            if k:
                cnt[k] = cnt.get(k, 0) + 1
        top = sorted(cnt.items(), key=lambda x: x[1], reverse=True)[:3]
        return {"summary": f"热门物料 {top[0][0]}({top[0][1]}笔)" if top else "无物料明细",
                "data": {"top": top}}

    def get_top_operators(args: Dict[str, Any]) -> Dict[str, Any]:
        cnt: Dict[str, int] = {}
        for r in rows:
            k = r.get("create_user_name")
            if k:
                cnt[k] = cnt.get(k, 0) + 1
        top = sorted(cnt.items(), key=lambda x: x[1], reverse=True)[:3]
        return {"summary": f"操作TOP {top[0][0]}({top[0][1]}笔)" if top else "无操作记录",
                "data": {"top": top}}

    return {
        "get_material_flow": get_material_flow,
        "get_overtime_items": get_overtime_items,
        "get_location_stats": get_location_stats,
        "get_top_parts": get_top_parts,
        "get_top_operators": get_top_operators,
    }


def material_tool_specs() -> List[Dict[str, str]]:
    return [
        {"signature": "get_material_flow()",
         "desc": "返回领料/退料/合计笔数。"},
        {"signature": "get_overtime_items()",
         "desc": "返回超时未退料清单与条数。"},
        {"signature": "get_location_stats(loc?)",
         "desc": "返回各站别领退料活跃度；可传 loc 查单个站别。"},
        {"signature": "get_top_parts()",
         "desc": "返回最活跃物料 TOP3。"},
        {"signature": "get_top_operators()",
         "desc": "返回操作笔数最多的人员 TOP3。"},
    ]


# ===========================================================================
#  对外统一入口：按看板类型构建工具集
# ===========================================================================
def build_toolset(board: str, data: Any):
    """返回 (tools_dict, specs_list)。board: 'integrated' | 'repair' | 'material'。
    'repair'（维修修复率看板）复用综合看板的工具集（同一套 WIP / 修复率口径）。"""
    if board == "material":
        ctx = build_material_context(data)
        return material_tools(ctx), material_tool_specs()
    ctx = build_integrated_context(data if isinstance(data, dict) else {})
    return integrated_tools(ctx), integrated_tool_specs()
