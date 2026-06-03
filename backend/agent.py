"""
Gemma 4 维修看板 - 原生函数调用循环 (Agent Loop)
==================================================
用 Gemma 4 文档推荐的函数调用约定，实现一个由模型驱动的多轮推理闭环：

    1. 向模型注入 Skill 规则 + 工具清单（见 tools.py）；
    2. 模型自行决定调用哪个工具，并输出 ```tool_code 代码块；
    3. 后端解析 tool_code → 在 Python 中真实执行工具（读取看板脱敏数据）；
    4. 把结果以 ```tool_output 回灌给模型，进入下一轮；
    5. 模型信息足够后停止调用工具，直接输出最终管理汇报。

整个"取数 → 算指标 → 出结论"由 Gemma 4 自主编排，而非后端硬编码顺序。
每一步的 (工具名 / 入参 / 中间结论) 都记录在 trace 里，并落盘为运行日志，
用于参赛要求的"代理工具调用逻辑 + 运行日志截图"。
"""

from __future__ import annotations
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from tools import build_toolset

# Gemma 4 接口偶发返回 5xx INTERNAL（瞬时抖动），做有限次重试。
# 录制演示对时延敏感，这里收敛重试：退避 1s，避免一次抖动把整次分析拖到分钟级。
# 末轮“生成最终长报告”的请求体最大、输出最长，最易被上游临时断开（Server disconnected），
# 故重试上限给到 3，并把“连接被断开/重置”一类也并入可重试集合（见 _generate）。
_RETRY_ATTEMPTS = 3
_RETRY_BACKOFF = 1.0

# 整个函数调用循环的总时长预算（秒）。超过后强制用已取到的数据收尾，保证演示时延可控。
# 必须在“调用时”读取：模块导入早于 report_server / warm_cache 的 load_dotenv，
# 若在导入期读取，.env 里的 RUN_BUDGET_SEC 覆盖值会被忽略，永远拿到默认 70。
_DEFAULT_RUN_BUDGET_SEC = 70.0


def _run_budget_sec() -> float:
    try:
        return float(os.getenv("RUN_BUDGET_SEC", _DEFAULT_RUN_BUDGET_SEC))
    except (TypeError, ValueError):
        return _DEFAULT_RUN_BUDGET_SEC


def _generate(client, model_name: str, contents):
    """带重试的 generate_content：遇到 5xx 服务端错误时退避重试。"""
    last_exc = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return client.models.generate_content(model=model_name, contents=contents)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            lo = msg.lower()
            transient = ("500" in msg or "INTERNAL" in msg or "503" in msg
                         or "504" in msg or "UNAVAILABLE" in msg
                         or "DEADLINE" in msg or "deadline" in lo
                         or "overloaded" in lo or "timeout" in lo or "timed out" in lo
                         # 上游在长生成时临时断开连接 / 重置，也按可重试处理
                         or "disconnect" in lo or "connection" in lo
                         or "remoteprotocol" in lo or "incompleteread" in lo
                         or "reset by peer" in lo or "broken pipe" in lo
                         or "econnreset" in lo)
            last_exc = exc
            if not transient or attempt == _RETRY_ATTEMPTS - 1:
                raise
            time.sleep(_RETRY_BACKOFF * (attempt + 1))
    raise last_exc  # pragma: no cover

# 位置参数 → 主参数名映射（便于模型用 get_person("张三") 这种写法）
_PRIMARY_PARAM = {
    "get_group": "group",
    "get_person": "name",
    "get_defect_detail": "name",
    "get_location_stats": "loc",
}

# 一次会话最多允许的工具调用轮数（防止模型无限调用）
DEFAULT_MAX_TURNS = 6


# ---------------------------------------------------------------------------
# Prompt 构建
# ---------------------------------------------------------------------------
def build_system_prompt(skill_text: str, specs: List[Dict[str, str]],
                        data: Any, task_text: str) -> str:
    tool_lines = "\n".join(f"- {s['signature']}：{s['desc']}" for s in specs)
    data_text = json.dumps(data, ensure_ascii=False, indent=2)[:6000]
    return f"""你是一名产线维修数据分析与管理汇报专员，必须严格遵守下面的 Skill 规则。

【Skill 规则】
{skill_text}

【可用工具（函数调用）】
你不能直接看到完整明细，必须通过调用工具来获取看板的真实数据。
{tool_lines}

【函数调用格式 - 必须严格遵守】
需要调用工具时，只输出一个代码块，不要输出其它内容，格式如下：
```tool_code
get_wip()
```
带参数时这样写：
```tool_code
get_defect_detail(name="张三")
```
系统会在 ```tool_output 代码块里把结果返回给你。你可以连续多次调用不同工具。
当你掌握的信息已足够生成汇报时，停止调用工具，直接输出最终报告文本（此时不要再出现 tool_code 代码块）。

【硬性约束】
- 只能使用工具返回的真实数据，禁止编造任何数字；数据不足时写明「数据未提供」。
- 必须先调用工具取数，至少调用一次 get_wip 再下结论。

【看板元信息（仅供参考，不含明细）】
{data_text}

【任务】
{task_text}
"""


# ---------------------------------------------------------------------------
# 解析模型输出里的工具调用
# ---------------------------------------------------------------------------
def _coerce(v: str) -> Any:
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


def _split_args(argstr: str) -> List[str]:
    """按顶层逗号切分参数，忽略引号内的逗号。"""
    parts, buf, quote = [], [], None
    for ch in argstr:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
            buf.append(ch)
        elif ch == ",":
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf))
    return [p for p in (s.strip() for s in parts) if p]


