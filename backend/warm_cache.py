"""
录制预热脚本：把三个看板各跑一次真实 Gemma 4 函数调用循环，
把结果（报告 + trace + 运行日志名）缓存到 output/cache/<board>_<reportType>.json。

录制当天的用法：
    1. 先运行本脚本预热缓存（接口慢/偶发抖动会自动重试，耐心等几分钟）：
           python warm_cache.py
       全部 OK 后，output/cache/ 下会生成 3 个 json。
    2. 在 .env 里设 REPLAY_ONLY=1（或启动前 set REPLAY_ONLY=1），重启后端：
           python report_server.py
       此时前端点「开始分析」会秒回缓存里的真实结果，零等待、可控时延。
    3. 录完后把 REPLAY_ONLY 改回 0 即可恢复实时调用。

注意：缓存内容是真实的 Gemma 4 跑批输出（报告、trace、运行日志都是真的），
只是录制时改为回放，避免现场被模型 10–20s/次的推理延迟拖垮。
"""

import os
import json
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

from agent import run_agent, DEFAULT_MAX_TURNS  # noqa: E402
from demo_data import get_demo_payload  # noqa: E402
import report_server as rs  # noqa: E402

API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
MODEL = os.getenv("MODEL_NAME", "gemma-4-26b-a4b-it").strip()
TIMEOUT_MS = int(os.getenv("CALL_TIMEOUT_MS", "30000"))

BOARDS = [
    ("repair", "daily"),
    ("integrated", "daily"),
    ("material", "daily"),
]


def main():
    if not API_KEY:
        raise SystemExit("未配置 GOOGLE_API_KEY，请先在 backend/.env 填入。")
    client = genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=TIMEOUT_MS))
    skill_text = rs.SKILL_PATH.read_text(encoding="utf-8")

    import time
    BOARD_RETRIES = 5  # 接口偶发 5xx/504 时整体重跑该看板
    for board, rt_key in BOARDS:
        report_type = rs.REPORT_TYPE_MAP.get(rt_key, "报告")
        data = get_demo_payload(board)
        task = rs.BOARD_TASK.get(board, rs.BOARD_TASK["integrated"]).format(rt=report_type)
        print(f"\n=== 预热 {board} / {report_type} ===")
        result = None
        for attempt in range(1, BOARD_RETRIES + 1):
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_path = rs.OUTPUT_DIR / f"agent_run_{stamp}.log"
            try:
                result = run_agent(client, MODEL, skill_text, board, data, task,
                                   final_label="报告", max_turns=DEFAULT_MAX_TURNS, log_path=log_path)
                if result["turns"] and result["report"].strip():
                    break
                print(f"  · 第{attempt}次未走通函数调用循环（turns={result['turns']}），重试…")
            except Exception as exc:  # noqa: BLE001
                print(f"  · 第{attempt}次失败：{str(exc)[:80]}，重试…")
                result = None
            time.sleep(2)
        if not (result and result["turns"] and result["report"].strip()):
            print(f"  ✗ {board} 预热失败（已重试 {BOARD_RETRIES} 次），稍后再跑一次本脚本即可。")
            continue
        report = result["report"]
        resp_obj = {
            "ok": True, "report": report, "reportType": report_type,
            "model": MODEL, "board": board, "trace": result["trace"],
            "turns": result["turns"], "logFile": result["logFile"],
            "outputFile": f"维修数据{report_type}_{stamp}.md",
        }
        rs._save_cache(board, rt_key, resp_obj)
        print(f"  ✓ {board} 已缓存：turns={result['turns']}，报告 {len(report)} 字 -> "
              f"{rs._cache_path(board, rt_key).name}")
        for s in result["trace"]:
            print(f"     [{s['step']}] {s['tool']} -> {s['summary'][:40]}")

    print("\n全部预热完成。录制前在 .env 设 REPLAY_ONLY=1 并重启后端即可秒回。")


if __name__ == "__main__":
    main()
