"""
Gemma 4 维修数据看板 - 参赛精简后端 (Demo Backend)
====================================================
比赛演示用的最小后端：读取 SKILL.md → 拼接 prompt → 调用 Gemma 4 → 返回报告。

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

# ---------------------------------------------------------------------------
# 路径与配置
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
SKILL_PATH = BASE_DIR / "skills" / "repair-report" / "SKILL.md"
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

load_dotenv(BASE_DIR / ".env")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
# Gemma 4 模型 ID。可用：gemma-4-31b-it（质量优先）/ gemma-4-26b-a4b-it（更快）
MODEL_NAME = os.getenv("MODEL_NAME", "gemma-4-31b-it").strip()

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


def _call_gemma(prompt: str) -> str:
    client = genai.Client(api_key=GOOGLE_API_KEY)
    response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
    return (response.text or "").strip()


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
        }
    )


@app.route("/api/generate-report", methods=["POST"])
def generate_report():
    if not GOOGLE_API_KEY:
        return jsonify({"ok": False, "error": "未配置 GOOGLE_API_KEY，请在 .env 中填入"}), 400
    try:
        payload = request.get_json(force=True) or {}
        skill_text = SKILL_PATH.read_text(encoding="utf-8")
        prompt = build_prompt(skill_text, payload)
        report = _call_gemma(prompt)

        report_type = REPORT_TYPE_MAP.get(payload.get("reportType", "daily"), "报告")
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_file = OUTPUT_DIR / f"维修数据{report_type}_{stamp}.md"
        out_file.write_text(report, encoding="utf-8")

        return jsonify(
            {
                "ok": True,
                "report": report,
                "reportType": report_type,
                "model": MODEL_NAME,
                "outputFile": str(out_file.name),
            }
        )
    except Exception as exc:  # noqa: BLE001 - demo 后端，向前端透传错误
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/ask", methods=["POST"])
def ask_repair():
    if not GOOGLE_API_KEY:
        return jsonify({"ok": False, "error": "未配置 GOOGLE_API_KEY，请在 .env 中填入"}), 400
    try:
        payload = request.get_json(force=True) or {}
        skill_text = SKILL_PATH.read_text(encoding="utf-8")
        prompt = build_ask_prompt(skill_text, payload)
        answer = _call_gemma(prompt)
        return jsonify({"ok": True, "answer": answer, "model": MODEL_NAME})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 500


if __name__ == "__main__":
    print(f"[Gemma4 Demo Backend] model={MODEL_NAME}  key={'已配置' if GOOGLE_API_KEY else '未配置'}")
    print(f"[Gemma4 Demo Backend] skill={'已加载' if SKILL_PATH.exists() else '缺失'}  -> http://127.0.0.1:8000")
    app.run(host="127.0.0.1", port=8000, debug=False)
