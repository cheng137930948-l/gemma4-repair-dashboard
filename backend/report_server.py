"""
Gemma 4 维修数据看板 - 参赛精简后端 (Demo Backend)
====================================================
比赛演示用的最小后端，核心是一个 Gemma 4 原生函数调用循环：
    注入 SKILL.md + 工具清单 → 模型输出 ```tool_code → 后端执行工具 → ```tool_output 回灌
    → 多轮循环 → 最终汇报 + trace/运行日志（见 agent.py / tools.py）。

路由层在本文件，函数调用循环在 agent.py，工具注册表在 tools.py。
若函数调用循环不可用，会自动回退为单轮 generate_content，保证演示不中断。

与公司生产版本相比，这里去掉了所有 webhook 推送、内部数据源、工作流引擎等逻辑，
只保留「Skill 驱动的 Gemma 4 报告生成」这一条主干，方便评委用自己的 Key 复现。

运行：
    pip install -r requirements.txt
    cp .env.example .env   # 填入你的 GOOGLE_API_KEY
    python report_server.py
然后浏览器打开前端看板，在 gemma_config.js 中把 demoMode 改为 false 即可接真模型。
"""

from pathlib import Path
from datetime import datetime
import os
import json

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types

from agent import run_agent, DEFAULT_MAX_TURNS
from demo_data import get_demo_payload

# ---------------------------------------------------------------------------
# 路径与配置
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
SKILL_PATH = BASE_DIR / "skills" / "repair-report" / "SKILL.md"
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
# 录制回放缓存：把一次真实跑批的报告+trace 落盘，录制时秒回（内容仍是真实 Gemma 4 输出）
CACHE_DIR = OUTPUT_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

load_dotenv(BASE_DIR / ".env")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
# Gemma 4 模型 ID。默认 gemma-4-26b-a4b-it（稳定、响应快）；可选 gemma-4-31b-it（质量略高）
MODEL_NAME = os.getenv("MODEL_NAME", "gemma-4-26b-a4b-it").strip()
# 单次 generate_content 的硬超时（毫秒）。防止个别请求挂死拖垮整次演示。
CALL_TIMEOUT_MS = int(os.getenv("CALL_TIMEOUT_MS", "30000"))
# 录制回放模式：REPLAY_ONLY=1 时直接返回缓存的真实跑批结果，不再实时调用模型（秒回，零等待）。
REPLAY_ONLY = os.getenv("REPLAY_ONLY", "0").strip() in ("1", "true", "True")

REPORT_TYPE_MAP = {
    "daily": "日报",
    "weekly": "周报",
    "monthly": "月报",
    "yearly": "年报",
    "shift": "班次报告",
    "material": "物料专项报告",
    "overtime": "超时专项报告",
    "summary": "综合分析报告",
}

app = Flask(__name__)
CORS(app)


# ---------------------------------------------------------------------------
# Prompt 构建（与生产版同结构，去掉内部数据源拼装）
# ---------------------------------------------------------------------------
def build_prompt(skill_text: str, payload: dict) -> str:
    report_type_key = payload.get("reportType", "daily")
    report_type = REPORT_TYPE_MAP.get(report_type_key, str(report_type_key))

    payload_text = json.dumps(
        {
            "reportType": report_type,
            "scopeLabel": payload.get("scopeLabel", "当前看板"),
            "dateRange": payload.get("dateRange", {}),
            "data": payload.get("data", payload.get("dashboardPacket", {})),
            "generatedAt": payload.get("generatedAt") or datetime.now().isoformat(),
        },
        ensure_ascii=False,
        indent=2,
    )

    return f"""你必须严格遵守下面的 Skill 规则。

【Skill 规则】
{skill_text}

【当前维修看板真实数据】
{payload_text}

【硬性约束】
只能分析上面提供的数据；数据不足时必须明确说明「数据未提供」，不得编造数字。

【任务】
请根据上面的真实看板数据，生成一份维修数据{report_type}。

【输出要求】
1. 汇报摘要  2. 数据口径  3. 关键指标概览  4. 异常预警  5. 风险提示
6. 原因分析  7. 改善建议  8. 后续跟进清单  9. 数据缺口说明
语气正式、结论前置、数据支撑，适合产线主管查看。
"""


def build_ask_prompt(skill_text: str, payload: dict) -> str:
    """对话问答 prompt：在 Skill 规则下回答用户针对当前数据的提问。"""
    question = payload.get("question", "").strip()
    data_text = json.dumps(
        payload.get("data", {}), ensure_ascii=False, indent=2
    )
    return f"""你是一名产线维修数据分析助手，请遵守下面的 Skill 规则。

【Skill 规则】
{skill_text}

【当前看板数据】
{data_text}

【用户问题】
{question}

请基于上面的真实数据简明作答，禁止编造未提供的数字；数据不足时直接说明。
"""