def parse_tool_call(text: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """从模型输出里解析 (工具名, 参数)。没有 tool_code 代码块则视为最终答案，返回 None。"""
    m = re.search(r"```(?:tool_code|tool_call|python)[^\S\n]*\n?(.+?)```", text, re.S | re.I)
    if not m:
        return None
    snippet = m.group(1)
    call = re.search(r"([a-zA-Z_]\w*)\s*\((.*?)\)", snippet, re.S)
    if not call:
        return None
    name = call.group(1)
    argstr = call.group(2).strip()
    args: Dict[str, Any] = {}
    positional: List[Any] = []
    if argstr:
        for part in _split_args(argstr):
            if "=" in part and not part.split("=", 1)[0].strip().startswith(("'", '"')):
                k, v = part.split("=", 1)
                args[k.strip()] = _coerce(v)
            else:
                positional.append(_coerce(part))
    if positional and name in _PRIMARY_PARAM and _PRIMARY_PARAM[name] not in args:
        args[_PRIMARY_PARAM[name]] = positional[0]
    return name, args


def _read_response(resp) -> Tuple[str, Optional[Tuple[str, Dict[str, Any]]]]:
    """同时兼容两种工具调用形态：
    1. 文本 ```tool_code 代码块（Gemma 4 文档约定的写法）；
    2. 原生 function_call part（部分 Gemma 4 模型会直接返回结构化调用）。
    返回 (文本, 原生调用或 None)。"""
    text = ""
    try:
        text = (resp.text or "").strip()
    except Exception:  # noqa: BLE001 - 仅有 function_call part 时 .text 可能抛错
        text = ""
    native: Optional[Tuple[str, Dict[str, Any]]] = None
    try:
        for cand in (resp.candidates or []):
            parts = getattr(getattr(cand, "content", None), "parts", None) or []
            for part in parts:
                fc = getattr(part, "function_call", None)
                if fc and getattr(fc, "name", None):
                    args = dict(fc.args) if getattr(fc, "args", None) else {}
                    native = (fc.name, args)
                    break
            if native:
                break
    except Exception:  # noqa: BLE001
        native = None
    return text, native


# ---------------------------------------------------------------------------
# 主循环
# ---------------------------------------------------------------------------
def run_agent(client, model_name: str, skill_text: str, board: str, data: Any,
              task_text: str, final_label: str = "报告",
              max_turns: int = DEFAULT_MAX_TURNS,
              log_path: Optional[Path] = None) -> Dict[str, Any]:
    tools, specs = build_toolset(board, data)
    system_prompt = build_system_prompt(skill_text, specs, data, task_text)
    contents: List[Dict[str, Any]] = [{"role": "user", "parts": [{"text": system_prompt}]}]
    trace: List[Dict[str, Any]] = []
    log_lines: List[str] = [f"# Gemma 4 Agent Run @ {datetime.now().isoformat()}",
                            f"model={model_name} board={board} max_turns={max_turns}", ""]
    final_text = ""
    start_ts = time.monotonic()
    run_budget_sec = _run_budget_sec()
    budget_hit = False

    def _flush_log():
        if log_path:
            try:
                log_path.write_text("\n".join(log_lines), encoding="utf-8")
            except OSError:
                pass

    for turn in range(1, max_turns + 1):
        # 总时长预算：已取过数据又超时，则停止继续取数，进入强制收尾
        if trace and (time.monotonic() - start_ts) > run_budget_sec:
            budget_hit = True
            log_lines.append(f"[turn {turn}] BUDGET HIT ({run_budget_sec}s)，强制收尾")
            _flush_log()
            break
        resp = _generate(client, model_name, contents)
        text, native_call = _read_response(resp)
        # 回灌给模型的历史里至少要有内容，避免空 part
        contents.append({"role": "model", "parts": [{"text": text or "(已发起函数调用)"}]})

        parsed = native_call or parse_tool_call(text)
        if not parsed:
            final_text = text
            log_lines.append(f"[turn {turn}] FINAL ANSWER ({len(text)} chars)")
            _flush_log()
            break

        name, args = parsed
        if name not in tools:
            err = f"未知工具 {name}，可用：{', '.join(tools.keys())}"
            step = {"step": turn, "tool": name, "args": args, "summary": err, "error": True}
            tool_output = f"错误：{err}"
        else:
            try:
                result = tools[name](args) or {}
                summary = result.get("summary", "")
                step = {"step": turn, "tool": name, "args": args, "summary": summary}
                tool_output = json.dumps({"summary": summary, "data": result.get("data")},
                                         ensure_ascii=False)
            except Exception as exc:  # noqa: BLE001
                step = {"step": turn, "tool": name, "args": args,
                        "summary": f"执行异常：{exc}", "error": True}
                tool_output = f"工具执行异常：{exc}"

        trace.append(step)
        log_lines.append(f"[turn {turn}] CALL {name}({args}) -> {step['summary']}")
        _flush_log()

        contents.append({"role": "user", "parts": [{"text":
            f"```tool_output\n{tool_output}\n```\n"
            f"请基于以上结果继续。若信息已足够，请直接输出最终{final_label}，不要再输出 tool_code。"}]})

    # 仍未拿到最终文本（轮数用尽 / 命中时长预算时仍在调用工具）：基于已取数据强制收尾
    if not final_text:
        reason = "时长预算" if budget_hit else "工具调用上限"
        contents.append({"role": "user", "parts": [{"text":
            f"已达到{reason}，请立即基于已获取的结果输出最终{final_label}，不要再调用工具。"}]})
        resp = _generate(client, model_name, contents)
        final_text, _ = _read_response(resp)
        log_lines.append(f"[forced] FINAL ANSWER ({len(final_text)} chars, reason={reason})")
        _flush_log()

    return {"report": final_text, "trace": trace, "turns": len(trace),
            "logFile": log_path.name if log_path else None}