_CLIENT = None


def _get_client():
    """复用同一个 genai.Client。

    每次新建 Client 会在旧实例被 GC 时关闭共享底层连接，导致后续调用报
    'client has been closed'，因此这里做成单例。"""
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = genai.Client(
            api_key=GOOGLE_API_KEY,
            http_options=types.HttpOptions(timeout=CALL_TIMEOUT_MS),
        )
    return _CLIENT


def _call_gemma(prompt: str) -> str:
    """单轮纯文本调用（保留为函数调用循环失败时的兜底路径），带 5xx 重试。"""
    import time as _t
    last = None
    attempts = 3
    for attempt in range(attempts):
        try:
            response = _get_client().models.generate_content(model=MODEL_NAME, contents=prompt)
            return (response.text or "").strip()
        except Exception as exc:  # noqa: BLE001
            msg = str(exc); lo = msg.lower()
            last = exc
            transient = any(k in msg for k in ("500", "INTERNAL", "503", "504", "UNAVAILABLE", "DEADLINE")) \
                or any(k in lo for k in ("deadline", "overloaded", "timeout", "timed out"))
            if not transient or attempt == attempts - 1:
                raise
            _t.sleep(1.0 * (attempt + 1))
    raise last  # pragma: no cover


def _infer_board(payload: dict) -> str:
    """判断看板：integrated（综合）/ repair（维修修复率）/ material（领退料）。"""
    board = (payload.get("board") or "").strip().lower()
    if board in ("integrated", "repair", "material"):
        return board
    data = payload.get("data", payload.get("dashboardPacket", {}))
    rows = data.get("rows") if isinstance(data, dict) else (data if isinstance(data, list) else None)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "receive_return_type" in rows[0]:
        return "material"
    rt = str(payload.get("reportType", "")).lower()
    if rt in ("material", "overtime"):
        return "material"
    return "integrated"


# 各看板的分析任务描述（注入 prompt 的【任务】部分）
BOARD_TASK = {
    "integrated": ("请针对「产线维修综合看板」生成一份维修数据{rt}。先通过函数调用取数"
                   "（出勤、维修趋势、个人产出、待修 WIP、不良明细），再按 Skill 的 9 段式结构"
                   "输出结论前置、数据支撑、建议可执行的管理汇报。"),
    "repair": ("请针对「维修修复率看板」生成一份修复率专项分析{rt}。重点先调用 get_wip 获取"
               "修复率、已修/报废、待修 WIP、超期清单与积压趋势，再调用 get_defect_detail 获取"
               "高频不良 TOP，按 Skill 规则输出结论前置、含分级预警与可执行改善建议的汇报。"),
    "material": ("请针对「产线维修领退料看板」生成一份领退料风险评估{rt}。先通过函数调用获取"
                 "领退料流转、超时未退、站别活跃度与热门物料，再按 Skill 规则输出结论前置、"
                 "含超时分级预警与可执行处置建议的汇报。"),
}


def _build_task(board: str, report_type: str, scope: str) -> str:
    tmpl = BOARD_TASK.get(board, BOARD_TASK["integrated"])
    return tmpl.format(rt=report_type)


def _cache_path(board: str, report_type_key: str) -> Path:
    return CACHE_DIR / f"{board}_{report_type_key}.json"


def _load_cache(board: str, report_type_key: str):
    p = _cache_path(board, report_type_key)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return None


def _save_cache(board: str, report_type_key: str, resp: dict):
    try:
        _cache_path(board, report_type_key).write_text(
            json.dumps(resp, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def _resolve_data(payload: dict, board: str):
    """前端传了 data 就用前端的；统一分析中心不传 data 时，用后端自带的脱敏演示数据。"""
    data = payload.get("data", payload.get("dashboardPacket", None))
    has_data = (isinstance(data, dict) and data) or (isinstance(data, list) and data)
    if has_data:
        return data, False
    return get_demo_payload(board), True


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "model": MODEL_NAME,
            "hasKey": bool(GOOGLE_API_KEY),
            "skillLoaded": SKILL_PATH.exists(),
            "functionCalling": True,
            "maxTurns": DEFAULT_MAX_TURNS,
        }
    )


@app.route("/api/generate-report", methods=["POST"])
def generate_report():
    payload = request.get_json(force=True) or {}
    board = _infer_board(payload)
    rt_key = payload.get("reportType", "daily")

    # 录制回放：返回缓存的真实跑批结果，秒回零等待（内容是此前真实 Gemma 4 输出）
    if REPLAY_ONLY or payload.get("replay"):
        cached = _load_cache(board, rt_key)
        if cached:
            cached = {**cached, "replay": True}
            return jsonify(cached)
        if REPLAY_ONLY:
            return jsonify({"ok": False, "error": f"回放模式下未找到缓存（{board}/{rt_key}），"
                            f"请先用 warm_cache.py 预热或临时关闭 REPLAY_ONLY 跑一次。"}), 404

    if not GOOGLE_API_KEY:
        return jsonify({"ok": False, "error": "未配置 GOOGLE_API_KEY，请在 .env 中填入"}), 400
    try:
        skill_text = SKILL_PATH.read_text(encoding="utf-8")
        report_type = REPORT_TYPE_MAP.get(rt_key, "报告")
        scope = payload.get("scopeLabel", "当前看板")
        data, used_demo = _resolve_data(payload, board)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        task = _build_task(board, report_type, scope)
        if used_demo:
            task += "（前端未携带数据，已使用后端脱敏演示数据。）"

        trace, turns, log_file = [], 0, None
        try:
            log_path = OUTPUT_DIR / f"agent_run_{stamp}.log"
            result = run_agent(_get_client(), MODEL_NAME, skill_text, board, data,
                               task, final_label="报告",
                               max_turns=DEFAULT_MAX_TURNS, log_path=log_path)
            report = result["report"]
            trace, turns, log_file = result["trace"], result["turns"], result["logFile"]
            if not report.strip():
                raise ValueError("函数调用循环未产出报告，回退单轮")
        except Exception as agent_exc:  # noqa: BLE001 - 函数调用失败时兜底为单轮
            # 兜底单轮也要带上已解析的数据（含后端脱敏演示数据），否则会误判“数据未提供”
            fb_payload = {**payload, "data": data, "reportType": payload.get("reportType", "daily")}
            report = _call_gemma(build_prompt(skill_text, fb_payload))
            trace = [{"step": 0, "tool": "(fallback)", "args": {},
                      "summary": f"函数调用循环不可用，已回退单轮：{agent_exc}"}]

        out_file = OUTPUT_DIR / f"维修数据{report_type}_{stamp}.md"
        out_file.write_text(report, encoding="utf-8")

        resp_obj = {
            "ok": True,
            "report": report,
            "reportType": report_type,
            "model": MODEL_NAME,
            "board": board,
            "trace": trace,
            "turns": turns,
            "logFile": log_file,
            "outputFile": str(out_file.name),
        }
        # 真实跑批成功且确实走了函数调用循环（trace 有工具步）才缓存，供录制回放
        if turns and report.strip():
            _save_cache(board, rt_key, resp_obj)
        return jsonify(resp_obj)
    except Exception as exc:  # noqa: BLE001 - demo 后端，向前端透传错误
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/ask", methods=["POST"])
def ask_repair():
    if not GOOGLE_API_KEY:
        return jsonify({"ok": False, "error": "未配置 GOOGLE_API_KEY，请在 .env 中填入"}), 400
    try:
        payload = request.get_json(force=True) or {}
        skill_text = SKILL_PATH.read_text(encoding="utf-8")
        question = (payload.get("question") or "").strip()
        board = _infer_board(payload)
        data, _ = _resolve_data(payload, board)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        task = (f"用户的问题是：「{question}」。"
                f"请先通过函数调用获取相关看板数据，再基于真实数据简明作答；"
                f"禁止编造未提供的数字，数据不足时直接说明。")

        trace, turns = [], 0
        try:
            log_path = OUTPUT_DIR / f"agent_ask_{stamp}.log"
            result = run_agent(_get_client(), MODEL_NAME, skill_text, board, data,
                               task, final_label="回答",
                               max_turns=DEFAULT_MAX_TURNS, log_path=log_path)
            answer = result["report"]
            trace, turns = result["trace"], result["turns"]
            if not answer.strip():
                raise ValueError("函数调用循环未产出回答，回退单轮")
        except Exception as agent_exc:  # noqa: BLE001
            fb_payload = {**payload, "data": data}
            answer = _call_gemma(build_ask_prompt(skill_text, fb_payload))
            trace = [{"step": 0, "tool": "(fallback)", "args": {},
                      "summary": f"函数调用循环不可用，已回退单轮：{agent_exc}"}]

        return jsonify({"ok": True, "answer": answer, "model": MODEL_NAME,
                        "board": board, "trace": trace, "turns": turns})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 500


if __name__ == "__main__":
    # 端口可经 .env 的 PORT 覆盖（默认 8000）。本机 8000 若被其它程序占用，
    # 在 .env 里设 PORT=8001 即可，无需改代码。
    PORT = int(os.environ.get("PORT", "8000"))
    print(f"[Gemma4 Demo Backend] model={MODEL_NAME}  key={'已配置' if GOOGLE_API_KEY else '未配置'}")
    print(f"[Gemma4 Demo Backend] skill={'已加载' if SKILL_PATH.exists() else '缺失'}  函数调用循环=on(max_turns={DEFAULT_MAX_TURNS})")
    print(f"[Gemma4 Demo Backend] -> http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
